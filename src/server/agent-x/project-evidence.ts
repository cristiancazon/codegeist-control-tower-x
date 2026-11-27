import { NeedsAuthenticationError } from '@forge/api';
import type { Overview, OverviewAlertDetail, OverviewErrorCode, OverviewMetric, OverviewSource } from '../../shared/overview';
import { isDateOnly, isIssueKey, isRecord } from '../data/jira/normalize';
import { overviewResolvers } from '../overview/resolvers';
import { actorFrom, resolveJiraProjectReference, rovoProjectContext } from './context';

type Filter = 'summary' | 'overdue' | 'milestones' | 'a17';
type Dependencies = Pick<typeof overviewResolvers, 'get' | 'agentA17'>;

const messages = {
  AUTH_REQUIRED: 'Iniciá sesión en Jira con una cuenta autorizada para consultar el proyecto.',
  INVALID_REFERENCE: 'Indicá la referencia exacta del proyecto Jira y elegí summary, overdue, milestones o a17.',
  NOT_AVAILABLE: 'La evidencia solicitada no está disponible para esta consulta.',
  TEMPORARILY_UNAVAILABLE: 'No se pudo verificar la evidencia del proyecto. Volvé a consultar más tarde.',
} as const;

const metricIds = ['progress', 'overdue', 'milestones', 'logistics', 'assets', 'cost'] as const;
const chainStages = [
  { code: 'WP-048', label: 'Recepción del kit A-17' },
  { code: 'WP-064', label: 'Montaje con EQ-017' },
  { code: 'WP-083', label: 'Comisionado' },
] as const;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function fail(code: keyof typeof messages) {
  return { ok: false as const, error: { code, message: messages[code] } };
}

function fromOverviewError(code: OverviewErrorCode) {
  if (code === 'AUTH_REQUIRED') return fail('AUTH_REQUIRED');
  return fail(code === 'UNAVAILABLE' ? 'TEMPORARILY_UNAVAILABLE' : 'NOT_AVAILABLE');
}

function readSelectors(payload: unknown): { jiraProjectId: string; filter: Filter } | undefined {
  if (!isRecord(payload) || !Object.hasOwn(payload, 'jiraProjectId')) return undefined;
  // Rovo adds its own metadata to the payload. Select only the declared inputs;
  // the action gets identity separately from the trusted invocation context.
  const input = payload.filter;
  if (input !== undefined && (typeof input !== 'string' || input.length > 20)) return undefined;
  const normalized = input?.trim().toLowerCase() ?? 'summary';
  const filter = normalized === 'a-17' ? 'a17' : normalized;
  if (filter !== 'summary' && filter !== 'overdue' && filter !== 'milestones' && filter !== 'a17') return undefined;
  const jiraProjectId = resolveJiraProjectReference(payload.jiraProjectId);
  return jiraProjectId ? { jiraProjectId, filter } : undefined;
}

function utcString(value: string | null | undefined) {
  if (typeof value !== 'string' || !timestampPattern.test(value) || !Number.isFinite(Date.parse(value))) return null;
  const canonical = new Date(value).toISOString();
  return value === canonical || value === canonical.replace('.000Z', 'Z') ? canonical : null;
}

function sourceStates(sources: OverviewSource[]) {
  return (['FORGE', 'JIRA'] as const).map((sourceType) => {
    const source = sources.find(({ source }) => source === sourceType);
    const state = source?.state === 'READY' || source?.state === 'PARTIAL' ? source.state : 'UNAVAILABLE';
    return { sourceType, state, observedAt: state === 'UNAVAILABLE' ? null : utcString(source?.observedAt) };
  });
}

function jiraEvidence(issueKey: string, observedAt: string | null, label = issueKey) {
  return { sourceType: 'JIRA' as const, sourceId: issueKey, label, url: `/browse/${issueKey}`, observedAt };
}

function observedMetric({ id, source, unit, value, numerator, denominator, coverage }: OverviewMetric) {
  return { id, sourceType: source, unit, value,
    numerator, denominator, coverage };
}

function summaryOf(data: Overview, jiraProjectId: string, filter: Exclude<Filter, 'a17'>) {
  const sources = sourceStates(data.sources);
  const jira = sources.find(({ sourceType }) => sourceType === 'JIRA');
  const jiraReadAt = jira?.observedAt ?? null;
  const selected = filter === 'summary' ? metricIds : [filter];
  const metrics = selected.flatMap((id) => {
    const metric = data.metrics.find((item) => item.id === id);
    return metric ? [metric] : [];
  });
  const evidence: Array<ReturnType<typeof jiraEvidence> & { metric: OverviewMetric['id']; dueDate?: string }> = [];
  const cited = new Set<string>();
  for (const metric of metrics) {
    for (const entry of jira?.state === 'UNAVAILABLE' ? [] : metric.evidence) {
      if (evidence.length >= 5 || !isIssueKey(entry.issueKey) || cited.has(entry.issueKey)) continue;
      cited.add(entry.issueKey);
      evidence.push({ ...jiraEvidence(entry.issueKey, jiraReadAt), metric: metric.id,
        ...(metric.id === 'overdue' && isDateOnly(entry.value) ? { dueDate: entry.value } : {}) });
    }
  }
  const partial = metrics.length !== selected.length || metrics.some(({ value }) => value === null) ||
    sources.some(({ state }) => state !== 'READY');
  return {
    ok: true as const,
    status: partial ? 'PARTIAL' as const : 'READY' as const,
    filter, jiraProjectId, sourceClass: 'SYNTHETIC_DEMO' as const, coverage: 'VISIBLE_ONLY' as const,
    snapshotAsOf: isDateOnly(data.asOf) ? data.asOf : null, asOf: utcString(data.snapshot?.collectedAt) ?? jiraReadAt,
    currency: data.project.currency === 'USD' ? 'USD' as const : null,
    sources, metrics: metrics.map(observedMetric), evidence,
  };
}

