import { randomBytes, randomUUID } from 'node:crypto';
import { getAppContext, NeedsAuthenticationError } from '@forge/api';
import { canonicalJson, inputDigest, sha256 } from '../../domain/futuros/digest';
import { EngineValidationError, prepareEngine } from '../../domain/futuros/engine';
import { compareSamples, StatisticsError, type StatisticsSummary } from '../../domain/futuros/statistics';
import {
  FUTUROS_CANCEL, FUTUROS_COMPARE, FUTUROS_GRANT, FUTUROS_RETRY, FUTUROS_RUN, FUTUROS_SCENARIOS, FUTUROS_START,
  type FuturosCatalog, type FuturosComparison, type FuturosFailure, type FuturosResponse, type FuturosRun,
  type FuturosRunCard,
} from '../../shared/futuros';
import { isConfiguredDemoProject, readDemoActor } from '../data/bootstrap/demo-access';
import { fixture } from '../data/bootstrap/fixture';
import { createForgeJiraProjectAdapter, JiraBoundaryError } from '../data/jira';
import { executeSql } from '../data/sql/client';
import { getProjectAccess } from '../data/sql/projects';
import { readVisibleJiraIssues } from '../overview/resolvers';
import type { RunRecord } from './run-store';
import { futurosRunStore, futurosWorker, loadFuturosRunInput } from './runtime';
import { readRunSamples, type FuturosResultManifest } from './worker';
import { confirmFuturosVisibility, listFuturosScenarios, loadFuturosSnapshot, SnapshotFailure } from './snapshot';

type Request = { payload?: unknown; context?: unknown };
type Operation =
  | typeof FUTUROS_SCENARIOS | typeof FUTUROS_START | typeof FUTUROS_RUN | typeof FUTUROS_CANCEL
  | typeof FUTUROS_COMPARE | typeof FUTUROS_GRANT | typeof FUTUROS_RETRY;
const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const seedPattern = /^[0-9a-f]{32}$/;
const messages: Record<FuturosFailure, string> = {
  AUTH_REQUIRED: 'Iniciá sesión en Jira para usar Futuros.',
  FORBIDDEN: 'La operación solicitada no está disponible para esta cuenta.',
  INVALID_REQUEST: 'Revisá las referencias y los parámetros de la corrida.',
  INVALID_SCENARIO: 'El escenario publicado contiene parámetros incompatibles.',
  INSUFFICIENT_DATA: 'Faltan datos obligatorios para calcular este escenario.',
  RESOURCE_INFEASIBLE: 'El plan requiere recursos sin una ventana factible.',
  CONFLICT: 'La referencia de esta solicitud ya corresponde a una entrada diferente.',
  STALE_INPUT: 'El snapshot original ya no está vigente o su integridad no coincide.',
  RUN_NOT_READY: 'La corrida aún no tiene un resultado publicado.',
  MODEL_UNAVAILABLE: 'La versión del motor para esta entrada no está disponible.',
  INCOMPATIBLE_RUNS: 'Las corridas requieren el mismo snapshot, motor, objetivos, semilla y cantidad de muestras.',
  SAMPLES_EXPIRED: 'Venció el período de conservación de las muestras emparejadas.',
  UNAVAILABLE: 'Futuros no pudo responder. Volvé a intentar.',
};

class FuturosError extends Error {
  constructor(readonly code: FuturosFailure) { super(code); }
}

function parse(payload: unknown, allowed: string[]): Record<string, unknown> {
  if (payload === undefined && !allowed.length) return {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Reflect.ownKeys(payload).some((key) => typeof key !== 'string' || !allowed.includes(key))) {
    throw new FuturosError('INVALID_REQUEST');
  }
  return payload as Record<string, unknown>;
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !idPattern.test(value)) throw new FuturosError('INVALID_REQUEST');
  return value;
}

function isDemoConfiguration(projectId: string, jiraProjectId: string) {
  return projectId === fixture.project.id && isConfiguredDemoProject(getAppContext(), jiraProjectId, {
    cloudId: process.env.CTX_DEMO_CLOUD_ID, jiraProjectId: process.env.CTX_DEMO_JIRA_PROJECT_ID,
  });
}

