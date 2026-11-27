import { performance } from 'node:perf_hooks';
import api, { getAppContext, NeedsAuthenticationError, route, type Route } from '@forge/api';
import { readDemoActor } from '../data/bootstrap/demo-access';
import { createForgeJiraProjectAdapter, JiraBoundaryError } from '../data/jira';
import { isDateOnly, isIssueKey, isJiraId, isRecord, isText } from '../data/jira/normalize';
import { getProjectAccess } from '../data/sql/projects';

const maxTypes = 4;
const maxPages = 8;
const pageSize = 20;
const operationBudgetMs = 10_000;
const requestBudgetMs = 3_500;
const maxResponseBytes = 1024 * 1024;
const cloudIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const projectKeyPattern = /^[A-Z][A-Z0-9_]{0,39}$/;

/** Optional mapping provisioned by the server for a verified Jira installation. */
export type JsmIncidentBinding = {
  enabled: boolean;
  cloudId: string;
  jiraProjectId: string;
  serviceDeskId: string;
  serviceProjectId: string;
  serviceProjectKey: string;
  requestTypeIds: readonly string[];
  portalId?: string;
};

export type JsmIncidentSummary = {
  issueId: string;
  issueKey: string;
  serviceDeskId: string;
  requestTypeId: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'CLOSED' | 'UNKNOWN';
  createdAt: string | null;
  statusChangedAt: string | null;
  portalPath: string | null;
};

type FailureState = 'DISABLED' | 'NOT_AVAILABLE' | 'UNAVAILABLE';
type JsmProvenance = { source: 'JSM'; visibility: 'CURRENT_ACTOR'; retryAfterSeconds?: number };
export type JsmReadResult<T> = JsmProvenance & (
  | { state: 'READY' | 'PARTIAL'; observedAt: string; data: T }
  | { state: FailureState; observedAt: null; data: null }
);

type JsmRequest = (path: Route, options: {
  method: 'GET'; headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal;
}) => Promise<{ status: number; headers?: { get(name: string): string | null }; text(): Promise<string> }>;

type Dependencies = {
  request: JsmRequest;
  runtime: () => { installation?: { contexts: ReadonlyArray<{ cloudId?: string; toString(): string }> } };
  verifyBrowse: (context: unknown) => Promise<void>;
  getProjectAccess: typeof getProjectAccess;
  now: () => Date;
};

class JsmFailure extends Error {
  constructor(readonly state: Exclude<FailureState, 'DISABLED'>, readonly retryAfterSeconds?: number) {
    super(state);
  }
}

function safeFailure(error: unknown): JsmFailure {
  if (error instanceof JsmFailure) return error;
  if (error instanceof NeedsAuthenticationError ||
      (error instanceof JiraBoundaryError && (error.code === 'AUTH_REQUIRED' || error.code === 'FORBIDDEN'))) {
    return new JsmFailure('NOT_AVAILABLE');
  }
  return new JsmFailure('UNAVAILABLE');
}

const provenance = { source: 'JSM', visibility: 'CURRENT_ACTOR' } as const;

