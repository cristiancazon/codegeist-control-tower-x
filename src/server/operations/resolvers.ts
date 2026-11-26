import { randomUUID } from 'node:crypto';
import { NeedsAuthenticationError } from '@forge/api';
import {
  OPERATIONS_DETAIL, OPERATIONS_LIST, OPERATIONS_PAGE_SIZE, operationsSections,
  type OperationsDetail, type OperationsFilters, type OperationsPage, type OperationsPageContent,
  type OperationsResult, type OperationsSection, type OperationsSource,
} from '../../shared/operations';
import type { OverviewErrorCode } from '../../shared/overview';
import { readDemoActor } from '../data/bootstrap/demo-access';
import { createForgeJiraProjectAdapter, JiraBoundaryError, type JiraProjectAdapter } from '../data/jira';
import { isDateOnly } from '../data/jira/normalize';
import { executeSql, getSqlApiError } from '../data/sql/client';
import { getProjectAccess } from '../data/sql/projects';
import { readVisibleJiraIssues } from '../overview/resolvers';
import { listCatalog, readCatalogDetail } from './catalog';
import type { OperationsScope } from './scope';
import { canReadHse, listSummary, readSummaryDetail } from './summaries';
import { listWork, readWorkDetail } from './work';

type Request = { payload?: unknown; context?: unknown };
type Project = { name: string; key: string; snapshot: OperationsScope['snapshot'] };
type Operation = typeof OPERATIONS_LIST | typeof OPERATIONS_DETAIL;
type AccessJira = Pick<JiraProjectAdapter, 'projectId' | 'assertBrowsePermission' | 'searchWorkItems'>;
type Activity = {
  requestId: string;
  operation: Operation;
  durationMs: number;
  code: OverviewErrorCode | 'READY' | 'PARTIAL';
  sources?: Array<Pick<OperationsSource, 'source' | 'state'>>;
  databaseError?: { code: string; status: number };
};

const messages: Record<OverviewErrorCode, string> = {
  INVALID_FILTER: 'Revisá los filtros o la referencia solicitada.',
  AUTH_REQUIRED: 'Iniciá sesión en Jira para consultar el proyecto.',
  FORBIDDEN: 'La consulta solicitada no está disponible para esta cuenta.',
  NOT_READY: 'El proyecto todavía está preparando los datos de operaciones.',
  UNAVAILABLE: 'No se pudo completar la consulta. Volvé a intentar.',
};

class OperationsFailure extends Error {
  constructor(readonly code: OverviewErrorCode) {
    super(messages[code]);
  }
}

const textFilterNames = ['phaseCode', 'status', 'facilityCode', 'category', 'contractorCode', 'q'] as const;
const filterNames = new Set<string>([...textFilterNames, 'overdueOnly', 'from', 'to', 'page']);
const allowedSections = new Set<string>(operationsSections);

function parseRequest(payload: unknown, operation: Operation) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new OperationsFailure('INVALID_FILTER');
  }
  const input = payload as Record<string, unknown>;
  const section = input.section;
  if (typeof section !== 'string' || !allowedSections.has(section) || Reflect.ownKeys(input).some((key) =>
    key !== 'section' && (typeof key !== 'string' || (operation === OPERATIONS_DETAIL ? key !== 'code' : !filterNames.has(key))))) {
    throw new OperationsFailure('INVALID_FILTER');
  }

  const filters: OperationsFilters = {};
  if (operation === OPERATIONS_DETAIL) {
    if (typeof input.code !== 'string' || !/^[A-Z0-9_-]{1,48}$/.test(input.code)) {
      throw new OperationsFailure('INVALID_FILTER');
    }
    return { section: section as OperationsSection, code: input.code, filters };
  }
  for (const name of textFilterNames) {
    const value = input[name];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !/^[^\p{Cc}]{1,80}$/u.test(value) || value.trim() !== value || !value.trim()) {
      throw new OperationsFailure('INVALID_FILTER');
    }
    filters[name] = value;
  }
  for (const name of ['from', 'to'] as const) {
    const date = input[name];
    if (date === undefined) continue;
    if (!isDateOnly(date)) throw new OperationsFailure('INVALID_FILTER');
    filters[name] = date;
  }
  if (filters.from && filters.to && filters.from > filters.to) {
    throw new OperationsFailure('INVALID_FILTER');
  }
  if (input.overdueOnly !== undefined) {
    if (typeof input.overdueOnly !== 'boolean') throw new OperationsFailure('INVALID_FILTER');
    filters.overdueOnly = input.overdueOnly;
  }
  if (input.page !== undefined) {
    if (typeof input.page !== 'number' || !Number.isSafeInteger(input.page) || input.page < 1 || input.page > 200) {
      throw new OperationsFailure('INVALID_FILTER');
    }
    filters.page = input.page;
  }
  return { section: section as OperationsSection, filters };
}