async function authorize(context: unknown, mode: 'read' | 'start' | 'catalog' | 'configure') {
  const actor = readDemoActor(context);
  if (!actor) throw new FuturosError('AUTH_REQUIRED');
  const jira = createForgeJiraProjectAdapter(context);
  await jira.assertBrowsePermission();
  const access = await getProjectAccess(jira.projectId, actor);
  if (!access || access.projectId !== fixture.project.id) throw new FuturosError('FORBIDDEN');
  const canStart = access.roles.includes('PLANNER');
  const mayRead = canStart || access.roles.includes('VIEWER');
  const mayConfigure = (mode === 'configure' || mode === 'catalog') && access.roles.includes('ADMIN') &&
    isDemoConfiguration(access.projectId, jira.projectId);
  if ((mode === 'start' && !canStart) || (mode === 'read' && !mayRead) ||
      (mode === 'configure' && !mayConfigure) || (mode === 'catalog' && !mayRead && !mayConfigure)) {
    throw new FuturosError('FORBIDDEN');
  }
  const active = await readVisibleJiraIssues(jira);
  if (active.state !== 'READY' || !active.issues) throw new FuturosError('UNAVAILABLE');
  if (!await confirmFuturosVisibility(access.projectId, jira.projectId, active.issues)) throw new FuturosError('FORBIDDEN');
  return { actor, jiraProjectId: jira.projectId, projectId: access.projectId, canStart, mayRead, mayConfigure };
}

async function protect<T>(operation: Operation, apply: () => Promise<T>): Promise<FuturosResponse<T>> {
  const requestId = randomUUID();
  const start = performance.now();
  const audit = (code: string) => console.info(JSON.stringify({
    requestId, operation, code, durationMs: Math.round(performance.now() - start),
  }));
  try {
    const data = await apply();
    audit('READY');
    return { ok: true, data, requestId };
  } catch (error) {
    if (error instanceof NeedsAuthenticationError) {
      audit('AUTH_REQUIRED');
      throw error;
    }
    let code: FuturosFailure = 'UNAVAILABLE';
    if (error instanceof SnapshotFailure || error instanceof EngineValidationError || error instanceof FuturosError) {
      code = error.code;
    } else if (error instanceof JiraBoundaryError && (error.code === 'FORBIDDEN' || error.code === 'AUTH_REQUIRED')) {
      code = error.code;
    } else if (error instanceof StatisticsError && error.code === 'INCOMPATIBLE_RUNS') {
      code = 'INCOMPATIBLE_RUNS';
    } else if (error instanceof Error && 'code' in error && error.code === 'CONFLICT') {
      code = 'CONFLICT';
    }
    audit(code);
    return { ok: false, error: { code, message: messages[code] }, requestId };
  }
}

function runCard(run: Pick<RunRecord, 'id' | 'scenarioId' | 'status' | 'sampleCount' | 'createdAt' | 'seed'>): FuturosRunCard {
  const { id, scenarioId, status, sampleCount, createdAt, seed } = run;
  return { id, scenarioId, status, sampleCount, createdAt, seed };
}

function runView(run: RunRecord, mayManage = false): FuturosRun {
  const {
    snapshotId, retryOfId, materializedCount, modelVersion, engineBuild, rngVersion, inputHash, resultHash,
    startedAt, deadlineAt, finishedAt, errorCode,
  } = run;
  let result: StatisticsSummary | null = null;
  let snapshotAsOf: string | null = null;
  let logical: FuturosRun['logical'] = null;
  if (run.status === 'SUCCEEDED') {
    if (!run.resultManifestJcs || !run.resultHash || sha256(run.resultManifestJcs) !== run.resultHash) {
      throw new FuturosError('STALE_INPUT');
    }
    const published = JSON.parse(run.resultManifestJcs) as FuturosResultManifest;
    if (!published.summary || published.summary.sampleCount !== run.sampleCount || !published.logical) {
      throw new FuturosError('STALE_INPUT');
    }
    result = published.summary;
    snapshotAsOf = published.snapshotAsOf;
    logical = published.logical;
  }
  const active = run.status === 'QUEUED' || run.status === 'RUNNING';
  const overdue = active && Date.parse(deadlineAt) <= Date.now();
  return { ...runCard(run), snapshotId, retryOfId, materializedCount, modelVersion, engineBuild, rngVersion, inputHash,
    resultHash: result ? resultHash : null, startedAt, deadlineAt, finishedAt, errorCode, snapshotAsOf,
    canCancel: mayManage && active && !overdue,
    canRetry: mayManage && (overdue || run.status === 'FAILED' || run.status === 'CANCELED'), logical, result };
}

async function getVisibleRun(projectId: string, runId: string) {
  const run = await futurosRunStore.getRun(projectId, runId);
  if (!run) throw new FuturosError('FORBIDDEN');
  const snapshots = await executeSql<{ id: string }>(
    `SELECT id FROM ctx_data_snapshot WHERE id = ? AND project_id = ? AND state = 'SEALED'
      AND access_class = 'SYNTHETIC_DEMO' AND expires_at > UTC_TIMESTAMP(3)`,
    [run.snapshotId, projectId],
  );
  if (!snapshots.length) throw new FuturosError('STALE_INPUT');
  return run;
}

