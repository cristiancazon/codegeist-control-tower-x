import { randomUUID } from 'node:crypto';
import { NeedsAuthenticationError } from '@forge/api';
import { canonicalJson, sha256 } from '../../domain/futuros/digest';
import {
  DECISIONS_APPROVE, DECISIONS_EXECUTE, DECISIONS_GET, DECISIONS_LIST, DECISIONS_PREPARE,
  DECISIONS_PROPOSE, DECISIONS_RECONCILE, DECISIONS_REJECT, type Decision, type DecisionActivity, type DecisionCard,
  type DecisionDraft, type DecisionEvidence, type DecisionsResult, type DecisionStatus,
} from '../../shared/decisions';
import { JiraBoundaryError, type JiraProjectAdapter } from '../data/jira';
import { isJiraId, isRecord } from '../data/jira/normalize';
import type { ProjectRole } from '../data/sql/projects';
import { STALE_EXECUTION_MS, type DecisionRow, type decisionStore } from './store';

type Request = { payload?: unknown; context?: unknown };
type Operation = typeof DECISIONS_LIST | typeof DECISIONS_GET | typeof DECISIONS_PREPARE | typeof DECISIONS_PROPOSE |
  typeof DECISIONS_APPROVE | typeof DECISIONS_REJECT | typeof DECISIONS_EXECUTE | typeof DECISIONS_RECONCILE;
type DecisionJira = Pick<JiraProjectAdapter, 'assertCorrectiveCreateTarget' | 'createCorrectiveIssue' |
  'findCorrectiveByMarker' | 'getWorkItem'>;
type Scope = {
  actor: string; projectId: string; jiraProjectId: string; roles: readonly ProjectRole[];
  jira: DecisionJira; target: DecisionDraft['target'];
};
type FrozenPayload = DecisionDraft & { jiraProjectId: string; marker: string };
type Dependencies = {
  authorize(context: unknown): Promise<Scope>;
  evidence(scope: Scope, runId: string): Promise<{ data: DecisionEvidence; expiresAt: string }>;
  store: typeof decisionStore;
  now(): number;
};

const messages = {
  INVALID_REQUEST: 'Revisá el contenido y las referencias de la propuesta.',
  FORBIDDEN: 'La acción no está disponible para esta cuenta.',
  AUTH_REQUIRED: 'Iniciá sesión en Jira para usar Decisiones.',
  DISABLED: 'El proyecto requiere un destino Jira configurado para Decisiones.',
  APPROVER_SETUP: 'Esta cuenta está configurada para revisar propuestas de la demostración. Confirmá la activación para la cuenta actual.',
  NOT_FOUND: 'La propuesta no está disponible en este proyecto.',
  STALE_INPUT: 'La evidencia o el destino cambió. Volvé a preparar la propuesta.',
  CONFLICT: 'La revisión o el estado cambió. Actualizá la propuesta.',
  UNAVAILABLE: 'Decisiones no pudo completar la consulta. Actualizá el estado antes de volver a operar.',
  SCHEMA_PENDING: 'Forge está preparando las tablas de Decisiones. Volvé a consultar en unos minutos.',
} as const;
type FailureCode = keyof typeof messages;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const referenceFields = ['decisionId', 'expectedRevision', 'expectedHash', 'confirmed'];
const activityEvents: readonly DecisionActivity['event'][] = ['proposed', 'approved', 'rejected', 'execution_reserved',
  'execution_failed', 'reconciliation_required', 'reconciled', 'applied'];

export class DecisionFailure extends Error {
  constructor(readonly code: FailureCode) { super(code); }
}

function parse(payload: unknown, keys: readonly string[]) {
  if (payload === undefined && keys.length === 0) return {};
  if (!isRecord(payload) || Reflect.ownKeys(payload).some((key) => typeof key !== 'string' || !keys.includes(key))) {
    throw new DecisionFailure('INVALID_REQUEST');
  }
  return payload;
}

function identifier(value: unknown) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new DecisionFailure('INVALID_REQUEST');
  return value;
}

function text(value: unknown, max: number, multiline = false) {
  if (typeof value !== 'string' || value.length > max || !value.trim() ||
      /[\p{Cc}\p{Cf}\p{Cs}]/u.test(multiline ? value.replace(/\r?\n/g, '') : value)) {
    throw new DecisionFailure('INVALID_REQUEST');
  }
  return value.replace(/\r\n/g, '\n').trim();
}

