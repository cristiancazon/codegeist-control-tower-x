import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NeedsAuthenticationError } from '@forge/api';
import { createJiraProjectAdapter, JiraBoundaryError, type JiraCorrectiveIssueInput, type JiraRequest } from './index';

const projectId = '10001';
const issueTypeId = '10002';
const marker = 'ctx-decision-12345678-1111-4222-a333-123456789012';
const input: JiraCorrectiveIssueInput = { issueTypeId, projectKey: 'PED', marker, summary: 'Coordinar suministro A-17',
  description: 'Aprobado para coordinación.\n\nRevisar evidencia y confirmar con el proveedor.' };
const issue = { id: '10999', key: 'PED-104' };
const description = { version: 1, type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: 'Aprobado para coordinación.' }] },
  { type: 'paragraph', content: [] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Revisar evidencia y confirmar con el proveedor.' }] },
] };
const current = { ...issue, self: 'https://hostile.invalid', fields: {
  project: { id: projectId, key: 'PED' }, issuetype: { id: issueTypeId }, summary: input.summary, description, labels: [marker],
} };
type Response = Awaited<ReturnType<JiraRequest>>;

function response(body: unknown, status = 200, retry?: string): Response {
  return { status, headers: { get: (name) => name === 'Retry-After' ? retry ?? null : null }, json: async () => body };
}

function field(fieldId: string, required = false, operations = ['set']) {
  return { fieldId, required, operations, hasDefaultValue: false };
}

function harness(overrides: {
  browse?: boolean; create?: boolean; fields?: ReturnType<typeof field>[]; types?: unknown[]; post?: () => Promise<Response>;
  search?: () => Promise<Response>; live?: () => Promise<Response>; budgetMs?: number;
} = {}) {
  const calls: Array<{ path: URL; method: string; body?: string }> = [];
  const jira = createJiraProjectAdapter(projectId, async (route, { method, body }) => {
    const path = new URL(route.value, 'https://jira.invalid');
    calls.push({ path, method, body });
    if (path.pathname === '/rest/api/3/mypermissions') {
      assert.equal(path.searchParams.get('projectId'), projectId);
      return response({ permissions: {
        BROWSE_PROJECTS: { havePermission: overrides.browse ?? true }, CREATE_ISSUES: { havePermission: overrides.create ?? true },
      } });
    }
    if (path.pathname === `/rest/api/3/project/${projectId}`) return response({ id: projectId, key: 'PED', name: 'Patagonia' });
    if (path.pathname === `/rest/api/3/issue/createmeta/${projectId}/issuetypes`) {
      const issueTypes = overrides.types ?? [{ id: issueTypeId, name: 'Task', subtask: false }];
      return response({ startAt: 0, total: issueTypes.length, issueTypes });
    }
    if (path.pathname === `/rest/api/3/issue/createmeta/${projectId}/issuetypes/${issueTypeId}`) {
      const fields = overrides.fields ?? [field('summary', true), field('description'), field('labels')];
      return response({ startAt: 0, total: fields.length, fields });
    }
    if (path.pathname === '/rest/api/3/issue' && method === 'POST') {
      return overrides.post ? overrides.post() : response({ ...issue, self: 'https://hostile.invalid' }, 201);
    }
    if (path.pathname === '/rest/api/3/search/jql') return overrides.search ? overrides.search() : response({ isLast: true, issues: [current] });
    if (path.pathname === `/rest/api/3/issue/${issue.id}`) return overrides.live ? overrides.live() : response(current);
    return assert.fail(`Unexpected Jira request: ${path}`);
  }, overrides.budgetMs);
  return { jira, calls };
}

function failsWith(code: JiraBoundaryError['code'], status?: number) {
  return (error: unknown) => error instanceof JiraBoundaryError && error.code === code && (status === undefined || error.status === status);
}

test('CT009-03 sends a single minimal approved create request and returns only a project-bound 201 identity', async () => {
  const { jira, calls } = harness();
  assert.deepEqual(await jira.assertCorrectiveCreateTarget(input.issueTypeId), { id: projectId, key: 'PED', name: 'Patagonia' });
  assert.ok(calls.every(({ method }) => method === 'GET'));
  calls.length = 0;
  assert.deepEqual(await jira.createCorrectiveIssue(input), issue);
  assert.equal(calls[0]?.path.searchParams.get('permissions'), 'BROWSE_PROJECTS,CREATE_ISSUES');
  assert.ok(calls.slice(0, -1).every(({ method }) => method === 'GET'));
  const posts = calls.filter(({ method }) => method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.path.pathname, '/rest/api/3/issue');
  assert.deepEqual(JSON.parse(posts[0]?.body ?? ''), { fields: { project: { id: projectId }, issuetype: { id: issueTypeId },
    summary: input.summary, description, labels: [marker] } });
});