async function dispatchIfQueued(run: RunRecord) {
  if (run.status === 'QUEUED') {
    try {
      await futurosWorker.dispatch(run.id);
    } catch {
      console.warn(JSON.stringify({ operation: 'futuros.dispatch', code: 'PENDING_RECOVERY' }));
    }
  }
}

export const listScenarios = (request: Request) => protect<FuturosCatalog>(FUTUROS_SCENARIOS, async () => {
  parse(request.payload, []);
  const { projectId, canStart, mayRead, mayConfigure } = await authorize(request.context, 'catalog');
  if (!mayRead) return { scenarios: [], runs: [], canStart, canConfigureDemoPlanner: mayConfigure };
  const scenarios = await listFuturosScenarios(projectId);
  const history = await executeSql<{
    id: string; scenario_id: string; status: FuturosRunCard['status']; sample_count: number; seed_hex: string; created_at: string;
  }>(`SELECT r.id, r.scenario_id, r.status, r.sample_count, r.seed_hex, CAST(r.created_at AS CHAR) AS created_at
      FROM ctx_simulation_run r INNER JOIN ctx_data_snapshot s ON s.id = r.snapshot_id AND s.project_id = r.project_id
      WHERE r.project_id = ? AND s.state = 'SEALED' AND s.access_class = 'SYNTHETIC_DEMO' AND s.expires_at > UTC_TIMESTAMP(3)
      ORDER BY r.created_at DESC, r.id LIMIT 15`, [projectId]);
  return {
    scenarios, canStart, canConfigureDemoPlanner: mayConfigure && !canStart,
    runs: history.map((row) => runCard({ id: row.id, scenarioId: row.scenario_id, status: row.status,
      sampleCount: row.sample_count, seed: row.seed_hex, createdAt: row.created_at.replace(' ', 'T') + 'Z' })),
  };
});

export const startRun = (request: Request) => protect<FuturosRun>(FUTUROS_START, async () => {
  const payload = parse(request.payload, ['scenarioId', 'sampleCount', 'seed', 'idempotencyKey']);
  const scenarioId = id(payload.scenarioId);
  const sampleCount = payload.sampleCount === undefined ? 4000 : payload.sampleCount;
  if (typeof sampleCount !== 'number' || !Number.isInteger(sampleCount) || sampleCount < 1000 || sampleCount > 10000 ||
      (payload.seed !== undefined && (typeof payload.seed !== 'string' || !seedPattern.test(payload.seed))) ||
      typeof payload.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(payload.idempotencyKey)) {
    throw new FuturosError('INVALID_REQUEST');
  }
  const { projectId, actor } = await authorize(request.context, 'start');
  const seed = typeof payload.seed === 'string' ? payload.seed : randomBytes(16).toString('hex');
  const input = await loadFuturosSnapshot({ projectId, scenarioId, seed, sampleCount });
  prepareEngine(input);
  const requestHash = sha256(canonicalJson({ scenarioId, sampleCount, seed: payload.seed ?? null }));
  const { run } = await futurosRunStore.startRun({
    projectId, scenarioId, snapshotId: input.snapshotId, requestedBy: actor, idempotencyKey: payload.idempotencyKey,
    requestHash, seed, sampleCount, inputHash: inputDigest(input),
  });
  await dispatchIfQueued(run);
  return runView(run, run.requestedBy === actor);
});

export const retryRun = (request: Request) => protect<FuturosRun>(FUTUROS_RETRY, async () => {
  const payload = parse(request.payload, ['runId', 'idempotencyKey']);
  const runId = id(payload.runId);
  if (typeof payload.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(payload.idempotencyKey)) {
    throw new FuturosError('INVALID_REQUEST');
  }
  const { projectId, actor } = await authorize(request.context, 'start');
  let original = await getVisibleRun(projectId, runId);
  if (original.requestedBy !== actor) throw new FuturosError('FORBIDDEN');
  if (original.status === 'QUEUED' || original.status === 'RUNNING') {
    await futurosRunStore.expireRun(projectId, runId, actor);
    original = await getVisibleRun(projectId, runId);
  }
  if (original.status !== 'FAILED' && original.status !== 'CANCELED') {
    throw new FuturosError('RUN_NOT_READY');
  }
  const input = await loadFuturosRunInput(original);
  prepareEngine(input);
  const inputHash = inputDigest(input);
  if (inputHash !== original.inputHash) throw new FuturosError('MODEL_UNAVAILABLE');
  const requestHash = sha256(canonicalJson({ operation: FUTUROS_RETRY, runId, inputHash }));
  const { run } = await futurosRunStore.startRun({
    projectId, scenarioId: original.scenarioId, snapshotId: original.snapshotId, requestedBy: actor,
    idempotencyKey: payload.idempotencyKey, requestHash, seed: original.seed, sampleCount: original.sampleCount,
    inputHash, retryOfId: original.id,
  });
  await dispatchIfQueued(run);
  return runView(run, run.requestedBy === actor);
});

