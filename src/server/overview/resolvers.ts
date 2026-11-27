import { randomUUID } from 'node:crypto';
import { NeedsAuthenticationError } from '@forge/api';
import {
  OVERVIEW_ALERT, OVERVIEW_GET, type Overview, type OverviewAlertDetail, type OverviewErrorCode,
  type OverviewFilters, type OverviewResult, type OverviewSource, type SourceState,
} from '../../shared/overview';
import { readDemoActor } from '../data/bootstrap/demo-access';
import { createForgeJiraProjectAdapter, JiraBoundaryError, type JiraProjectAdapter, type JiraWorkItem } from '../data/jira';
import { getSqlApiError } from '../data/sql/client';
import { getProjectAccess } from '../data/sql/projects';
import { readOverviewAlert } from './alert';
import { readOverview } from './model';

type Request = { payload?: unknown; context?: unknown };
const AGENT_A17 = 'agent-x.projectEvidence.a17';
type Operation = typeof OVERVIEW_GET | typeof OVERVIEW_ALERT | typeof AGENT_A17;
type Jira = Pick<JiraProjectAdapter, 'projectId' | 'assertBrowsePermission' | 'searchWorkItems'>;

type OverviewLog = {
  requestId: string;
  operation: Operation;
  durationMs: number;
  code: OverviewErrorCode | 'READY' | 'PARTIAL';
  sources?: Array<Pick<OverviewSource, 'source' | 'state'>>;
  databaseError?: { code: string; status: number };
};

type Dependencies = {
  createJira(context: unknown): Jira;
  getAccess: typeof getProjectAccess;
  readOverview: typeof readOverview;
  readAlert: typeof readOverviewAlert;
  log(entry: OverviewLog): void;
  now(): Date;
};

const messages: Record<OverviewErrorCode, string> = {
  INVALID_FILTER: 'Revisá la fase y la fecha de corte.',
  AUTH_REQUIRED: 'Iniciá sesión en Jira para consultar el proyecto.',
  FORBIDDEN: 'La consulta solicitada no está disponible para esta cuenta.',
  NOT_READY: 'El proyecto todavía está preparando los datos del panel.',
  UNAVAILABLE: 'La consulta no respondió. Volvé a intentar.',
};

class OverviewFailure extends Error {
  constructor(readonly code: OverviewErrorCode) {
    super(messages[code]);
  }
}

function parseFilters(payload: unknown, operation: Operation): OverviewFilters {
  const alert = operation === OVERVIEW_ALERT;
  if (payload === undefined && !alert) {
    return {};
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new OverviewFailure('INVALID_FILTER');
  }
  const filters = payload as Record<string, unknown>;
  if (Reflect.ownKeys(filters).some((key) => key !== 'phaseCode' && key !== 'asOf' && (!alert || key !== 'code')) ||
      (alert && filters.code !== 'A-17')) {
    throw new OverviewFailure('INVALID_FILTER');
  }
  const { phaseCode, asOf } = filters;
  if (phaseCode !== undefined && (typeof phaseCode !== 'string' || !/^[A-Z0-9-]{1,24}$/.test(phaseCode))) {
    throw new OverviewFailure('INVALID_FILTER');
  }
  if (asOf !== undefined) {
    if (typeof asOf !== 'string' || !/^(19|20|21)\d\d-\d{2}-\d{2}$/.test(asOf)) {
      throw new OverviewFailure('INVALID_FILTER');
    }
    const date = new Date(asOf);
    if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== asOf) {
      throw new OverviewFailure('INVALID_FILTER');
    }
  }
  return {
    ...(phaseCode === undefined ? {} : { phaseCode }),
    ...(asOf === undefined ? {} : { asOf }),
  };
}

export async function readVisibleJiraIssues(jira: Jira): Promise<{
  issues: JiraWorkItem[] | null;
  state: SourceState;
}> {
  const maxPages = 4;
  const cursorHistory = new Set<string>();
  const issues = new Map<string, JiraWorkItem>();
  let nextPageToken: string | undefined;
  try {
    for (let page = 0; page < maxPages; page += 1) {
      const result = await jira.searchWorkItems({ pageSize: 100, nextPageToken });
      if (result.items.some((item) => item.projectId !== jira.projectId)) {
        return { issues: null, state: 'UNAVAILABLE' };
      }
      for (const item of result.items) {
        const prior = issues.get(item.id);
        if (!prior || item.updatedAt > prior.updatedAt) {
          issues.set(item.id, item);
        }
      }
      if (!result.nextPageToken) {
        return { issues: [...issues.values()], state: 'READY' };
      }
      if (cursorHistory.has(result.nextPageToken)) {
        break;
      }
      cursorHistory.add(result.nextPageToken);
      nextPageToken = result.nextPageToken;
    }
  } catch (error) {
    if (error instanceof NeedsAuthenticationError ||
        (error instanceof JiraBoundaryError && (error.code === 'AUTH_REQUIRED' || error.code === 'FORBIDDEN'))) {
      throw error;
    }
  }
  return issues.size
    ? { issues: [...issues.values()], state: 'PARTIAL' }
    : { issues: null, state: 'UNAVAILABLE' };
}

