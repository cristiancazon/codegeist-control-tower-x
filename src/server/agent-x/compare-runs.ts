import { NeedsAuthenticationError } from '@forge/api';
import type { Distribution } from '../../domain/futuros/statistics';
import type { FuturosFailure, FuturosResultReference } from '../../shared/futuros';
import { isRecord } from '../data/jira/normalize';
import { compareRuns } from '../futuros/resolvers';
import { actorFrom, authorizedRunPath, isRunReference, resolveJiraProjectReference, rovoProjectContext } from './context';

const failures = {
  AUTH_REQUIRED: 'Iniciá sesión en Jira para comparar corridas de Futuros.',
  INVALID_REFERENCE: 'Indicá el proyecto, una corrida base y una o dos alternativas con IDs distintos.',
  NOT_AVAILABLE: 'No se pudo acceder a todas las corridas solicitadas en este proyecto.',
  NOT_READY: 'Falta al menos un resultado publicado. Consultá el estado de las corridas en Futuros.',
  INCOMPATIBLE_RUNS: 'Las corridas difieren en snapshot, objetivos, motor, semilla o cantidad de muestras.',
  SAMPLES_EXPIRED: 'Las muestras emparejadas ya no están disponibles. Consultá cada resultado publicado en Futuros.',
  TEMPORARILY_UNAVAILABLE: 'Futuros no pudo verificar la comparación. Volvé a intentar más tarde.',
} as const;

function fail(code: keyof typeof failures) {
  return { ok: false as const, error: { code, message: failures[code] } };
}

function failureFrom(code: FuturosFailure) {
  switch (code) {
    case 'AUTH_REQUIRED': case 'INCOMPATIBLE_RUNS': case 'SAMPLES_EXPIRED': return fail(code);
    case 'RUN_NOT_READY': return fail('NOT_READY');
    case 'RATE_LIMITED': case 'UNAVAILABLE': return fail('TEMPORARILY_UNAVAILABLE');
    default: return fail('NOT_AVAILABLE');
  }
}

function selectorsFrom(payload: unknown) {
  if (!isRecord(payload) || !isRunReference(payload.baseRunId) || !isRunReference(payload.candidateRunId)) return;
  const jiraProjectId = resolveJiraProjectReference(payload.jiraProjectId);
  if (!jiraProjectId) return;
  const alternativeRunIds = [payload.candidateRunId];
  if (payload.secondCandidateRunId !== undefined) {
    if (!isRunReference(payload.secondCandidateRunId)) return;
    alternativeRunIds.push(payload.secondCandidateRunId);
  }
  if (new Set([payload.baseRunId, ...alternativeRunIds]).size !== alternativeRunIds.length + 1) return;
  return { jiraProjectId, baselineRunId: payload.baseRunId, alternativeRunIds };
}

function projectedReference(reference: FuturosResultReference, jiraProjectId: string) {
  const path = authorizedRunPath(jiraProjectId, reference.id);
  return { source: 'Futuros' as const, runId: reference.id, scenarioId: reference.scenarioId,
    snapshotId: reference.snapshotId, snapshotAsOf: reference.snapshotAsOf, modelVersion: reference.modelVersion,
    resultHash: reference.resultHash, sampleCount: reference.sampleCount, finishedAt: reference.finishedAt,
    ...(path ? { url: path } : {}) };
}

function pairedMetric<T>(unit: 'DAY' | 'USD_CENT', metric: {
  p80Delta: T | null;
  observedCount: { base: number; alternative: number };
  pairedDeltas: Distribution<T>;
}) {
  return { unit, p80Delta: metric.p80Delta, observedCount: metric.observedCount,
    pairedDeltas: { observedCount: metric.pairedDeltas.observedCount, totalCount: metric.pairedDeltas.totalCount,
      percentiles: metric.pairedDeltas.percentiles, lowerBounds: metric.pairedDeltas.lowerBounds } };
}

export function createCompareFuturosResults(compare: typeof compareRuns = compareRuns) {
  return async (payload: unknown, context: unknown) => {
    const actor = actorFrom(context);
    if (!actor) return fail('AUTH_REQUIRED');
    const selectors = selectorsFrom(payload);
    if (!selectors) return fail('INVALID_REFERENCE');
    const { jiraProjectId, baselineRunId, alternativeRunIds } = selectors;
    try {
      const response = await compare({ payload: { baselineRunId, alternativeRunIds },
        context: rovoProjectContext(actor, jiraProjectId) });
      if (!response.ok) return failureFrom(response.error.code);
      const { baselineId, items, references } = response.data;
      const orderedIds = [baselineRunId, ...alternativeRunIds];
      if (baselineId !== baselineRunId || items.length !== alternativeRunIds.length ||
          items.some(({ runId }, index) => runId !== alternativeRunIds[index]) ||
          !references || references.length !== orderedIds.length ||
          references.some((reference, index) => reference.id !== orderedIds[index] || !reference.resultHash || !reference.snapshotAsOf)) {
        return fail('NOT_AVAILABLE');
      }
      return { ok: true as const, status: 'READY' as const, sourceClass: 'SYNTHETIC_DEMO' as const,
        asOf: references[0]?.snapshotAsOf, baselineRunId, requestId: response.requestId,
        terminology: {
          p80Delta: 'Diferencia entre los cuantiles P80 marginales de la alternativa y la base.',
          pairedDeltas: 'Distribución de las diferencias calculadas muestra a muestra.',
          percentiles: 'Cuantiles empíricos condicionados al modelo, las entradas y los supuestos de Futuros.',
        },
        references: references.map((reference) => projectedReference(reference, jiraProjectId)),
        comparisons: items.map(({ runId, comparison }) => ({ runId, sampleCount: comparison.sampleCount,
          finishDay: pairedMetric('DAY', comparison.finishDay), costCents: pairedMetric('USD_CENT', comparison.costCents),
          success: comparison.success })) };
    } catch (error) {
      return fail(error instanceof NeedsAuthenticationError ? 'AUTH_REQUIRED' : 'TEMPORARILY_UNAVAILABLE');
    }
  };
}

export const compareFuturosResults = createCompareFuturosResults();