export const getRun = (request: Request) => protect<FuturosRun>(FUTUROS_RUN, async () => {
  const runId = id(parse(request.payload, ['runId']).runId);
  const { projectId, actor, canStart } = await authorize(request.context, 'read');
  const run = await getVisibleRun(projectId, runId);
  return runView(run, canStart && run.requestedBy === actor);
});

export const cancelRun = (request: Request) => protect<FuturosRun>(FUTUROS_CANCEL, async () => {
  const runId = id(parse(request.payload, ['runId']).runId);
  const { projectId, actor } = await authorize(request.context, 'start');
  const run = await getVisibleRun(projectId, runId);
  if (run.requestedBy !== actor) throw new FuturosError('FORBIDDEN');
  const updated = await futurosRunStore.cancelRun(projectId, runId, actor);
  if (!updated) throw new FuturosError('FORBIDDEN');
  return runView(updated);
});

export const compareRuns = (request: Request) => protect<FuturosComparison>(FUTUROS_COMPARE, async () => {
  const payload = parse(request.payload, ['baselineRunId', 'alternativeRunIds']);
  const baselineId = id(payload.baselineRunId);
  if (!Array.isArray(payload.alternativeRunIds) || payload.alternativeRunIds.length < 1 ||
      payload.alternativeRunIds.length > 2) throw new FuturosError('INVALID_REQUEST');
  const alternatives = payload.alternativeRunIds.map(id);
  if (new Set([baselineId, ...alternatives]).size !== alternatives.length + 1) throw new FuturosError('INVALID_REQUEST');
  const { projectId } = await authorize(request.context, 'read');
  const records = await Promise.all([baselineId, ...alternatives].map((runId) => getVisibleRun(projectId, runId)));
  const baseline = records[0]!;
  if (records.some(({ status }) => status !== 'SUCCEEDED')) throw new FuturosError('RUN_NOT_READY');
  if (records.some((run) => run.snapshotId !== baseline.snapshotId || run.seed !== baseline.seed ||
    run.sampleCount !== baseline.sampleCount || run.modelVersion !== baseline.modelVersion ||
    run.rngVersion !== baseline.rngVersion || run.engineBuild !== baseline.engineBuild)) {
    throw new FuturosError('INCOMPATIBLE_RUNS');
  }
  const materialized = await Promise.all(records.map(async (run) => ({
    run, input: await loadFuturosRunInput(run), samples: await readRunSamples(run, futurosRunStore),
  })));
  if (materialized.some(({ run, input }) => inputDigest(input) !== run.inputHash)) throw new FuturosError('STALE_INPUT');
  if (materialized.some(({ samples }) => !samples)) throw new FuturosError('SAMPLES_EXPIRED');
  const base = materialized[0]!;
  return { baselineId, items: materialized.slice(1).map(({ run, input, samples }) => ({
    runId: run.id, comparison: compareSamples(base.input, base.samples!, input, samples!),
  })) };
});

export const grantDemoPlanner = (request: Request) => protect<{ granted: true }>(FUTUROS_GRANT, async () => {
  if (parse(request.payload, ['confirmed']).confirmed !== true) throw new FuturosError('INVALID_REQUEST');
  const { projectId, actor, jiraProjectId } = await authorize(request.context, 'configure');
  await executeSql(
    `INSERT INTO ctx_project_role (project_id, account_id, role_code, granted_by, granted_at)
     SELECT r.project_id, r.account_id, 'PLANNER', r.account_id, UTC_TIMESTAMP(3)
     FROM ctx_project_role r INNER JOIN ctx_project p ON p.id = r.project_id AND p.jira_project_id = ?
     WHERE r.project_id = ? AND r.account_id = ? AND r.role_code = 'ADMIN' AND r.revoked_at IS NULL
       AND p.status = 'ACTIVE' AND p.data_mode = 'DEMO'
     ON DUPLICATE KEY UPDATE project_id = ctx_project_role.project_id`,
    [jiraProjectId, projectId, actor],
  );
  const verified = await getProjectAccess(jiraProjectId, actor);
  if (verified?.projectId !== projectId || !verified.roles.includes('PLANNER')) throw new FuturosError('FORBIDDEN');
  return { granted: true };
});
