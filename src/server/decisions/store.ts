import { randomUUID } from 'node:crypto';
import type { UpdateQueryResponse } from '@forge/sql';
import { canonicalJson, sha256 } from '../../domain/futuros/digest';
import { isIssueKey, isJiraId } from '../data/jira/normalize';
import { executeSql, type SqlParameter } from '../data/sql/client';

export const STALE_EXECUTION_MS = 90_000;
const approvalSeconds = 24 * 60 * 60;
const maxPayloadBytes = 32 * 1024;
const decisionLimit = 20;
const auditLimit = 40;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const codePattern = /^[A-Z][A-Z0-9_]{0,47}$/;
const actorPattern = /^[^\s\p{Cc}]{1,128}$/u;

export type DecisionStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'EXECUTING' | 'APPLIED' | 'FAILED' | 'RECONCILIATION_REQUIRED';
type FailureClass = 'DEFINITE' | 'UNCERTAIN';

export type DecisionRow = {
  id: string; project_id: string; recommendation_id: string | null; supersedes_id: string | null;
  revision: number; status: DecisionStatus; proposed_by: string; approved_by: string | null;
  executor_id: string | null; reviewed_by: string | null; review_reason: string | null; reconciled_by: string | null;
  proposed_at: string; reviewed_at: string | null; approved_at: string | null; expires_at: string | null;
  action_code: string; payload_jcs: string; payload_hash: string; approved_revision: number | null;
  approved_payload_hash: string | null; correlation_key: string; execution_token: string | null;
  attempt_count: number; execution_started_at: string | null; execution_finished_at: string | null; applied_at: string | null;
  external_issue_id: string | null; external_issue_key: string | null; last_error_code: string | null;
  failure_class: FailureClass | null; idempotency_key: string; request_hash: string; updated_at: string;
};

export type DecisionAuditRow = {
  id: string; actor_kind: 'USER' | 'SYSTEM'; actor_account_id: string | null; origin: 'UI' | 'SYSTEM';
  event_type: string; entity_version: string; occurred_at: string; outcome: string; error_code: string | null;
  before_hash: string | null; after_hash: string | null; metadata_jcs: string;
};

export type NewDecision = {
  id: string; projectId: string; proposedBy: string; actionCode: string; payloadJcs: string; payloadHash: string;
  correlationKey: string; idempotencyKey: string; requestHash: string; expiresAt: string;
  recommendationId?: string; supersedesId?: string;
};

type DecisionRef = { projectId: string; decisionId: string; actor: string; revision: number; payloadHash: string };
type ExecutionRef = Pick<DecisionRef, 'projectId' | 'decisionId' | 'actor'> & { token: string };
type IssueRef = ExecutionRef & { issueId: string; issueKey: string };

export class DecisionStoreError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'CONFLICT' | 'FORBIDDEN' | 'UNAVAILABLE') {
    super(code);
    this.name = 'DecisionStoreError';
  }
}

const decisionColumns = `id, project_id, recommendation_id, supersedes_id, revision, status, proposed_by, approved_by,
  executor_id, reviewed_by, review_reason, reconciled_by,
  CAST(proposed_at AS CHAR) AS proposed_at, CAST(reviewed_at AS CHAR) AS reviewed_at,
  CAST(approved_at AS CHAR) AS approved_at, CAST(expires_at AS CHAR) AS expires_at,
  action_code, payload_jcs, payload_hash, approved_revision, approved_payload_hash, correlation_key, execution_token,
  attempt_count, CAST(execution_started_at AS CHAR) AS execution_started_at,
  CAST(execution_finished_at AS CHAR) AS execution_finished_at, CAST(applied_at AS CHAR) AS applied_at,
  external_issue_id, external_issue_key, last_error_code, failure_class, idempotency_key, request_hash,
  CAST(updated_at AS CHAR) AS updated_at`;

function utc(value: string): string;
function utc(value: string | null): string | null;
function utc(value: string | null) {
  if (value === null) return null;
  const timestamp = value.replace(' ', 'T');
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ? timestamp : timestamp + 'Z').toISOString();
}

function sqlTimestamp(iso: string) {
  return utc(iso).replace('T', ' ').slice(0, -1);
}

function asDecision(row: DecisionRow): DecisionRow {
  return {
    ...row, proposed_at: utc(row.proposed_at), reviewed_at: utc(row.reviewed_at), approved_at: utc(row.approved_at),
    expires_at: utc(row.expires_at), execution_started_at: utc(row.execution_started_at),
    execution_finished_at: utc(row.execution_finished_at), applied_at: utc(row.applied_at), updated_at: utc(row.updated_at),
  };
}

