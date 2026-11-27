import { NeedsAuthenticationError, route, type Route } from '@forge/api';
import { performance } from 'node:perf_hooks';
import { assertCorrectiveInput, correctiveDescription, correctiveFields, keyBelongsToProject, matchesCorrectiveFields,
  matchesCorrectiveMarker } from './correctives';
import {
  isDateOnly, isFixtureMarker, isIssueKey, isJiraId, isRecord, isText, normalizeWorkItem, readIssueIdentity,
} from './normalize';
import {
  BOOTSTRAP_PERMISSIONS, JiraBoundaryError, type JiraCorrectiveIssueInput, type JiraFixtureTaskInput, type JiraIssueIdentity, type JiraPermission,
  type JiraProjectIdentity, type JiraRequest, type JiraSearchOptions, type JiraTaskCreateMetadata,
  type JiraWorkItem, type JiraWorkItemPage,
} from './types';

const ISSUE_FIELDS = ['project', 'issuetype', 'summary', 'status', 'assignee', 'duedate', 'updated', 'labels'];
const DEFAULT_INVOCATION_BUDGET_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;
const CREATE_METADATA_MAX_PAGES = 4;
const CREATE_METADATA_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const ACCEPT_JSON = { Accept: 'application/json' };
const TASK_TYPE_NAMES = ['task', 'tarea'];

function standardFailure(status: number, retryAfterSeconds?: number): JiraBoundaryError {
  const options = { status, retryAfterSeconds };
  switch (status) {
    case 400:
    case 422:
      return new JiraBoundaryError('VALIDATION_ERROR', 'Jira rechazó la solicitud.', options);
    case 401:
      return new JiraBoundaryError('AUTH_REQUIRED', 'Se requiere una sesión autorizada de Jira.', options);
    case 403:
    case 404:
      return new JiraBoundaryError('FORBIDDEN', 'El recurso Jira no está disponible para esta cuenta.', options);
    case 429:
      return new JiraBoundaryError('RATE_LIMITED', 'Jira limitó la frecuencia de solicitudes.', options);
    default:
      return new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira no confirmó la respuesta esperada.', options);
  }
}

function reconciliationFailure(status?: number, retryAfterSeconds?: number): JiraBoundaryError {
  return new JiraBoundaryError('RECONCILIATION_REQUIRED', 'Jira no confirmó el resultado de la creación. Requiere conciliación.', { status, retryAfterSeconds });
}