test('CT009-03 denies revoked Browse/Create, wrong Task, unsafe values or unsupported create-screen fields before POST', async () => {
  for (const denied of [{ browse: false }, { create: false }]) {
    const { jira, calls } = harness(denied);
    await assert.rejects(jira.createCorrectiveIssue(input), failsWith('FORBIDDEN'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, 'GET');
  }
  for (const fields of [[field('summary', true), field('description')],
    [field('summary', true), field('description'), field('labels', false, ['add'])],
    [field('summary'), field('description'), field('labels'), field('duedate', true)],
    [field('summary'), field('description'), field('labels'), field('customfield_10000', true)]]) {
    const { jira, calls } = harness({ fields });
    await assert.rejects(jira.createCorrectiveIssue(input), failsWith('CONFLICT'));
    assert.ok(calls.every(({ method }) => method === 'GET'));
  }
  const otherTask = harness();
  await assert.rejects(otherTask.jira.createCorrectiveIssue({ ...input, issueTypeId: '10003' }), failsWith('CONFLICT'));
  assert.ok(otherTask.calls.every(({ method }) => method === 'GET'));
  const malformed = harness();
  for (const values of [{ marker: `${marker}" OR project is not EMPTY` }, { summary: 'A\n17' }, { description: 'A\u202e17' }]) {
    await assert.rejects(malformed.jira.createCorrectiveIssue({ ...input, ...values }), failsWith('VALIDATION_ERROR'));
  }
  assert.deepEqual(malformed.calls, []);
});

test('CT009-04 never retries uncertain creates and preserves definitive HTTP errors separately', async () => {
  const consent = new NeedsAuthenticationError('Authentication Required', 'test');
  const indefinite: Array<() => Promise<Response>> = [async () => response({}, 500), async () => response({}, 200),
    async () => response({}, 404), async () => response({ id: '10789' }, 201),
    async () => response({ ...issue, key: 'OTHER-1' }, 201), async () => { throw new Error('request lost'); },
    async () => { throw consent; }, async () => ({ status: 201, json: async () => { throw new Error('body lost'); } })];
  for (const post of indefinite) {
    const { jira, calls } = harness({ post });
    await assert.rejects(jira.createCorrectiveIssue(input), failsWith('RECONCILIATION_REQUIRED'));
    assert.equal(calls.filter(({ method }) => method === 'POST').length, 1);
  }
  const throttled = harness({ post: async () => response({}, 429, '17') });
  await assert.rejects(throttled.jira.createCorrectiveIssue(input), (error: unknown) =>
    failsWith('RECONCILIATION_REQUIRED', 429)(error) && (error as JiraBoundaryError).retryAfterSeconds === 17);
  assert.equal(throttled.calls.filter(({ method }) => method === 'POST').length, 1);
  const timeout = harness({ post: async () => new Promise(() => {}), budgetMs: 100 });
  await assert.rejects(timeout.jira.createCorrectiveIssue(input), failsWith('RECONCILIATION_REQUIRED'));
  assert.equal(timeout.calls.filter(({ method }) => method === 'POST').length, 1);
  for (const [status, expectedCode] of [[400, 'VALIDATION_ERROR'], [401, 'AUTH_REQUIRED'], [403, 'FORBIDDEN'],
    [422, 'VALIDATION_ERROR']] as const) {
    const { jira, calls } = harness({ post: async () => response({ text: 'private remote error' }, status) });
    await assert.rejects(jira.createCorrectiveIssue(input), failsWith(expectedCode, status));
    assert.equal(calls.filter(({ method }) => method === 'POST').length, 1);
  }
});

test('CT009-04 reconciles one exact marker with a current issue GET and never writes', async () => {
  const { jira, calls } = harness({ create: false });
  assert.deepEqual(await jira.findCorrectiveByMarker(input), issue);
  assert.deepEqual(calls.map(({ method }) => method), ['GET', 'GET', 'GET']);
  assert.equal(calls[0]?.path.searchParams.get('permissions'), 'BROWSE_PROJECTS');
  assert.equal(calls[1]?.path.searchParams.get('jql'), `project = ${projectId} AND labels = "${marker}" ORDER BY id ASC`);
  assert.equal(calls[1]?.path.searchParams.get('maxResults'), '2');
  assert.equal(calls[2]?.path.pathname, `/rest/api/3/issue/${issue.id}`);
  assert.equal(calls[2]?.path.searchParams.get('fields'), 'project,issuetype,summary,description,labels');
});

test('CT009-04 keeps zero, multi, partial, stale or mismatched reconciliation candidates unresolved', async () => {
  for (const candidate of [{ issues: [current], isLast: false }, { issues: [current] },
    { issues: [current], isLast: true, nextPageToken: 'unexpected' }, { issues: [], isLast: true },
    { issues: [current, { ...current, id: '10888' }], isLast: true },
    { issues: [{ ...current, fields: { ...current.fields, labels: [marker + '-near'] } }], isLast: true }]) {
    const { jira, calls } = harness({ search: async () => response(candidate) });
    assert.equal(await jira.findCorrectiveByMarker(input), undefined);
    assert.deepEqual(calls.map(({ method }) => method), ['GET', 'GET']);
  }
  for (const changed of [{ ...current, key: 'PED-999' }, { ...current, id: '10888' },
    { ...current, fields: { ...current.fields, summary: 'Material changed' } },
    { ...current, fields: { ...current.fields, project: { id: '10303', key: 'OTHER' } } },
    { ...current, fields: { ...current.fields, issuetype: { id: '10303' } } },
    { ...current, fields: { ...current.fields, labels: [marker, 'other'] } },
    { ...current, fields: { ...current.fields, description: { ...description, content: [] } } }]) {
    const { jira, calls } = harness({ live: async () => response(changed) });
    assert.equal(await jira.findCorrectiveByMarker(input), undefined);
    assert.deepEqual(calls.map(({ method }) => method), ['GET', 'GET', 'GET']);
  }
  const hidden = harness({ live: async () => response({}, 404) });
  assert.equal(await hidden.jira.findCorrectiveByMarker(input), undefined);
  assert.deepEqual(hidden.calls.map(({ method }) => method), ['GET', 'GET', 'GET']);
});