type AuditKind = 'proposed' | 'approved' | 'rejected' | 'execution_reserved' | 'execution_failed' |
  'reconciliation_required' | 'reconciled' | 'applied';

type AuditEvent = {
  kind: AuditKind;
  actor: string | null;
  occurredAt: string;
  attempt: number;
  outcome: 'RECORDED' | 'SUCCEEDED' | 'REJECTED' | 'FAILED' | 'UNCERTAIN';
  error?: string | null;
  issue?: { id: string; key: string };
};

function auditId(decisionId: string, revision: number, kind: AuditKind, attempt: number) {
  const hash = sha256(canonicalJson([decisionId, revision, kind, attempt]));
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function auditEvents(row: DecisionRow): AuditEvent[] {
  const events: AuditEvent[] = [{ kind: 'proposed', actor: row.proposed_by, occurredAt: row.proposed_at, attempt: 0, outcome: 'RECORDED' }];
  if (row.reviewed_by && row.reviewed_at) {
    events.push({ kind: row.approved_by ? 'approved' : 'rejected', actor: row.reviewed_by, occurredAt: row.reviewed_at,
      attempt: 0, outcome: row.approved_by ? 'SUCCEEDED' : 'REJECTED' });
  }
  const attempt = row.attempt_count;
  if (row.execution_started_at && row.executor_id) {
    events.push({ kind: 'execution_reserved', actor: row.executor_id, occurredAt: row.execution_started_at, attempt, outcome: 'RECORDED' });
  }
  if (row.execution_finished_at && row.failure_class) {
    const uncertain = row.failure_class === 'UNCERTAIN';
    events.push({ kind: uncertain ? 'reconciliation_required' : 'execution_failed',
      actor: row.last_error_code === 'EXECUTION_STALE' ? null : row.executor_id,
      occurredAt: row.execution_finished_at, attempt, outcome: uncertain ? 'UNCERTAIN' : 'FAILED', error: row.last_error_code });
  }
  if (row.applied_at && row.external_issue_id && row.external_issue_key) {
    const issue = { id: row.external_issue_id, key: row.external_issue_key };
    if (row.reconciled_by) events.push({
      kind: 'reconciled', actor: row.reconciled_by, occurredAt: row.applied_at, attempt, outcome: 'SUCCEEDED', issue,
    });
    events.push({ kind: 'applied', actor: row.reconciled_by ?? row.executor_id, occurredAt: row.applied_at,
      attempt, outcome: 'SUCCEEDED', issue });
  }
  return events;
}

const scopedReference = 'id = ? AND project_id = ? AND revision = ? AND payload_hash = ?';
const executionReference = 'id = ? AND project_id = ? AND execution_token = ? AND proposed_by = ? AND executor_id = ?';
const activeProject = `EXISTS (SELECT 1 FROM ctx_project p WHERE p.id = ctx_decision.project_id
  AND p.status = 'ACTIVE' AND p.data_mode = 'DEMO')`;
const planner = `EXISTS (SELECT 1 FROM ctx_project_role r WHERE r.project_id = ctx_decision.project_id
  AND r.account_id = ctx_decision.proposed_by AND r.role_code = 'PLANNER' AND r.revoked_at IS NULL)`;
const retainedApproval = `approved_by IS NOT NULL AND approved_by <> proposed_by AND approved_at IS NOT NULL
  AND approved_revision = revision AND approved_payload_hash = payload_hash AND expires_at > UTC_TIMESTAMP(3)
  AND EXISTS (SELECT 1 FROM ctx_project_role r WHERE r.project_id = ctx_decision.project_id
    AND r.account_id = ctx_decision.approved_by AND r.role_code = 'APPROVER' AND r.revoked_at IS NULL)`;

function referenceValues(ref: DecisionRef): SqlParameter[] {
  return [ref.decisionId, ref.projectId, ref.revision, ref.payloadHash];
}

function executionValues(ref: ExecutionRef): SqlParameter[] {
  return [ref.decisionId, ref.projectId, ref.token, ref.actor, ref.actor];
}

export function createDecisionStore(query: typeof executeSql = executeSql) {
  async function updateOne(statement: string, parameters: readonly SqlParameter[]): Promise<boolean> {
    const result = await query<UpdateQueryResponse>(statement, parameters);
    if (result.affectedRows !== 0 && result.affectedRows !== 1) throw new DecisionStoreError('UNAVAILABLE');
    return result.affectedRows === 1;
  }

  async function getDecision(projectId: string, decisionId: string): Promise<DecisionRow | undefined> {
    const [row] = await query<DecisionRow>(
      `SELECT ${decisionColumns} FROM ctx_decision WHERE project_id = ? AND id = ?`, [projectId, decisionId],
    );
    return row ? asDecision(row) : undefined;
  }

  async function listDecisions(projectId: string, status?: DecisionStatus): Promise<DecisionRow[]> {
    const rows = await query<DecisionRow>(
      `SELECT ${decisionColumns} FROM ctx_decision WHERE project_id = ? AND (? IS NULL OR status = ?)
       ORDER BY updated_at DESC, id DESC LIMIT ${decisionLimit}`, [projectId, status ?? null, status ?? null],
    );
    return rows.map(asDecision);
  }

  async function repairAudit(row: DecisionRow): Promise<void> {
    for (const event of auditEvents(row)) {
      const actorKind = event.actor === null ? 'SYSTEM' : 'USER';
      const origin = event.actor === null ? 'SYSTEM' : 'UI';
      await query<UpdateQueryResponse>(
        `INSERT INTO ctx_audit_log (id, project_id, actor_kind, actor_account_id, origin, access_class, event_type,
          entity_kind, entity_id, entity_version, occurred_at, correlation_id, outcome, error_code,
          before_hash, after_hash, metadata_jcs)
         VALUES (?, ?, ?, ?, ?, 'PROJECT', ?, 'DECISION', ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = ctx_audit_log.id`,
        [auditId(row.id, row.revision, event.kind, event.attempt), row.project_id, actorKind, event.actor, origin,
          `decision.${event.kind}`, row.id, String(row.revision), sqlTimestamp(event.occurredAt), row.correlation_key,
          event.outcome, event.error ?? null, event.kind === 'proposed' ? null : row.payload_hash,
          row.payload_hash, canonicalJson({ attempt: event.attempt, ...(event.issue ? { issue: event.issue } : {}) })],
      );
    }
  }

  async function repairCurrent(projectId: string, decisionId: string): Promise<DecisionRow> {
    const row = await getDecision(projectId, decisionId);
    if (!row) throw new DecisionStoreError('UNAVAILABLE');
    await repairAudit(row);
    return row;
  }

  async function listAudit(projectId: string, decisionId: string): Promise<DecisionAuditRow[]> {
    const rows = await query<DecisionAuditRow>(
      `SELECT id, actor_kind, actor_account_id, origin, event_type, entity_version, CAST(occurred_at AS CHAR) AS occurred_at,
              outcome, error_code, before_hash, after_hash, metadata_jcs
       FROM ctx_audit_log WHERE project_id = ? AND entity_kind = 'DECISION' AND entity_id = ?
       ORDER BY occurred_at, id LIMIT ${auditLimit}`, [projectId, decisionId],
    );
    return rows.map((row) => ({ ...row, occurred_at: utc(row.occurred_at) }));
  }

  async function proposeDecision(input: NewDecision): Promise<{ row: DecisionRow; created: boolean }> {
    if (!uuidPattern.test(input.id) || !uuidPattern.test(input.projectId) || !actorPattern.test(input.proposedBy) ||
        !codePattern.test(input.actionCode) || !hashPattern.test(input.requestHash) ||
        !/^ctx-decision-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.correlationKey) ||
        !/^[A-Za-z0-9_-]{8,80}$/.test(input.idempotencyKey) ||
        Buffer.byteLength(input.payloadJcs, 'utf8') > maxPayloadBytes || sha256(input.payloadJcs) !== input.payloadHash ||
        !Number.isFinite(Date.parse(input.expiresAt)) || (input.supersedesId !== undefined && input.supersedesId === input.id)) {
      throw new DecisionStoreError('INVALID_REQUEST');
    }

    const recommendation = input.recommendationId ?? null;
    const supersedes = input.supersedesId ?? null;
    const expires = sqlTimestamp(input.expiresAt);
    await query<UpdateQueryResponse>(
      `INSERT INTO ctx_decision (id, project_id, recommendation_id, supersedes_id, revision, status, proposed_by,
        proposed_at, expires_at, action_code, payload_jcs, payload_hash, correlation_key, idempotency_key, request_hash, updated_at)
       SELECT ?, p.id, ?, ?, 1, 'PROPOSED', r.account_id, UTC_TIMESTAMP(3), ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3)
       FROM ctx_project p INNER JOIN ctx_project_role r ON r.project_id = p.id
       WHERE p.id = ? AND p.status = 'ACTIVE' AND p.data_mode = 'DEMO' AND r.account_id = ?
         AND r.role_code = 'PLANNER' AND r.revoked_at IS NULL AND ? > UTC_TIMESTAMP(3)
         AND (? IS NULL OR EXISTS (SELECT 1 FROM ctx_recommendation recommendation
           WHERE recommendation.id = ? AND recommendation.project_id = p.id))
         AND (? IS NULL OR EXISTS (SELECT 1 FROM ctx_decision prior
           WHERE prior.id = ? AND prior.project_id = p.id AND prior.proposed_by = r.account_id))
       ON DUPLICATE KEY UPDATE id = ctx_decision.id`,
      [input.id, recommendation, supersedes, expires, input.actionCode, input.payloadJcs, input.payloadHash, input.correlationKey,
        input.idempotencyKey, input.requestHash, input.projectId, input.proposedBy, expires, recommendation, recommendation,
        supersedes, supersedes],
    );
    const [row] = await query<DecisionRow>(
      `SELECT ${decisionColumns} FROM ctx_decision WHERE project_id = ? AND proposed_by = ? AND idempotency_key = ?
       AND ${activeProject} AND ${planner}`, [input.projectId, input.proposedBy, input.idempotencyKey],
    );
    if (!row) throw new DecisionStoreError('FORBIDDEN');
    if (row.request_hash !== input.requestHash) throw new DecisionStoreError('CONFLICT');
    const decision = asDecision(row);
    await repairAudit(decision);
    return { row: decision, created: decision.id === input.id };
  }

  async function reviewDecision(input: DecisionRef & { approve: boolean; reason: string }): Promise<boolean> {
    if (typeof input.approve !== 'boolean' || input.reason.length < 1 || input.reason.length > 500) {
      throw new DecisionStoreError('INVALID_REQUEST');
    }
    const status = input.approve ? 'APPROVED' : 'REJECTED';
    const changed = await updateOne(
      `UPDATE ctx_decision SET status = ?, reviewed_by = ?, review_reason = ?, reviewed_at = UTC_TIMESTAMP(3),
        approved_by = CASE WHEN ? THEN ? ELSE NULL END, approved_at = CASE WHEN ? THEN UTC_TIMESTAMP(3) ELSE NULL END,
        approved_revision = CASE WHEN ? THEN revision ELSE NULL END,
        approved_payload_hash = CASE WHEN ? THEN payload_hash ELSE NULL END,
        expires_at = CASE WHEN ? THEN LEAST(expires_at, TIMESTAMPADD(SECOND, ${approvalSeconds}, UTC_TIMESTAMP(3))) ELSE expires_at END,
        updated_at = UTC_TIMESTAMP(3)
       WHERE ${scopedReference} AND status = 'PROPOSED' AND proposed_by <> ? AND expires_at > UTC_TIMESTAMP(3)
         AND ${activeProject} AND EXISTS (SELECT 1 FROM ctx_project_role r WHERE r.project_id = ctx_decision.project_id
           AND r.account_id = ? AND r.role_code = 'APPROVER' AND r.revoked_at IS NULL)`,
      [status, input.actor, input.reason, input.approve, input.actor, input.approve, input.approve, input.approve, input.approve,
        ...referenceValues(input), input.actor, input.actor],
    );
    if (changed) await repairCurrent(input.projectId, input.decisionId);
    return changed;
  }

  async function reserveExecution(input: DecisionRef & { expectedAttempt: number }): Promise<DecisionRow | undefined> {
    if (!Number.isSafeInteger(input.expectedAttempt) || input.expectedAttempt < 0) {
      throw new DecisionStoreError('INVALID_REQUEST');
    }
    const prior = await getDecision(input.projectId, input.decisionId);
    if (!prior || prior.proposed_by !== input.actor || prior.revision !== input.revision || prior.payload_hash !== input.payloadHash ||
        prior.attempt_count !== input.expectedAttempt ||
        (prior.status !== 'APPROVED' && (prior.status !== 'FAILED' || prior.failure_class !== 'DEFINITE'))) return;
    const priorFailureEventId = prior.status === 'FAILED'
      ? auditId(prior.id, prior.revision, 'execution_failed', prior.attempt_count) : null;
    if (priorFailureEventId) await repairAudit(prior);
    const token = randomUUID();
    const changed = await updateOne(
      `UPDATE ctx_decision SET status = 'EXECUTING', executor_id = proposed_by, execution_token = ?,
        attempt_count = attempt_count + 1, execution_started_at = UTC_TIMESTAMP(3), execution_finished_at = NULL,
        last_error_code = NULL, failure_class = NULL, updated_at = UTC_TIMESTAMP(3)
       WHERE ${scopedReference} AND proposed_by = ? AND attempt_count = ? AND ${activeProject} AND ${planner} AND ${retainedApproval}
         AND ((status = 'APPROVED' AND attempt_count = 0) OR (status = 'FAILED' AND attempt_count > 0 AND failure_class = 'DEFINITE'
           AND EXISTS (SELECT 1 FROM ctx_audit_log audit WHERE audit.id = ? AND audit.project_id = ctx_decision.project_id
             AND audit.entity_id = ctx_decision.id AND audit.event_type = 'decision.execution_failed')))`,
      [token, ...referenceValues(input), input.actor, input.expectedAttempt, priorFailureEventId],
    );
    if (!changed) return;
    const reserved = await repairCurrent(input.projectId, input.decisionId);
    return reserved.status === 'EXECUTING' && reserved.execution_token === token ? reserved : undefined;
  }

  async function failExecution(input: ExecutionRef & { failureClass: FailureClass; errorCode: string }): Promise<boolean> {
    if (!codePattern.test(input.errorCode) || !['DEFINITE', 'UNCERTAIN'].includes(input.failureClass)) {
      throw new DecisionStoreError('INVALID_REQUEST');
    }
    const changed = await updateOne(
      `UPDATE ctx_decision SET status = ?, failure_class = ?, last_error_code = ?, execution_finished_at = UTC_TIMESTAMP(3),
        updated_at = UTC_TIMESTAMP(3) WHERE ${executionReference} AND status = 'EXECUTING'`,
      [input.failureClass === 'DEFINITE' ? 'FAILED' : 'RECONCILIATION_REQUIRED', input.failureClass,
        input.errorCode, ...executionValues(input)],
    );
    if (changed) await repairCurrent(input.projectId, input.decisionId);
    return changed;
  }

  async function markStaleExecution(projectId: string, decisionId: string): Promise<boolean> {
    const seconds = STALE_EXECUTION_MS / 1000;
    const changed = await updateOne(
      `UPDATE ctx_decision SET status = 'RECONCILIATION_REQUIRED', failure_class = 'UNCERTAIN',
        last_error_code = 'EXECUTION_STALE', execution_finished_at = UTC_TIMESTAMP(3), updated_at = UTC_TIMESTAMP(3)
       WHERE project_id = ? AND id = ? AND status = 'EXECUTING'
         AND execution_started_at <= TIMESTAMPADD(SECOND, -${seconds}, UTC_TIMESTAMP(3))`,
      [projectId, decisionId],
    );
    if (changed) await repairCurrent(projectId, decisionId);
    return changed;
  }

  async function finish(input: IssueRef, reconciled: boolean): Promise<boolean> {
    if (!isJiraId(input.issueId) || !isIssueKey(input.issueKey) || input.issueKey.length > 40) {
      throw new DecisionStoreError('INVALID_REQUEST');
    }
    const changed = await updateOne(
      `UPDATE ctx_decision SET status = 'APPLIED', external_issue_id = ?, external_issue_key = ?, applied_at = UTC_TIMESTAMP(3),
        reconciled_by = ?, execution_finished_at = COALESCE(execution_finished_at, UTC_TIMESTAMP(3)), updated_at = UTC_TIMESTAMP(3)
       WHERE ${executionReference} AND status = ?${reconciled ? ` AND ${activeProject} AND ${planner}` : ''}`,
      [input.issueId, input.issueKey, reconciled ? input.actor : null, ...executionValues(input),
        reconciled ? 'RECONCILIATION_REQUIRED' : 'EXECUTING'],
    );
    if (changed) await repairCurrent(input.projectId, input.decisionId);
    return changed;
  }

  return {
    getDecision, listDecisions, proposeDecision, reviewDecision, reserveExecution, failExecution, markStaleExecution,
    finishExecution: (input: IssueRef) => finish(input, false), finishReconciliation: (input: IssueRef) => finish(input, true),
    repairAudit, listAudit,
  };
}

export const decisionStore = createDecisionStore();