function visibleChain(alert: OverviewAlertDetail, observedAt: string | null) {
  const work: Array<(typeof chainStages)[number] & { issueKey: string }> = [];
  const evidence: Array<ReturnType<typeof jiraEvidence>> = [];
  const used = new Set<string>();
  for (const stage of chainStages) {
    const entries = alert.work.filter(({ code }) => code === stage.code);
    const issueKey = entries[0]?.issueKey;
    if (entries.length !== 1 || !isIssueKey(issueKey) || used.has(issueKey)) break;
    used.add(issueKey);
    work.push({ ...stage, issueKey });
    evidence.push(jiraEvidence(issueKey, observedAt, stage.label));
  }
  return { work, evidence };
}

function assumptionOf(alert: OverviewAlertDetail, asOf: string) {
  const value = alert.simulationInput;
  return value?.scenarioCode === 'S1' && value.variable === 'SUPPLY_DELAY_DAYS' &&
    value.snapshotAsOf === asOf && uuidPattern.test(value.snapshotId) && value.value === alert.delayDays && value.value <= 365
    ? { scenarioCode: 'S1' as const, variable: 'SUPPLY_DELAY_DAYS' as const, unit: 'DAY' as const,
      value: value.value, snapshotId: value.snapshotId, snapshotAsOf: value.snapshotAsOf }
    : null;
}

export function createReadProjectEvidence(dependencies: Dependencies = overviewResolvers) {
  return async (payload: unknown, context: unknown) => {
    const actor = actorFrom(context);
    if (!actor) return fail('AUTH_REQUIRED');
    const selectors = readSelectors(payload);
    if (!selectors) return fail('INVALID_REFERENCE');
    const { jiraProjectId, filter } = selectors;
    const request = { payload: {}, context: rovoProjectContext(actor, jiraProjectId) };
    try {
      if (filter !== 'a17') {
        const response = await dependencies.get(request);
        if (!response.ok) return fromOverviewError(response.error.code);
        if (response.data.project.jiraProjectId !== jiraProjectId) return fail('NOT_AVAILABLE');
        return { ...summaryOf(response.data, jiraProjectId, filter), requestId: response.requestId };
      }
      const response = await dependencies.agentA17(request);
      if (!response.ok) return fromOverviewError(response.error.code);
      const { project, snapshot, alert } = response.data;
      if (project.jiraProjectId !== jiraProjectId || alert.code !== 'A-17' || !isDateOnly(snapshot.asOf) ||
        !isDateOnly(alert.baselineEta) || !isDateOnly(alert.currentEta) || !Number.isInteger(alert.delayDays) ||
        alert.delayDays <= 0 || Date.parse(alert.currentEta) - Date.parse(alert.baselineEta) !== alert.delayDays * 86_400_000) {
        return fail('NOT_AVAILABLE');
      }
      const sources = sourceStates(response.data.sources);
      const jira = sources.find(({ sourceType }) => sourceType === 'JIRA');
      if (jira?.state === 'UNAVAILABLE') return fail('TEMPORARILY_UNAVAILABLE');
      const jiraReadAt = jira?.observedAt ?? null;
      const asOf = utcString(snapshot.collectedAt);
      const chain = visibleChain(alert, jiraReadAt);
      if (chain.work.length === 0 || !asOf) return fail('NOT_AVAILABLE');
      const assetCode = alert.asset?.code === 'EQ-017' ? alert.asset.code : null;
      const contractorCode = alert.contractor?.code === 'CON-03' ? alert.contractor.code : null;
      const complete = chain.work.length === chainStages.length && assetCode !== null && contractorCode !== null &&
        sources.every(({ state }) => state === 'READY');
      return {
        ok: true as const, status: complete ? 'READY' as const : 'PARTIAL' as const, filter, jiraProjectId,
        sourceClass: 'SYNTHETIC_DEMO' as const, coverage: 'VISIBLE_ONLY' as const, snapshotAsOf: snapshot.asOf, asOf, sources,
        observation: { code: 'A-17' as const, status: 'ETA_DELAY_SIGNAL' as const, baselineEta: alert.baselineEta,
          currentEta: alert.currentEta, delayDays: alert.delayDays, observedArrival: null, assetCode, contractorCode, work: chain.work },
        assumption: assumptionOf(alert, snapshot.asOf),
        evidence: [{ sourceType: 'FORGE' as const, sourceId: 'A-17', label: 'Envío A-17 en el snapshot sintético', observedAt: asOf },
          ...chain.evidence],
        requestId: response.requestId,
      };
    } catch (error) {
      return fail(error instanceof NeedsAuthenticationError ? 'AUTH_REQUIRED' : 'TEMPORARILY_UNAVAILABLE');
    }
  };
}

export const readProjectEvidence = createReadProjectEvidence();
