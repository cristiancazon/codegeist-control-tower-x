import { NeedsAuthenticationError } from '@forge/api';
import type { Distribution, StatisticsSummary } from '../../domain/futuros/statistics';
import type { FuturosFailure, FuturosRun } from '../../shared/futuros';
import { isJiraId, isRecord, isText } from '../data/jira/normalize';
import { getRun } from '../futuros/resolvers';

const runIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const accountIdPattern = /^[^\s\p{Cc}]{1,128}$/u;
const statusMessages = {
  AUTH_REQUIRED: 'Se requiere una sesión autorizada para consultar Futuros en Jira.',
  INVALID_REFERENCE: 'Proporcioná el identificador exacto de la corrida y el ID numérico del proyecto Jira.',
  NOT_AVAILABLE: 'La corrida solicitada no está disponible para esta consulta.',
  TEMPORARILY_UNAVAILABLE: 'Futuros no pudo verificar el resultado. Volvé a consultar más tarde.',
} as const;

type ActionFailure = keyof typeof statusMessages;
type ReadRun = typeof getRun;

function fail(code: ActionFailure) {
  return { ok: false as const, error: { code, message: statusMessages[code] } };
}

function actorFrom(context: unknown) {
  if (!isRecord(context) || context.accountType === 'anonymous' || !isText(context.installContext, 512)) return;
  // This is the trusted second argument from the Forge function, independent of
  // the action payload and its optional page context.
  const direct = context.accountId;
  const principal = isRecord(context.principal) ? context.principal.accountId : undefined;
  if (direct !== undefined && principal !== undefined && direct !== principal) return;
  const accountId = direct ?? principal;
  if (typeof accountId !== 'string' || !accountIdPattern.test(accountId)) return;
  return { accountId, installContext: context.installContext };
}

function selectorsFrom(payload: unknown) {
  if (!isRecord(payload) || typeof payload.runId !== 'string' || !runIdPattern.test(payload.runId)
    || !isJiraId(payload.jiraProjectId)) return;
  return { runId: payload.runId, jiraProjectId: payload.jiraProjectId };
}

function errorFrom(code: FuturosFailure): ActionFailure {
  if (code === 'AUTH_REQUIRED') return 'AUTH_REQUIRED';
  return code === 'UNAVAILABLE' || code === 'RATE_LIMITED' ? 'TEMPORARILY_UNAVAILABLE' : 'NOT_AVAILABLE';
}

function quantiles<T>({ observedCount, totalCount, percentiles, lowerBounds }: Distribution<T>) {
  return { observedCount, totalCount, percentiles, lowerBounds };
}

function success({ probability, wilson95, bounds, unknown }: StatisticsSummary['success']['joint']) {
  return { probability, wilson95, bounds, unknown };
}

function projectedRun(run: FuturosRun, requestId: string) {
  const reference = { source: 'Futuros' as const, runId: run.id, scenarioId: run.scenarioId, snapshotId: run.snapshotId };
  if (run.status !== 'SUCCEEDED') return { ok: true as const, status: run.status, reference, requestId };
  if (!run.result || !run.resultHash || !run.snapshotAsOf) return fail('NOT_AVAILABLE');

  const { finishDay, costCents, success: objectives, sampleCount, censoredCount, distributionIncomplete } = run.result;
  return {
    ok: true as const, status: run.status, requestId,
    reference: {
      ...reference, snapshotAsOf: run.snapshotAsOf, inputHash: run.inputHash, resultHash: run.resultHash,
      modelVersion: run.modelVersion, engineBuild: run.engineBuild, rngVersion: run.rngVersion,
    },
    result: {
      sourceClass: 'SYNTHETIC_DEMO' as const, sampleCount, censoredCount, distributionIncomplete,
      finishDay: { unit: 'DAY' as const, ...quantiles(finishDay) },
      costCents: { unit: 'USD_CENT' as const, ...quantiles(costCents) },
      success: { deadline: success(objectives.deadline), budget: success(objectives.budget), joint: success(objectives.joint) },
    },
  };
}

export function createReadFuturosResult(read: ReadRun = getRun) {
  return async (payload: unknown, context: unknown) => {
    const actor = actorFrom(context);
    if (!actor) return fail('AUTH_REQUIRED');
    const selectors = selectorsFrom(payload);
    if (!selectors) return fail('INVALID_REFERENCE');
    try {
      // The existing read boundary revalidates Jira Browse as the current user,
      // project membership, source visibility and the published snapshot.
      const response = await read({ payload: { runId: selectors.runId }, context: {
        ...actor, extension: { project: { id: selectors.jiraProjectId } },
      } });
      if (!response.ok) return fail(errorFrom(response.error.code));
      if (response.data.id !== selectors.runId) return fail('NOT_AVAILABLE');
      return projectedRun(response.data, response.requestId);
    } catch (error) {
      return fail(error instanceof NeedsAuthenticationError ? 'AUTH_REQUIRED' : 'TEMPORARILY_UNAVAILABLE');
    }
  };
}

export const readFuturosResult = createReadFuturosResult();
