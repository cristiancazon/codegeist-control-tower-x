import { randomUUID } from 'node:crypto';
import { getAppContext, NeedsAuthenticationError } from '@forge/api';
import { validatePatagoniaFixture } from '../../../domain/fixtures/validate-patagonia';
import type { DemoProgress, DemoResponse } from '../../../shared/demo';
import {
  createForgeJiraProjectAdapter, fixtureMarker, JiraBoundaryError,
  type JiraProjectAdapter, type JiraTaskCreateMetadata,
} from '../jira';
import { enqueue as enqueueSchema } from '../migration-events';
import { isSchemaReady } from '../sql/migrations';
import { isConfiguredDemoProject, readDemoActor } from './demo-access';
import { demoProjectKey, fixture, fixtureHash } from './fixture';
import { enqueueFixturePublish } from './publish';
import { advanceFixtureReconciliation } from './reconciliation';
import {
  addProjectAdmin, claimTicket, isProjectAdmin, markImportStarted, pauseTicket, readImport,
  readTickets, recordTicketIdentity, reserveProject, type ImportRow, type TicketRow,
} from './store';

const projectId = fixture.project.id;
const batchSize = 4;
const reservationSeconds = 70;
type Task = (typeof fixture.workPackages)[number];
type Request = { payload?: unknown; context?: unknown };

class DemoError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function authorize(context: unknown) {
  const actor = readDemoActor(context);
  if (!actor) {
    throw new DemoError('AUTH_REQUIRED', 'Iniciá sesión en Jira para preparar la demostración.');
  }
  const jira = createForgeJiraProjectAdapter(context);
  if (!isConfiguredDemoProject(getAppContext(), jira.projectId, {
    cloudId: process.env.CTX_DEMO_CLOUD_ID,
    jiraProjectId: process.env.CTX_DEMO_JIRA_PROJECT_ID,
  })) {
    throw new DemoError('FORBIDDEN', 'La carga solo está habilitada para PED en el sitio Jira de demostración.');
  }
  await jira.assertBootstrapPermissions();
  const project = await jira.getProject();
  if (project.key !== demoProjectKey) {
    throw new DemoError('FORBIDDEN', 'La carga está disponible únicamente en el espacio de prueba PED.');
  }
  if (!await isSchemaReady()) {
    await enqueueSchema();
    throw new DemoError('SCHEMA_PENDING', 'Forge está preparando las tablas. Volvé a consultar en unos minutos.');
  }
  return { actor, jira, project };
}

function checkImport(row: ImportRow | undefined, actor: string) {
  if (row && (row.owner_account_id !== actor || row.fixture_hash !== fixtureHash)) {
    throw new DemoError('CONFLICT', 'Ya existe una carga del proyecto con otra identidad o versión.');
  }
}

function describe(row: ImportRow | undefined, tickets: TicketRow[], firstIssueKey?: string): DemoProgress {
  const done = tickets.filter((ticket) => ticket.state === 'DONE');
  let state: DemoProgress['state'] = 'NOT_STARTED';
  if (row) {
    state = 'IMPORTING';
    if (row.state === 'COMPLETE') {
      state = 'COMPLETE';
    } else if (tickets.some((ticket) => ticket.state === 'REVIEW')) {
      state = 'REVIEW';
    } else if (done.length === fixture.workPackages.length) {
      state = 'PUBLISHING';
    }
  }
  return {
    jiraProjectKey: demoProjectKey, fixtureName: fixture.project.name, fixtureHash,
    issuesTotal: fixture.workPackages.length, issuesMapped: done.length,
    phases: fixture.phases.length, assets: fixture.assets.length,
    contractors: fixture.contractors.length, historicalPeriods: 24,
    state, ...(firstIssueKey ? { firstIssueKey } : {}),
  };
}

async function readVisibleAnchor(jira: JiraProjectAdapter, tickets: TicketRow[]) {
  const anchor = tickets.find((ticket) => ticket.state === 'DONE' && ticket.task_code === 'WP-048');
  if (!anchor?.issue_id) {
    return undefined;
  }
  try {
    return (await jira.getWorkItem(anchor.issue_id)).key;
  } catch (error) {
    if (error instanceof NeedsAuthenticationError) {
      throw error;
    }
    if (!(error instanceof JiraBoundaryError)) {
      throw error;
    }
    return undefined;
  }
}