function readPayload(row: DecisionRow, jiraProjectId: string): FrozenPayload {
  if (sha256(row.payload_jcs) !== row.payload_hash) throw new DecisionFailure('CONFLICT');
  const value: unknown = JSON.parse(row.payload_jcs);
  if (!isRecord(value) || value.jiraProjectId !== jiraProjectId || value.marker !== `ctx-decision-${row.id}` ||
      value.marker !== row.correlation_key || !isRecord(value.target) || !isJiraId(value.target.issueTypeId) ||
      !isRecord(value.evidence) || !isJiraId(value.jiraProjectId) || !isRunId(value.evidence.runId)) {
    throw new DecisionFailure('CONFLICT');
  }
  return value as FrozenPayload;
}

function isRunId(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}

function approvalExpired(row: DecisionRow, now: number) {
  return !row.expires_at || !(Date.parse(row.expires_at) > now);
}

function statusOf(row: DecisionRow, now: number): DecisionStatus {
  if ((row.status === 'PROPOSED' || row.status === 'APPROVED' || row.status === 'FAILED') && approvalExpired(row, now)) {
    return 'EXPIRED';
  }
  if (row.status === 'EXECUTING' && row.execution_started_at && Date.parse(row.execution_started_at) + STALE_EXECUTION_MS <= now) {
    return 'RECONCILIATION_REQUIRED';
  }
  return row.status;
}

function sameTarget(scope: Scope, stored: FrozenPayload) {
  return scope.target.issueTypeId === stored.target.issueTypeId && scope.target.projectKey === stored.target.projectKey;
}

function executability(row: DecisionRow, status: DecisionStatus) {
  return row.approved_by !== null && row.approved_by !== row.proposed_by &&
    row.approved_revision === row.revision && row.approved_payload_hash === row.payload_hash &&
    (status === 'APPROVED' || (status === 'FAILED' && row.failure_class === 'DEFINITE'));
}

function closeEvidence(description: string, evidence: DecisionEvidence) {
  return `${description}\n\nEvidencia de Control Tower X · Patagonia sintética\n` +
    `A-17: ${evidence.sourceIssueKey} · Escenario ${evidence.scenario} · Corte ${evidence.asOf}\n` +
    `Corrida: ${evidence.runId}\nSnapshot: ${evidence.snapshotId}\nModelo: ${evidence.modelVersion}\n` +
    `Hash de resultado: ${evidence.resultHash}\nP80: ${evidence.durationP80Days} días · ${evidence.costP80Cents} centavos USD`;
}