async function authorize(context: unknown, dependencies: Dependencies) {
  const actor = readDemoActor(context);
  if (!actor) {
    throw new OverviewFailure('AUTH_REQUIRED');
  }
  const jira = dependencies.createJira(context);
  await jira.assertBrowsePermission();
  const access = await dependencies.getAccess(jira.projectId, actor);
  if (!access || !access.roles.some((role) => role !== 'HSE_READER')) {
    throw new OverviewFailure('FORBIDDEN');
  }
  return { jira, projectId: access.projectId };
}

export function createOverviewResolvers(dependencies: Dependencies) {
  async function resolve<T>(
    operation: Operation, request: Request,
    fetch: (projectId: string, filters: OverviewFilters, jira: Awaited<ReturnType<typeof readVisibleJiraIssues>>,
      jiraProjectId: string) =>
      Promise<{ data: T; sources: Array<Pick<OverviewSource, 'source' | 'state'>> }>,
  ): Promise<OverviewResult<T>> {
    const requestId = randomUUID();
    const started = performance.now();
    function log(code: OverviewLog['code'], context?: Pick<OverviewLog, 'sources' | 'databaseError'>) {
      dependencies.log({
        requestId, operation, durationMs: Math.round(performance.now() - started), code,
        ...context,
      });
    }
    try {
      const filters = parseFilters(request.payload, operation);
      const { jira, projectId } = await authorize(request.context, dependencies);
      const result = await fetch(projectId, filters, await readVisibleJiraIssues(jira), jira.projectId);
      log(result.sources.every((source) => source.state === 'READY') ? 'READY' : 'PARTIAL', { sources: result.sources });
      return { ok: true, data: result.data, requestId };
    } catch (error) {
      if (error instanceof NeedsAuthenticationError) {
        log('AUTH_REQUIRED');
        throw error;
      }
      let code: OverviewErrorCode = 'UNAVAILABLE';
      if (error instanceof OverviewFailure) {
        code = error.code;
      } else if (error instanceof JiraBoundaryError && (error.code === 'AUTH_REQUIRED' || error.code === 'FORBIDDEN')) {
        code = error.code;
      }
      const databaseError = getSqlApiError(error);
      log(code, databaseError ? { databaseError: { code: databaseError.code, status: databaseError.responseDetails.status } } : undefined);
      return { ok: false, error: { code, message: messages[code] }, requestId };
    }
  }

  return {
    get: (request: Request) => resolve<Overview>(OVERVIEW_GET, request, async (projectId, filters, jira, jiraProjectId) => {
      const data = await dependencies.readOverview({
        projectId, filters, jiraIssues: jira.issues, jiraState: jira.state, observedAt: dependencies.now().toISOString(),
      });
      if (!data) {
        throw new OverviewFailure('NOT_READY');
      }
      return {
        data: { ...data, project: { ...data.project, jiraProjectId } },
        sources: data.sources.map(({ source, state }) => ({ source, state })),
      };
    }),
    alert: (request: Request) => resolve<OverviewAlertDetail>(OVERVIEW_ALERT, request, async (projectId, filters, jira) => {
      if (!jira.issues) {
        throw new OverviewFailure('UNAVAILABLE');
      }
      const data = await dependencies.readAlert({ projectId, filters, jiraIssues: jira.issues });
      if (!data) {
        throw new OverviewFailure('FORBIDDEN');
      }
      return { data, sources: [{ source: 'JIRA', state: jira.state }, { source: 'FORGE', state: 'READY' }] };
    }),
    agentA17: (request: Request) => resolve(AGENT_A17, request, async (projectId, filters, jira, jiraProjectId) => {
      if (!jira.issues) throw new OverviewFailure('UNAVAILABLE');
      const overview = await dependencies.readOverview({
        projectId, filters, jiraIssues: jira.issues, jiraState: jira.state, observedAt: dependencies.now().toISOString(),
      });
      if (!overview?.snapshot || overview.asOf !== overview.snapshot.asOf) throw new OverviewFailure('NOT_READY');
      const alert = await dependencies.readAlert({ projectId, filters: { asOf: overview.snapshot.asOf }, jiraIssues: jira.issues });
      if (!alert) throw new OverviewFailure('FORBIDDEN');
      const { project, snapshot, sources } = overview;
      return {
        data: { project: { ...project, jiraProjectId }, snapshot, sources, alert },
        sources: sources.map(({ source, state }) => ({ source, state })),
      };
    }),
  };
}

export const overviewResolvers = createOverviewResolvers({
  createJira: createForgeJiraProjectAdapter,
  getAccess: getProjectAccess,
  readOverview,
  readAlert: readOverviewAlert,
  now: () => new Date(),
  log: (entry) => console.info(JSON.stringify(entry)),
});