async function mapTask(
  jira: JiraProjectAdapter, actor: string, metadata: JiraTaskCreateMetadata, task: Task, current?: TicketRow,
) {
  const marker = fixtureMarker(task.code);
  const inDoubt = current?.state === 'CREATING' || current?.state === 'REVIEW';
  if (current?.state === 'CREATING' && current.age_seconds < reservationSeconds) {
    return false;
  }

  const match = await advanceFixtureReconciliation({ projectId, actorAccountId: actor, jira, marker });
  if (match.status === 'CONFLICT') {
    throw new DemoError('RECONCILIATION_REQUIRED', 'Encontré un Jira ítem incompatible con la referencia del fixture.');
  }
  if (match.status === 'FOUND') {
    const item = await jira.getWorkItem(match.issue.id);
    if (item.summary !== task.title || item.issueTypeId !== metadata.issueTypeId || !item.labels.includes(marker)) {
      throw new DemoError('RECONCILIATION_REQUIRED', 'El ítem vinculado no coincide con el título o tipo del fixture.');
    }
  }
  if (match.status === 'PENDING') {
    return false;
  }
  if (inDoubt && match.status !== 'FOUND') {
    await pauseTicket(projectId, task.code, current.attempt_id, 'REVIEW');
    return false;
  }

  const attempt = inDoubt ? current.attempt_id : randomUUID();
  if (!inDoubt && !await claimTicket(projectId, task.code, marker, attempt)) {
    return false;
  }
  if (match.status === 'FOUND') {
    await recordTicketIdentity(projectId, task.code, attempt, match.issue);
    return true;
  }

  let issue;
  try {
    issue = await jira.createFixtureTask({
      issueTypeId: metadata.issueTypeId, marker, summary: task.title,
      description: [
        'Registro sintético de Patagonia Energy Development.',
        task.businessCode ? `Referencia: ${task.businessCode}` : `Referencia: ${task.code}`,
        `Estado de planificación: ${task.status === 'DONE' ? 'finalizado' : 'pendiente'}.`,
        `Ventana de planificación: ${task.plannedStart} a ${task.plannedFinish}.`,
      ].join('\n'),
      ...(metadata.supportsDueDate ? { dueDate: task.plannedFinish } : {}),
    });
  } catch (error) {
    if (error instanceof NeedsAuthenticationError) {
      await pauseTicket(projectId, task.code, attempt, 'RETRY');
      throw error;
    }
    const uncertain = !(error instanceof JiraBoundaryError) || error.code === 'RECONCILIATION_REQUIRED';
    const retryAfterSeconds = error instanceof JiraBoundaryError && error.code === 'RATE_LIMITED'
      ? error.retryAfterSeconds ?? 5 : undefined;
    await pauseTicket(projectId, task.code, attempt, uncertain ? 'REVIEW' : 'RETRY', retryAfterSeconds);
    throw error;
  }
  await recordTicketIdentity(projectId, task.code, attempt, issue);
  return true;
}

async function preview(request: Request): Promise<DemoProgress> {
  const { payload, context } = request;
  if (payload !== undefined && (!isRecord(payload) || Reflect.ownKeys(payload).length !== 0)) {
    throw new DemoError('VALIDATION_ERROR', 'La vista previa no admite parámetros.');
  }
  const { actor, jira, project } = await authorize(context);
  const current = await readImport(projectId, project.id);
  checkImport(current, actor);
  if (current && current.state !== 'LOADING' && !await isProjectAdmin(projectId, actor)) {
    throw new DemoError('FORBIDDEN', 'La cuenta perdió el rol de administración de la aplicación.');
  }
  await jira.getTaskCreateMetadata();
  // A full fixture is validated prior to offering confirmation of an import.
  validatePatagoniaFixture(fixture);
  const tickets = current ? await readTickets(projectId) : [];
  return describe(current, tickets, await readVisibleAnchor(jira, tickets));
}

async function apply(request: Request): Promise<DemoProgress> {
  const { payload, context } = request;
  if (!isRecord(payload) || Reflect.ownKeys(payload).length !== 1 || payload.fixtureHash !== fixtureHash) {
    throw new DemoError('VALIDATION_ERROR', 'Revisá y confirmá la vista previa vigente antes de cargar.');
  }
  const { actor, jira, project } = await authorize(context);
  let current = await readImport(projectId, project.id);
  if (!current || current.state === 'LOADING') {
    validatePatagoniaFixture(fixture);
    current = await reserveProject(fixture, project, actor, fixtureHash);
    checkImport(current, actor);
    if (!current) {
      throw new DemoError('CONFLICT', 'El espacio Jira ya está vinculado a un proyecto incompatible.');
    }
    await addProjectAdmin(projectId, actor);
  }
  checkImport(current, actor);
  if (!await isProjectAdmin(projectId, actor)) {
    throw new DemoError('FORBIDDEN', 'La cuenta necesita el rol de administración de la aplicación.');
  }
  if (current.state === 'LOADING') {
    await markImportStarted(projectId, actor);
    current = { ...current, state: 'IMPORTING' };
  }
  const existing = await readTickets(projectId);
  if (current.state === 'COMPLETE') {
    return describe(current, existing, await readVisibleAnchor(jira, existing));
  }
  const byCode = new Map(existing.map((ticket) => [ticket.task_code, ticket]));
  const remaining = fixture.workPackages.filter((task) => byCode.get(task.code)?.state !== 'DONE');
  if (remaining.length) {
    const metadata = await jira.getTaskCreateMetadata();
    for (const task of remaining.slice(0, batchSize)) {
      if (!await mapTask(jira, actor, metadata, task, byCode.get(task.code))) {
        break;
      }
    }
  }
  const result = describe(current, await readTickets(projectId));
  if (result.state === 'PUBLISHING') {
    await enqueueFixturePublish(project.id);
  }
  return result;
}

async function safe(handle: () => Promise<DemoProgress>): Promise<DemoResponse> {
  try {
    return { ok: true, data: await handle() };
  } catch (error) {
    if (error instanceof NeedsAuthenticationError) {
      throw error;
    }
    if (error instanceof JiraBoundaryError) {
      const retryAfterSeconds = error.code === 'RATE_LIMITED' ? error.retryAfterSeconds ?? 5 : undefined;
      return { ok: false, error: {
        code: error.code, message: error.message,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      } };
    }
    if (error instanceof DemoError) {
      return { ok: false, error: { code: error.code, message: error.message } };
    }
    console.error(JSON.stringify({ operation: 'demo.bootstrap', code: 'UNAVAILABLE' }));
    return { ok: false, error: { code: 'UNAVAILABLE', message: 'No se pudo preparar la carga. Revisá el estado y volvé a intentar.' } };
  }
}

export const previewDemo = (request: Request) => safe(() => preview(request));
export const applyDemo = (request: Request) => safe(() => apply(request));