export function createDecisionResolvers(deps: Dependencies) {
  const { store } = deps;

  function card(scope: Scope, row: DecisionRow): DecisionCard {
    return { id: row.id, summary: readPayload(row, scope.jiraProjectId).summary, status: statusOf(row, deps.now()),
      proposedAt: row.proposed_at, isMine: row.proposed_by === scope.actor };
  }

  async function detail(scope: Scope, row: DecisionRow): Promise<Decision> {
    const stored = readPayload(row, scope.jiraProjectId);
    const item = card(scope, row);
    let issueKey: string | null = null;
    if (row.external_issue_id && row.external_issue_key && item.status === 'APPLIED') {
      const visible = await scope.jira.getWorkItem(row.external_issue_id).catch(() => undefined);
      if (visible?.key === row.external_issue_key && visible.id === row.external_issue_id) issueKey = visible.key;
    }
    const isPlanner = item.isMine && scope.roles.includes('PLANNER');
    const activity = (await store.listAudit(scope.projectId, row.id)).flatMap((entry): DecisionActivity[] => {
      const event = activityEvents.find((name) => entry.event_type === `decision.${name}`);
      if (!event) return [];
      return [{ id: entry.id, event, at: entry.occurred_at,
        actor: entry.actor_kind === 'SYSTEM' ? 'SYSTEM' : entry.actor_account_id === scope.actor ? 'SELF'
          : event === 'approved' || event === 'rejected' ? 'APPROVER' : 'PLANNER',
      }];
    });
    return { ...item, description: stored.description, evidence: stored.evidence, target: stored.target,
      revision: row.revision, hash: row.payload_hash, reviewedAt: row.reviewed_at, reviewReason: row.review_reason,
      expiresAt: row.expires_at, executionStartedAt: row.execution_started_at, appliedAt: row.applied_at, issueKey,
      attemptCount: row.attempt_count, errorCode: row.last_error_code, activity,
      canReview: item.status === 'PROPOSED' && !item.isMine && scope.roles.includes('APPROVER') && sameTarget(scope, stored),
      canExecute: isPlanner && sameTarget(scope, stored) && executability(row, item.status),
      canReconcile: isPlanner && item.status === 'RECONCILIATION_REQUIRED',
    };
  }

  function corrective(stored: FrozenPayload) {
    const { summary, description, marker, target } = stored;
    return { summary, description, marker, ...target };
  }

  async function get(scope: Scope, id: string) {
    const row = await store.getDecision(scope.projectId, id);
    if (!row) throw new DecisionFailure('NOT_FOUND');
    return row;
  }

  async function checkedDetail(scope: Scope, row: DecisionRow) {
    await store.repairAudit(row);
    return detail(scope, row);
  }

  async function freshEvidence(scope: Scope, stored: FrozenPayload) {
    const evidence = await deps.evidence(scope, stored.evidence.runId);
    if (!sameTarget(scope, stored) || canonicalJson(evidence.data) !== canonicalJson(stored.evidence)) {
      throw new DecisionFailure('STALE_INPUT');
    }
  }

  async function validateCreateTarget(scope: Scope) {
    const project = await scope.jira.assertCorrectiveCreateTarget(scope.target.issueTypeId);
    if (project.key !== scope.target.projectKey || project.id !== scope.jiraProjectId) throw new DecisionFailure('STALE_INPUT');
  }

  function invoke<T>(operation: Operation, apply: (request: Request) => Promise<T>) {
    return async (request: Request): Promise<DecisionsResult<T>> => {
      const requestId = randomUUID();
      try {
        return { ok: true, data: await apply(request), requestId };
      } catch (error) {
        if (error instanceof NeedsAuthenticationError) throw error;
        const sourceCode = error instanceof Error && 'code' in error ? error.code : undefined;
        const code: FailureCode = error instanceof DecisionFailure ? error.code
          : sourceCode === 'FORBIDDEN' || sourceCode === 'AUTH_REQUIRED' || sourceCode === 'CONFLICT' ? sourceCode
            : sourceCode === 'STALE_INPUT' || sourceCode === 'NOT_FOUND' || sourceCode === 'RUN_NOT_READY' ? 'STALE_INPUT'
              : 'UNAVAILABLE';
        console.info(JSON.stringify({ requestId, operation, code }));
        return { ok: false, error: { code, message: messages[code], retryable: code === 'UNAVAILABLE' || code === 'SCHEMA_PENDING' }, requestId };
      }
    };
  }

  function applyReview(operation: typeof DECISIONS_APPROVE | typeof DECISIONS_REJECT) {
    return invoke(operation, async (request) => {
      const fields = parse(request.payload, [...referenceFields, 'reason']);
      const reason = text(fields.reason, 400);
      const { scope, row, stored } = await confirm(request.context, fields);
      if (!scope.roles.includes('APPROVER') || row.proposed_by === scope.actor) throw new DecisionFailure('FORBIDDEN');
      if (row.status !== 'PROPOSED') throw new DecisionFailure('CONFLICT');
      if (approvalExpired(row, deps.now())) throw new DecisionFailure('STALE_INPUT');
      await freshEvidence(scope, stored);
      const updated = await store.reviewDecision({ projectId: scope.projectId, decisionId: row.id, actor: scope.actor,
        revision: row.revision, payloadHash: row.payload_hash, approve: operation === DECISIONS_APPROVE, reason });
      if (!updated) throw new DecisionFailure('CONFLICT');
      return detail(scope, await get(scope, row.id));
    });
  }

  async function confirm(context: unknown, fields: Record<string, unknown>) {
    const id = identifier(fields.decisionId);
    if (fields.confirmed !== true || !Number.isSafeInteger(fields.expectedRevision) ||
        typeof fields.expectedHash !== 'string' || !digest.test(fields.expectedHash)) throw new DecisionFailure('INVALID_REQUEST');
    const scope = await deps.authorize(context);
    const row = await get(scope, id);
    if (row.payload_hash !== fields.expectedHash || row.revision !== fields.expectedRevision) throw new DecisionFailure('CONFLICT');
    return { scope, row, stored: readPayload(row, scope.jiraProjectId) };
  }

  return {
    [DECISIONS_LIST]: invoke(DECISIONS_LIST, async (request) => {
      parse(request.payload, []);
      const scope = await deps.authorize(request.context);
      return (await store.listDecisions(scope.projectId)).map((row) => card(scope, row));
    }),
    [DECISIONS_GET]: invoke(DECISIONS_GET, async (request) => {
      const id = identifier(parse(request.payload, ['decisionId']).decisionId);
      const scope = await deps.authorize(request.context);
      return checkedDetail(scope, await get(scope, id));
    }),
    [DECISIONS_PREPARE]: invoke(DECISIONS_PREPARE, async (request): Promise<DecisionDraft> => {
      const runId = identifier(parse(request.payload, ['runId']).runId);
      const scope = await deps.authorize(request.context);
      if (!scope.roles.includes('PLANNER')) throw new DecisionFailure('FORBIDDEN');
      const { data } = await deps.evidence(scope, runId);
      await validateCreateTarget(scope);
      return { summary: 'Evaluar mitigación del atraso A-17',
        description: 'Validar la disponibilidad y compatibilidad del suministro alternativo de A-17. Confirmar con Logística y Montaje el impacto previsto, el costo y la capacidad antes de adoptar el plan.',
        evidence: data, target: scope.target };
    }),
    [DECISIONS_PROPOSE]: invoke(DECISIONS_PROPOSE, async (request) => {
      const proposal = parse(request.payload, ['runId', 'summary', 'description', 'idempotencyKey', 'expectedResultHash',
        'expectedIssueTypeId', 'expectedProjectKey']);
      const runId = identifier(proposal.runId);
      const summary = text(proposal.summary, 120);
      const description = text(proposal.description, 2_000, true);
      const idempotencyKey = identifier(proposal.idempotencyKey);
      const scope = await deps.authorize(request.context);
      if (!scope.roles.includes('PLANNER')) throw new DecisionFailure('FORBIDDEN');
      const { data: evidence, expiresAt } = await deps.evidence(scope, runId);
      if (proposal.expectedResultHash !== evidence.resultHash || proposal.expectedIssueTypeId !== scope.target.issueTypeId ||
          proposal.expectedProjectKey !== scope.target.projectKey) throw new DecisionFailure('STALE_INPUT');
      await validateCreateTarget(scope);
      const material = { summary, description: closeEvidence(description, evidence), evidence, target: scope.target, jiraProjectId: scope.jiraProjectId };
      const id = randomUUID();
      const marker = `ctx-decision-${id}`;
      const payloadJcs = canonicalJson({ ...material, marker });
      const { row } = await store.proposeDecision({ id, projectId: scope.projectId, proposedBy: scope.actor,
        actionCode: 'A17_SUPPLY_MITIGATION', payloadJcs, payloadHash: sha256(payloadJcs), correlationKey: marker,
        idempotencyKey, requestHash: sha256(canonicalJson(material)), expiresAt });
      return detail(scope, row);
    }),
    [DECISIONS_APPROVE]: applyReview(DECISIONS_APPROVE),
    [DECISIONS_REJECT]: applyReview(DECISIONS_REJECT),
    [DECISIONS_EXECUTE]: invoke(DECISIONS_EXECUTE, async (request) => {
      const fields = parse(request.payload, [...referenceFields, 'expectedAttempt']);
      const { expectedAttempt } = fields;
      if (typeof expectedAttempt !== 'number' || !Number.isSafeInteger(expectedAttempt) || expectedAttempt < 0) {
        throw new DecisionFailure('INVALID_REQUEST');
      }
      const { scope, row, stored } = await confirm(request.context, fields);
      if (row.proposed_by !== scope.actor || !scope.roles.includes('PLANNER')) throw new DecisionFailure('FORBIDDEN');
      if (row.attempt_count !== expectedAttempt || !executability(row, statusOf(row, deps.now()))) throw new DecisionFailure('CONFLICT');
      await freshEvidence(scope, stored);
      const reservation = await store.reserveExecution({ projectId: scope.projectId, decisionId: row.id,
        actor: scope.actor, revision: row.revision, payloadHash: row.payload_hash, expectedAttempt });
      if (!reservation?.execution_token) throw new DecisionFailure('CONFLICT');
      const attempt = { projectId: scope.projectId, decisionId: row.id, actor: scope.actor, token: reservation.execution_token };

      let issue: Awaited<ReturnType<DecisionJira['createCorrectiveIssue']>> | undefined;
      try {
        issue = await scope.jira.createCorrectiveIssue(corrective(stored));
      } catch (error) {
        const definite = error instanceof JiraBoundaryError && error.code !== 'RECONCILIATION_REQUIRED';
        await store.failExecution({ ...attempt, failureClass: definite ? 'DEFINITE' : 'UNCERTAIN',
          errorCode: definite ? error.code : 'RECONCILIATION_REQUIRED' });
      }
      if (issue) await store.finishExecution({ ...attempt, issueId: issue.id, issueKey: issue.key });
      return detail(scope, await get(scope, row.id));
    }),
    [DECISIONS_RECONCILE]: invoke(DECISIONS_RECONCILE, async (request) => {
      const { scope, row, stored } = await confirm(request.context, parse(request.payload, referenceFields));
      if (row.proposed_by !== scope.actor || !scope.roles.includes('PLANNER')) throw new DecisionFailure('FORBIDDEN');
      if (!row.execution_token || statusOf(row, deps.now()) !== 'RECONCILIATION_REQUIRED') throw new DecisionFailure('CONFLICT');
      if (row.status === 'EXECUTING') await store.markStaleExecution(scope.projectId, row.id);
      const issue = await scope.jira.findCorrectiveByMarker(corrective(stored));
      if (issue) await store.finishReconciliation({ projectId: scope.projectId, decisionId: row.id, actor: scope.actor,
        token: row.execution_token, issueId: issue.id, issueKey: issue.key });
      return detail(scope, await get(scope, row.id));
    }),
  };
}