export async function readOperationsProject(
  projectId: string, jiraProjectId: string, query: typeof executeSql = executeSql,
): Promise<Project | undefined> {
  const rows = await query<{ name: string; jira_project_key: string; as_of: string | null; collected_at: string | null }>(
    `SELECT p.name, p.jira_project_key, CAST(s.as_of_date AS CHAR) AS as_of, CAST(s.collected_at AS CHAR) AS collected_at
       FROM ctx_project p LEFT JOIN ctx_data_snapshot s
         ON s.project_id = p.id AND s.state = 'SEALED' AND s.access_class = 'SYNTHETIC_DEMO'
         AND s.expires_at > UTC_TIMESTAMP(3)
       WHERE p.id = ? AND p.jira_project_id = ? AND p.status = 'ACTIVE' AND p.data_mode = 'DEMO'
       ORDER BY s.as_of_date DESC, s.collected_at DESC, s.id DESC LIMIT 1`,
    [projectId, jiraProjectId],
  );
  const row = rows[0];
  if (!row) return undefined;
  const timestamp = row.collected_at?.replace(' ', 'T');
  const instant = timestamp ? new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ? timestamp : timestamp + 'Z') : null;
  return {
    name: row.name, key: row.jira_project_key,
    snapshot: isDateOnly(row.as_of) && instant && !Number.isNaN(instant.valueOf())
      ? { asOf: row.as_of, collectedAt: instant.toISOString() } : null,
  };
}

function isSummary(section: OperationsSection): section is 'hse' | 'financial' | 'knowledge' {
  return section === 'hse' || section === 'financial' || section === 'knowledge';
}

type Dependencies = {
  createJira: (context: unknown) => AccessJira;
  getAccess: typeof getProjectAccess;
  readProject: typeof readOperationsProject;
  list(section: OperationsSection, scope: OperationsScope, filters: OperationsFilters): Promise<OperationsPageContent | undefined>;
  detail(section: OperationsSection, scope: OperationsScope, code: string): Promise<OperationsDetail | undefined>;
  log(entry: Activity): void;
};

export function createOperationsResolvers(dependencies: Dependencies) {
  async function resolve<T extends { sources: OperationsSource[] }>(
    operation: Operation, request: Request,
    fetch: (input: ReturnType<typeof parseRequest>, scope: OperationsScope, project: Project) => Promise<T | undefined>,
  ): Promise<OperationsResult<T>> {
    const requestId = randomUUID();
    const start = performance.now();
    function log(code: Activity['code'], context?: Pick<Activity, 'sources' | 'databaseError'>) {
      dependencies.log({ requestId, operation, code, durationMs: Math.round(performance.now() - start), ...context });
    }
    try {
      const input = parseRequest(request.payload, operation);
      const actor = readDemoActor(request.context);
      if (!actor) throw new OperationsFailure('AUTH_REQUIRED');
      const jira = dependencies.createJira(request.context);
      await jira.assertBrowsePermission();
      const access = await dependencies.getAccess(jira.projectId, actor);
      if (!access || !access.roles.some((role) => role !== 'HSE_READER') || (input.section === 'hse' && !canReadHse(access))) {
        throw new OperationsFailure('FORBIDDEN');
      }
      const project = await dependencies.readProject(access.projectId, jira.projectId);
      if (!project) throw new OperationsFailure('NOT_READY');
      const { issues, state } = await readVisibleJiraIssues(jira);
      const scope: OperationsScope = {
        ...access, jiraProjectId: jira.projectId, snapshot: project.snapshot, jiraState: state,
        observedAt: new Date().toISOString(),
        jiraIssues: new Map(issues?.map((issue) => [issue.id, issue])),
      };
      const data = await fetch(input, scope, project);
      if (!data) throw new OperationsFailure(state === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'FORBIDDEN');
      const sources = data.sources.map(({ source, state }) => ({ source, state }));
      log(sources.some(({ state }) => state === 'UNAVAILABLE' || state === 'PARTIAL') ? 'PARTIAL' : 'READY', { sources });
      return { ok: true, data, requestId };
    } catch (error) {
      if (error instanceof NeedsAuthenticationError) {
        log('AUTH_REQUIRED');
        throw error;
      }
      const code = error instanceof OperationsFailure ? error.code
        : error instanceof JiraBoundaryError && (error.code === 'AUTH_REQUIRED' || error.code === 'FORBIDDEN')
          ? error.code : 'UNAVAILABLE';
      const databaseError = getSqlApiError(error);
      log(code, databaseError ? {
        databaseError: { code: databaseError.code, status: databaseError.responseDetails.status },
      } : undefined);
      return { ok: false, error: { code, message: messages[code] }, requestId };
    }
  }
  return {
    list: (request: Request) => resolve<OperationsPage>(OPERATIONS_LIST, request, async (input, scope, project) => {
      const result = await dependencies.list(input.section, scope, input.filters);
      return result ? {
        ...result, project: { name: project.name, key: project.key }, asOf: project.snapshot?.asOf ?? null,
        page: input.filters.page ?? 1, pageSize: OPERATIONS_PAGE_SIZE,
      } : undefined;
    }),
    detail: (request: Request) => resolve<OperationsDetail>(OPERATIONS_DETAIL, request, (input, scope) =>
      dependencies.detail(input.section, scope, input.code!)),
  };
}

export const operationsResolvers = createOperationsResolvers({
  createJira: createForgeJiraProjectAdapter, getAccess: getProjectAccess, readProject: readOperationsProject,
  list: (section, scope, filters) => {
    if (section === 'work') return listWork(scope, filters);
    return isSummary(section) ? listSummary(section, scope, filters) : listCatalog(section, scope, filters);
  },
  detail: (section, scope, code) => {
    if (section === 'work') return readWorkDetail(scope, code);
    return isSummary(section) ? readSummaryDetail(section, scope, code) : readCatalogDetail(section, scope, code);
  },
  log: (entry) => console.info(JSON.stringify(entry)),
});