function retryAfterSeconds(value: string | null | undefined): number | undefined {
  if (typeof value === 'string' && /^[0-9]{1,9}$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

function isDefinitePostRejection(status: number, create: 'fixture' | 'corrective'): boolean {
  return status === 400 || status === 401 || status === 403 || status === 422 ||
    (create === 'fixture' && (status === 404 || status === 429));
}

function readTaskTypeId(issueTypes: unknown[]): string {
  const taskIds = new Set<string>();
  for (const type of issueTypes) {
    if (isRecord(type) && typeof type.name === 'string' && TASK_TYPE_NAMES.includes(type.name.trim().toLowerCase()) &&
        type.subtask === false && isJiraId(type.id)) {
      taskIds.add(type.id);
    }
  }
  const [issueTypeId] = taskIds;
  if (taskIds.size !== 1 || !issueTypeId) {
    throw new JiraBoundaryError('CONFLICT', 'El proyecto Jira debe ofrecer un único tipo de trabajo Tarea (Task).');
  }
  return issueTypeId;
}

export function createJiraProjectAdapter(projectId: string, request: JiraRequest, budgetMs = DEFAULT_INVOCATION_BUDGET_MS) {
  if (!isJiraId(projectId) || !Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > DEFAULT_INVOCATION_BUDGET_MS) {
    throw new JiraBoundaryError('VALIDATION_ERROR', 'El contexto o presupuesto Jira no es válido.');
  }

  const deadline = performance.now() + budgetMs;
  let browseConfirmed = false;

  async function requestJson(path: Route, options: { body?: unknown; create?: 'fixture' | 'corrective' } = {}): Promise<unknown> {
    const requestBudget = Math.min(REQUEST_TIMEOUT_MS, Math.floor(deadline - performance.now()));
    if (requestBudget <= 0) {
      throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'La verificación Jira excedió el tiempo de esta invocación.');
    }

    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const controller = new AbortController();
    const timeoutError = new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira no respondió dentro del plazo.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(timeoutError);
      }, requestBudget);
    });

    const readResponse = async (): Promise<unknown> => {
      let response: Awaited<ReturnType<JiraRequest>>;
      try {
        response = await request(path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: body === undefined ? { ...ACCEPT_JSON } : { ...ACCEPT_JSON, 'Content-Type': 'application/json' },
          signal: controller.signal,
          ...(body === undefined ? {} : { body }),
        });
      } catch (error) {
        if (error instanceof NeedsAuthenticationError && options.create !== 'corrective') {
          // Forge uses this exception to prompt for user consent.
          throw error;
        }
        const status = isRecord(error) ? error.status ?? error.statusCode : undefined;
        if (options.create) {
          // Only an observed HTTP response confirms a definite rejection.
          throw reconciliationFailure(typeof status === 'number' ? status : undefined);
        }
        throw typeof status === 'number' ? standardFailure(status) : timeoutError;
      }

      if (response.status !== (options.create ? 201 : 200)) {
        if (options.create && !isDefinitePostRejection(response.status, options.create)) {
          throw reconciliationFailure(response.status, retryAfterSeconds(response.headers?.get('Retry-After')));
        }
        throw standardFailure(response.status, retryAfterSeconds(response.headers?.get('Retry-After')));
      }

      try {
        return await response.json();
      } catch {
        throw options.create ? reconciliationFailure(response.status) : new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira devolvió una respuesta inválida.');
      }
    };

    try {
      return await Promise.race([readResponse(), timeout]);
    } catch (error) {
      if (options.create && error === timeoutError) {
        throw reconciliationFailure();
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkPermissions(permissions: readonly JiraPermission[]): Promise<Partial<Record<JiraPermission, boolean>>> {
    if (!permissions.length || permissions.some((permission) => !BOOTSTRAP_PERMISSIONS.includes(permission))) {
      throw new JiraBoundaryError('VALIDATION_ERROR', 'El permiso Jira solicitado no se reconoce.');
    }

    const uniquePermissions = [...new Set(permissions)];
    const query = new URLSearchParams({ projectId, permissions: uniquePermissions.join(',') });
    const body = await requestJson(route`/rest/api/3/mypermissions?${query}`);
    if (!isRecord(body) || !isRecord(body.permissions)) {
      throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira no confirmó los permisos del proyecto.');
    }

    const result: Partial<Record<JiraPermission, boolean>> = {};
    for (const permission of uniquePermissions) {
      const value = body.permissions[permission];
      if (!isRecord(value) || typeof value.havePermission !== 'boolean') {
        throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira no confirmó los permisos del proyecto.');
      }
      result[permission] = value.havePermission;
    }
    return result;
  }

  async function requireBrowsePermission(): Promise<void> {
    if (!browseConfirmed) {
      const { BROWSE_PROJECTS: browse } = await checkPermissions(['BROWSE_PROJECTS']);
      if (!browse) {
        throw new JiraBoundaryError('FORBIDDEN', 'La cuenta no puede leer este proyecto Jira.');
      }
      browseConfirmed = true;
    }
  }

  async function assertBootstrapPermissions(): Promise<void> {
    const permissions = await checkPermissions(BOOTSTRAP_PERMISSIONS);
    if (BOOTSTRAP_PERMISSIONS.some((permission) => permissions[permission] !== true)) {
      browseConfirmed = false;
      throw new JiraBoundaryError('FORBIDDEN', 'La cuenta carece de los permisos Jira requeridos para la carga de prueba.');
    }
    browseConfirmed = true;
  }

  function readProject(body: unknown): JiraProjectIdentity {
    if (!isRecord(body) || body.id !== projectId || !isText(body.key, 40) || !isText(body.name, 255)) {
      throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira no confirmó la identidad del proyecto actual.');
    }
    return { id: projectId, key: body.key, name: body.name };
  }

  async function getProject(): Promise<JiraProjectIdentity> {
    await requireBrowsePermission();
    return readProject(await requestJson(route`/rest/api/3/project/${projectId}`));
  }

  async function getProjectWithTaskType(): Promise<JiraProjectIdentity & { taskIssueTypeId: string }> {
    await requireBrowsePermission();
    const body = await requestJson(route`/rest/api/3/project/${projectId}?expand=issueTypes`);
    const project = readProject(body);
    if (!isRecord(body) || !Array.isArray(body.issueTypes) || body.issueTypes.length > 250) {
      throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira no confirmó los tipos de trabajo del proyecto.');
    }
    return { ...project, taskIssueTypeId: readTaskTypeId(body.issueTypes) };
  }

  async function readCreateMetadataPages(pagePath: (offset: number) => Route, property: 'issueTypes' | 'fields'): Promise<unknown[]> {
    let offset = 0;
    const items: unknown[] = [];
    for (let page = 0; page < CREATE_METADATA_MAX_PAGES; page += 1) {
      const body = await requestJson(pagePath(offset));
      if (!isRecord(body) || body.startAt !== offset || typeof body.total !== 'number' || !Number.isSafeInteger(body.total) ||
          body.total < offset || !Array.isArray(body[property]) || body[property].length > CREATE_METADATA_PAGE_SIZE) {
        throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira devolvió metadatos de creación incompletos.');
      }
      const pageItems = body[property];
      if (offset + pageItems.length > body.total || (pageItems.length === 0 && offset < body.total)) {
        throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira devolvió una página de metadatos incoherente.');
      }
      items.push(...pageItems);
      offset += pageItems.length;
      if (offset === body.total) {
        return items;
      }
    }
    throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Los metadatos Jira superan el límite de páginas admitido.');
  }

  async function getTaskCreateMetadata(): Promise<JiraTaskCreateMetadata> {
    await requireBrowsePermission();
    const issueTypes = await readCreateMetadataPages((startAt) =>
      route`/rest/api/3/issue/createmeta/${projectId}/issuetypes?startAt=${startAt}&maxResults=${CREATE_METADATA_PAGE_SIZE}`, 'issueTypes');
    const issueTypeId = readTaskTypeId(issueTypes);

    const fields = await readCreateMetadataPages((startAt) =>
      route`/rest/api/3/issue/createmeta/${projectId}/issuetypes/${issueTypeId}?startAt=${startAt}&maxResults=${CREATE_METADATA_PAGE_SIZE}`, 'fields');
    const writable = new Set<string>();
    const requiredWithoutDefault = new Set<string>();
    for (const field of fields) {
      if (!isRecord(field)) {
        throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira devolvió metadatos de campo incompletos.');
      }
      const fieldId = field.fieldId ?? field.key;
      if (!isText(fieldId, 128) || typeof field.required !== 'boolean') {
        throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira devolvió metadatos de campo incompletos.');
      }
      if (Array.isArray(field.operations) && field.operations.includes('set')) {
        writable.add(fieldId);
      }
      if (field.required && field.hasDefaultValue !== true) {
        requiredWithoutDefault.add(fieldId);
      }
    }
    const supported = ['project', 'issuetype', 'summary', 'description', 'labels', 'duedate'];
    if (['summary', 'description', 'labels'].some((field) => !writable.has(field)) ||
        [...requiredWithoutDefault].some((field) => !supported.includes(field)) ||
        (requiredWithoutDefault.has('duedate') && !writable.has('duedate'))) {
      throw new JiraBoundaryError('CONFLICT', 'La pantalla de creación de tareas no admite los campos del fixture.');
    }

    return {
      issueTypeId,
      supportsDueDate: writable.has('duedate'),
      requiresDueDate: requiredWithoutDefault.has('duedate'),
    };
  }

  async function searchWorkItems(
    { marker, nextPageToken, pageSize = 50 }: JiraSearchOptions = {}, method: 'GET' | 'POST' = 'POST',
  ): Promise<JiraWorkItemPage> {
    if ((marker !== undefined && !isFixtureMarker(marker)) || (nextPageToken !== undefined && !isText(nextPageToken, 4096)) ||
        !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new JiraBoundaryError('VALIDATION_ERROR', 'Los filtros de Jira no son válidos.');
    }

    await requireBrowsePermission();
    const jql = `project = ${projectId}${marker === undefined ? '' : ` AND labels = "${marker}"`} ORDER BY id ASC`;
    const continuation = nextPageToken === undefined ? {} : { nextPageToken };
    const parameters = new URLSearchParams({ jql, fields: ISSUE_FIELDS.join(','), maxResults: String(pageSize) });
    if (nextPageToken !== undefined) parameters.set('nextPageToken', nextPageToken);
    const body = method === 'GET'
      ? await requestJson(route`/rest/api/3/search/jql?${parameters}`)
      : await requestJson(route`/rest/api/3/search/jql`, {
        body: { jql, fields: ISSUE_FIELDS, maxResults: pageSize, ...continuation },
      });
    if (!isRecord(body) || !Array.isArray(body.issues) || body.issues.length > pageSize ||
        (body.nextPageToken != null && (!isText(body.nextPageToken, 4096) || body.nextPageToken === nextPageToken)) ||
        (body.isLast === false && body.nextPageToken == null) || (body.isLast === true && body.nextPageToken != null)) {
      throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira devolvió una página de búsqueda incompleta.');
    }

    // Jira can return an issue again after an update or between cursor pages.
    const items = new Map<string, JiraWorkItem>();
    for (const raw of body.issues) {
      const item = normalizeWorkItem(raw, projectId);
      if (marker !== undefined) {
        const markers = item.labels.filter(isFixtureMarker);
        if (markers.length !== 1 || markers[0] !== marker) {
          throw new JiraBoundaryError('CONFLICT', 'El marcador del fixture Jira es incoherente.');
        }
      }
      const existing = items.get(item.id);
      if (!existing || item.updatedAt > existing.updatedAt) {
        items.set(item.id, item);
      }
    }
    return { items: [...items.values()], nextPageToken: body.nextPageToken ?? null };
  }

  async function getWorkItem(issueIdOrKey: string): Promise<JiraWorkItem> {
    if (!isJiraId(issueIdOrKey) && !isIssueKey(issueIdOrKey)) {
      throw new JiraBoundaryError('VALIDATION_ERROR', 'La referencia del ítem Jira no es válida.');
    }

    await requireBrowsePermission();
    const query = new URLSearchParams({ fields: ISSUE_FIELDS.join(',') });
    const body = await requestJson(route`/rest/api/3/issue/${issueIdOrKey}?${query}`);
    const item = normalizeWorkItem(body, projectId);
    if (isJiraId(issueIdOrKey) && item.id !== issueIdOrKey) {
      throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira no confirmó la identidad del ítem de trabajo.');
    }
    return item;
  }

  async function createFixtureTask(input: JiraFixtureTaskInput): Promise<JiraIssueIdentity> {
    if (!isJiraId(input.issueTypeId) || !isFixtureMarker(input.marker) || !isText(input.summary, 255) ||
        !isText(input.description, 4000) || (input.dueDate !== undefined && !isDateOnly(input.dueDate))) {
      throw new JiraBoundaryError('VALIDATION_ERROR', 'Los datos del fixture Jira no son válidos.');
    }

    // The coordinator validates the demo allowlist, current metadata and durable reservation before calling.
    await assertBootstrapPermissions();
    const description = {
      version: 1,
      type: 'doc',
      content: input.description.split(/\r?\n/).map((text) => ({
        type: 'paragraph',
        content: text.length ? [{ type: 'text', text }] : [],
      })),
    };
    const body = await requestJson(route`/rest/api/3/issue`, {
      create: 'fixture',
      body: { fields: {
        project: { id: projectId },
        issuetype: { id: input.issueTypeId },
        summary: input.summary,
        description,
        labels: [input.marker],
        ...(input.dueDate === undefined ? {} : { duedate: input.dueDate }),
      } },
    });
    const identity = readIssueIdentity(body);
    if (!identity) {
      throw reconciliationFailure(201);
    }
    return identity;
  }

  async function assertCorrectiveCreateTarget(issueTypeId: string) {
    if (!isJiraId(issueTypeId)) throw new JiraBoundaryError('VALIDATION_ERROR', 'El tipo del correctivo Jira no es válido.');
    const permissions = await checkPermissions(['BROWSE_PROJECTS', 'CREATE_ISSUES']);
    if (permissions.BROWSE_PROJECTS !== true || permissions.CREATE_ISSUES !== true) {
      browseConfirmed = false;
      throw new JiraBoundaryError('FORBIDDEN', 'La cuenta carece de permisos Jira para crear el correctivo.');
    }
    browseConfirmed = true;
    const [metadata, project] = await Promise.all([getTaskCreateMetadata(), getProject()]);
    if (metadata.issueTypeId !== issueTypeId || metadata.requiresDueDate || !isIssueKey(`${project.key}-1`)) {
      throw new JiraBoundaryError('CONFLICT', 'El destino Jira no admite los campos aprobados del correctivo.');
    }
    return project;
  }

  async function createCorrectiveIssue(input: JiraCorrectiveIssueInput): Promise<JiraIssueIdentity> {
    assertCorrectiveInput(input);
    const { key: projectKey } = await assertCorrectiveCreateTarget(input.issueTypeId);
    if (projectKey !== input.projectKey) throw new JiraBoundaryError('CONFLICT', 'El destino Jira cambió después de la aprobación.');
    const body = await requestJson(route`/rest/api/3/issue`, {
      create: 'corrective',
      body: { fields: {
        project: { id: projectId }, issuetype: { id: input.issueTypeId }, summary: input.summary,
        description: correctiveDescription(input.description), labels: [input.marker],
      } },
    });
    const identity = readIssueIdentity(body);
    if (!identity || !keyBelongsToProject(identity.key, projectKey)) throw reconciliationFailure(201);
    return identity;
  }

  async function findCorrectiveByMarker(input: JiraCorrectiveIssueInput): Promise<JiraIssueIdentity | undefined> {
    assertCorrectiveInput(input);
    const permissions = await checkPermissions(['BROWSE_PROJECTS']);
    if (permissions.BROWSE_PROJECTS !== true) throw new JiraBoundaryError('FORBIDDEN', 'La cuenta no puede consultar el proyecto Jira.');
    const parameters = new URLSearchParams({
      jql: `project = ${projectId} AND labels = "${input.marker}" ORDER BY id ASC`, fields: 'project,labels', maxResults: '2',
    });
    const search = await requestJson(route`/rest/api/3/search/jql?${parameters}`);
    if (!isRecord(search) || search.isLast !== true || !Array.isArray(search.issues) || search.issues.length !== 1 ||
      search.nextPageToken != null) return undefined;
    const candidate = search.issues[0];
    const found = readIssueIdentity(candidate);
    if (!found || !matchesCorrectiveMarker(candidate, projectId, input.marker)) return undefined;
    const fields = new URLSearchParams({ fields: correctiveFields });
    let live: unknown;
    try {
      live = await requestJson(route`/rest/api/3/issue/${found.id}?${fields}`);
    } catch (error) {
      if (error instanceof JiraBoundaryError && error.code === 'FORBIDDEN') return undefined;
      throw error;
    }
    const confirmed = readIssueIdentity(live);
    return confirmed?.id === found.id && confirmed.key === found.key && matchesCorrectiveFields(live, projectId, found.key, input)
      ? confirmed : undefined;
  }

  return {
    projectId, checkPermissions, assertBrowsePermission: requireBrowsePermission, assertBootstrapPermissions,
    getProject, getProjectWithTaskType, getTaskCreateMetadata, searchWorkItems,
    searchWorkItemsGet: (options: JiraSearchOptions) => searchWorkItems(options, 'GET'), getWorkItem, createFixtureTask,
    assertCorrectiveCreateTarget, createCorrectiveIssue, findCorrectiveByMarker,
  };
}

export type JiraProjectAdapter = ReturnType<typeof createJiraProjectAdapter>;