function failure(state: FailureState, retryAfterSeconds?: number): JsmReadResult<never> {
  return {
    ...provenance, state, observedAt: null, data: null,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

function success<T>(state: 'READY' | 'PARTIAL', data: T, observedAt: string, retryAfterSeconds?: number): JsmReadResult<T> {
  return {
    ...provenance, state, observedAt, data,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

function isEnabled(binding: JsmIncidentBinding | undefined): binding is JsmIncidentBinding {
  return binding?.enabled === true && cloudIdPattern.test(binding.cloudId) &&
    isJiraId(binding.jiraProjectId) && isJiraId(binding.serviceDeskId) && isJiraId(binding.serviceProjectId) &&
    projectKeyPattern.test(binding.serviceProjectKey) &&
    Array.isArray(binding.requestTypeIds) && binding.requestTypeIds.length > 0 && binding.requestTypeIds.length <= maxTypes &&
    binding.requestTypeIds.every(isJiraId) && new Set(binding.requestTypeIds).size === binding.requestTypeIds.length &&
    (binding.portalId === undefined || isJiraId(binding.portalId));
}

function requestContextMatches(context: unknown, binding: JsmIncidentBinding) {
  if (!isRecord(context) || !isText(context.installContext, 512) || !isRecord(context.extension) ||
      !isRecord(context.extension.project)) return false;
  return context.installContext === `ari:cloud:jira::site/${binding.cloudId}` && context.extension.project.id === binding.jiraProjectId;
}

async function bounded<T>(deadline: number, call: (signal: AbortSignal) => Promise<T>, maxMs = operationBudgetMs): Promise<T> {
  const remaining = Math.min(maxMs, Math.floor(deadline - performance.now()));
  if (remaining <= 0) throw new JsmFailure('UNAVAILABLE');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([call(controller.signal), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new JsmFailure('UNAVAILABLE'));
      }, remaining);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isoInstant(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 48 || !isDateOnly(raw.slice(0, 10)) ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:?\d\d)$/.test(raw)) return null;
  const timestamp = new Date(raw);
  return Number.isFinite(timestamp.valueOf()) ? timestamp.toISOString() : null;
}

function isBoundIssueKey(value: unknown, binding: JsmIncidentBinding): value is string {
  return isIssueKey(value) && value.startsWith(`${binding.serviceProjectKey}-`);
}

function requestProjection(raw: unknown, binding: JsmIncidentBinding, requestTypeId?: string): JsmIncidentSummary {
  if (!isRecord(raw) || !isJiraId(raw.issueId) || !isIssueKey(raw.issueKey) ||
      !isJiraId(raw.serviceDeskId) || !isJiraId(raw.requestTypeId)) throw new JsmFailure('UNAVAILABLE');
  if (raw.serviceDeskId !== binding.serviceDeskId || !isBoundIssueKey(raw.issueKey, binding) ||
      !binding.requestTypeIds.includes(raw.requestTypeId) || (requestTypeId !== undefined && raw.requestTypeId !== requestTypeId)) {
    throw new JsmFailure('NOT_AVAILABLE');
  }

  const current = isRecord(raw.currentStatus) ? raw.currentStatus : undefined;
  const category = current?.statusCategory;
  const status = category === 'NEW' ? 'OPEN' : category === 'INDETERMINATE' ? 'IN_PROGRESS' : category === 'DONE' ? 'CLOSED' : 'UNKNOWN';
  return {
    issueId: raw.issueId, issueKey: raw.issueKey, serviceDeskId: binding.serviceDeskId, requestTypeId: raw.requestTypeId, status,
    createdAt: isoInstant(isRecord(raw.createdDate) ? raw.createdDate.iso8601 : undefined),
    statusChangedAt: isoInstant(isRecord(current?.statusDate) ? current.statusDate.iso8601 : undefined),
    portalPath: binding.portalId ? `/servicedesk/customer/portal/${binding.portalId}/${raw.issueKey}` : null,
  };
}

function pageProjection(raw: unknown, offset: number) {
  if (!isRecord(raw) || raw.start !== offset || !Array.isArray(raw.values) || typeof raw.limit !== 'number' ||
      !Number.isSafeInteger(raw.limit) || raw.limit < 1 || raw.limit > pageSize || raw.size !== raw.values.length ||
      raw.values.length > raw.limit || typeof raw.isLastPage !== 'boolean' || (!raw.isLastPage && raw.values.length === 0)) {
    throw new JsmFailure('UNAVAILABLE');
  }
  return { values: raw.values, next: raw.isLastPage ? undefined : offset + raw.limit };
}

export function createJsmReader(dependencies: Partial<Dependencies> = {}) {
  const {
    request = (path, options) => api.asUser().requestJira(path, options),
    runtime = getAppContext,
    verifyBrowse = (context) => createForgeJiraProjectAdapter(context, requestBudgetMs).assertBrowsePermission(),
    getProjectAccess: loadProjectAccess = getProjectAccess, now = () => new Date(),
  } = dependencies;

  async function get(path: Route, deadline: number): Promise<unknown> {
    return bounded(deadline, async (signal) => {
      const response = await request(path, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'manual', signal });
      if (response.status === 401 || response.status === 403 || response.status === 404) throw new JsmFailure('NOT_AVAILABLE');
      if (response.status !== 200) {
        const retry = response.status === 429 ? response.headers?.get('Retry-After') : null;
        throw new JsmFailure('UNAVAILABLE', retry && /^\d{1,6}$/.test(retry) ? Number(retry) : undefined);
      }
      const length = response.headers?.get('Content-Length');
      if (length && /^\d+$/.test(length) && Number(length) > maxResponseBytes) throw new JsmFailure('UNAVAILABLE');
      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > maxResponseBytes) throw new JsmFailure('UNAVAILABLE');
      return JSON.parse(body) as unknown;
    }, requestBudgetMs);
  }

  async function verify(context: unknown, binding: JsmIncidentBinding, deadline: number): Promise<void> {
    const actor = readDemoActor(context);
    if (!actor || !requestContextMatches(context, binding) || !runtime().installation?.contexts.some((site) =>
      site.cloudId === binding.cloudId && site.toString() === `ari:cloud:jira::site/${binding.cloudId}`)) {
      throw new JsmFailure('NOT_AVAILABLE');
    }
    await bounded(deadline, () => verifyBrowse(context), requestBudgetMs);
    const access = await bounded(deadline, () => loadProjectAccess(binding.jiraProjectId, actor));
    if (!access?.roles.includes('HSE_READER') || !access.roles.some((role) => role !== 'HSE_READER')) {
      throw new JsmFailure('NOT_AVAILABLE');
    }
    const desk = await get(route`/rest/servicedeskapi/servicedesk/${binding.serviceDeskId}`, deadline);
    if (!isRecord(desk) || desk.id !== binding.serviceDeskId ||
        desk.projectId !== binding.serviceProjectId || desk.projectKey !== binding.serviceProjectKey) {
      throw new JsmFailure('NOT_AVAILABLE');
    }
  }

  async function readJsmIncidentSummaries(context: unknown, binding?: JsmIncidentBinding): Promise<JsmReadResult<JsmIncidentSummary[]>> {
    if (!isEnabled(binding)) return failure('DISABLED');
    const deadline = performance.now() + operationBudgetMs;
    const observedAt = now().toISOString();
    const rows = new Map<string, JsmIncidentSummary>();
    const keys = new Map<string, string>();
    let successfulPages = 0;
    let duplicate = false;
    try {
      await verify(context, binding, deadline);
      for (const requestTypeId of binding.requestTypeIds) {
        let offset: number | undefined = 0;
        while (offset !== undefined && successfulPages < maxPages) {
          const filters = new URLSearchParams({ serviceDeskId: binding.serviceDeskId, requestTypeId,
            start: String(offset), limit: String(pageSize) });
          const raw = await get(route`/rest/servicedeskapi/request?${filters}`, deadline);
          const page = pageProjection(raw, offset);
          const visible = page.values.map((item) => requestProjection(item, binding, requestTypeId));
          for (const incident of visible) {
            const previous = rows.get(incident.issueId);
            const owner = keys.get(incident.issueKey);
            if ((previous && previous.issueKey !== incident.issueKey) || (owner && owner !== incident.issueId)) {
              throw new JsmFailure('NOT_AVAILABLE');
            }
            duplicate ||= previous !== undefined;
            if (!previous || (incident.statusChangedAt ?? '') > (previous.statusChangedAt ?? '')) rows.set(incident.issueId, incident);
            keys.set(incident.issueKey, incident.issueId);
          }
          successfulPages += 1;
          offset = page.next;
        }
        if (offset !== undefined) return success('PARTIAL', [...rows.values()], observedAt);
      }
      return success(duplicate ? 'PARTIAL' : 'READY', [...rows.values()], observedAt);
    } catch (error) {
      const { state, retryAfterSeconds } = safeFailure(error);
      return state === 'UNAVAILABLE' && successfulPages > 0
        ? success('PARTIAL', [...rows.values()], observedAt, retryAfterSeconds)
        : failure(state, retryAfterSeconds);
    }
  }

  async function readJsmIncidentDetail(
    context: unknown, binding: JsmIncidentBinding | undefined, issueIdOrKey: unknown,
  ): Promise<JsmReadResult<JsmIncidentSummary>> {
    if (!isEnabled(binding)) return failure('DISABLED');
    if (!isJiraId(issueIdOrKey) && !isBoundIssueKey(issueIdOrKey, binding)) return failure('NOT_AVAILABLE');
    const deadline = performance.now() + operationBudgetMs;
    const observedAt = now().toISOString();
    try {
      await verify(context, binding, deadline);
      const data = requestProjection(await get(route`/rest/servicedeskapi/request/${issueIdOrKey}`, deadline), binding);
      if (data.issueId !== issueIdOrKey && data.issueKey !== issueIdOrKey) return failure('NOT_AVAILABLE');
      return success('READY', data, observedAt);
    } catch (error) {
      const { state, retryAfterSeconds } = safeFailure(error);
      return failure(state, retryAfterSeconds);
    }
  }

  return { readJsmIncidentSummaries, readJsmIncidentDetail };
}

export const { readJsmIncidentSummaries, readJsmIncidentDetail } = createJsmReader();
