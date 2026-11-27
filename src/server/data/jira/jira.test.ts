import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NeedsAuthenticationError } from '@forge/api';
import {
  BOOTSTRAP_PERMISSIONS, createForgeJiraProjectAdapter, createJiraProjectAdapter, fixtureMarker, JiraBoundaryError,
  reconcileFixtureTask, type JiraBoundaryErrorCode, type JiraRequest,
} from './index';

const projectId = '10001';
const marker = fixtureMarker('WP-048');
const fixture = {
  issueTypeId: '10002', marker, summary: 'WP-048 · Suministro A-17',
  description: 'Fixture sintético.\nEntrega estimada.', dueDate: '2026-12-13',
};
const browseAllowed = { permissions: { BROWSE_PROJECTS: { havePermission: true } } };
const bootstrapAllowed = {
  permissions: Object.fromEntries(BOOTSTRAP_PERMISSIONS.map((permission) => [permission, { havePermission: true }])),
};

function workItem({ id = '10400', labels = [marker], jiraProjectId = projectId, updated = '2026-11-25T11:45:23.000-0300' } = {}) {
  return {
    id, key: `PED-${id}`, self: 'https://other.example/',
    fields: {
      project: { id: jiraProjectId }, issuetype: { id: fixture.issueTypeId }, summary: fixture.summary,
      status: { id: '10020', name: 'To Do', statusCategory: { key: 'new' } },
      assignee: { accountId: 'local-fixture-account', emailAddress: 'private@example.invalid' },
      duedate: fixture.dueDate, updated, labels,
      attachment: [{ filename: 'private-document.txt' }],
    },
  };
}

type MockResponse = Awaited<ReturnType<JiraRequest>>;

function jsonResponse(value: unknown, status = 200, retryAfter?: string): MockResponse {
  return { status, headers: { get: () => retryAfter ?? null }, json: async () => value };
}

function scriptedAdapter(steps: Array<MockResponse | ((options: Parameters<JiraRequest>[1]) => Promise<MockResponse>)>, budgetMs?: number) {
  const calls: Array<{ path: string; method: string; body?: string }> = [];
  const adapter = createJiraProjectAdapter(projectId, async (path, options) => {
    calls.push({ path: path.value, method: options.method, body: options.body });
    const step = steps[calls.length - 1];
    assert.ok(step, `Unexpected Jira request: ${path.value}`);
    return typeof step === 'function' ? step(options) : step;
  }, budgetMs);
  return { adapter, calls };
}

function failsWith(code: JiraBoundaryErrorCode) {
  return (error: unknown) => error instanceof JiraBoundaryError && error.code === code;
}

test('validates server session, project and canonical fixture label before any request', () => {
  assert.equal(marker, 'ctx-demo-v1-wp-048');
  assert.equal(fixtureMarker('WP-120', 2), 'ctx-demo-v2-wp-120');
  assert.throws(() => fixtureMarker('WP-121'), failsWith('VALIDATION_ERROR'));
  assert.throws(() => fixtureMarker('WP-048', 0), failsWith('VALIDATION_ERROR'));
  assert.throws(() => createForgeJiraProjectAdapter({}), failsWith('AUTH_REQUIRED'));
  assert.throws(() => createForgeJiraProjectAdapter({ accountId: 'a', installContext: 'i' }), failsWith('FORBIDDEN'));
  assert.throws(() => createJiraProjectAdapter('x other', async () => jsonResponse({})), failsWith('VALIDATION_ERROR'));
});

test('verifies current project via Jira and reports missing Browse Projects before reading data', async () => {
  const allowed = scriptedAdapter([jsonResponse(browseAllowed), jsonResponse({ id: projectId, key: 'PED', name: 'Patagonia' })]);
  assert.deepEqual(await allowed.adapter.getProject(), { id: projectId, key: 'PED', name: 'Patagonia' });
  const permissions = new URL(allowed.calls[0]?.path ?? '', 'https://jira.example');
  assert.equal(permissions.pathname, '/rest/api/3/mypermissions');
  assert.equal(permissions.searchParams.get('projectId'), projectId);
  assert.equal(permissions.searchParams.get('permissions'), 'BROWSE_PROJECTS');
  assert.equal(allowed.calls[1]?.path, `/rest/api/3/project/${projectId}`);

  const denied = scriptedAdapter([jsonResponse({ permissions: { BROWSE_PROJECTS: { havePermission: false } } })]);
  await assert.rejects(denied.adapter.searchWorkItems(), failsWith('FORBIDDEN'));
  assert.equal(denied.calls.length, 1);
});

test('paginates enhanced JQL using a deterministic project selector and normalizes repeated source rows', async () => {
  const r = scriptedAdapter([
    jsonResponse(browseAllowed),
    jsonResponse({ isLast: false, nextPageToken: 'opaque-page', issues: [workItem(), workItem({ updated: '2026-11-25T15:30:00.000+0000' })] }),
    jsonResponse({ isLast: true, issues: [workItem({ id: '10401' })] }),
  ]);
  const first = await r.adapter.searchWorkItems({ marker, pageSize: 10 });
  assert.deepEqual(first, { nextPageToken: 'opaque-page', items: [{
    id: '10400', key: 'PED-10400', projectId, issueTypeId: '10002', summary: fixture.summary,
    status: { id: '10020', name: 'To Do', categoryKey: 'new' }, assigneeAccountId: 'local-fixture-account',
    dueDate: fixture.dueDate, updatedAt: '2026-11-25T15:30:00.000Z', labels: [marker],
  }] });
  assert.ok(first.nextPageToken);
  const second = await r.adapter.searchWorkItems({ marker, nextPageToken: first.nextPageToken, pageSize: 10 });
  assert.equal(second.nextPageToken, null);
  assert.equal(second.items[0]?.id, '10401');

  const request = JSON.parse(r.calls[1]?.body ?? '{}');
  assert.equal(r.calls[1]?.path, '/rest/api/3/search/jql');
  assert.equal(r.calls[1]?.method, 'POST');
  assert.equal(request.jql, `project = ${projectId} AND labels = "${marker}" ORDER BY id ASC`);
  assert.equal(request.nextPageToken, undefined);
  assert.equal(JSON.parse(r.calls[2]?.body ?? '{}').nextPageToken, 'opaque-page');
  assert.equal(request.fields.includes('description'), false);
});

test('distinguishes a foreign project, incorrect fixture label and 429 without leaking source data', async () => {
  const foreign = scriptedAdapter([jsonResponse(browseAllowed), jsonResponse(workItem({ jiraProjectId: '99999' }))]);
  await assert.rejects(foreign.adapter.getWorkItem('10400'), failsWith('FORBIDDEN'));

  const multiple = scriptedAdapter([jsonResponse(browseAllowed), jsonResponse({ isLast: true, issues: [
    workItem({ labels: [marker, fixtureMarker('WP-049')] }),
  ] })]);
  await assert.rejects(multiple.adapter.searchWorkItems({ marker }), failsWith('CONFLICT'));

  const throttled = scriptedAdapter([jsonResponse(browseAllowed), jsonResponse({ privateBody: 'never returned' }, 429, '8')]);
  await assert.rejects(throttled.adapter.searchWorkItems(), (error: unknown) => {
    assert.ok(error instanceof JiraBoundaryError);
    assert.equal(error.code, 'RATE_LIMITED');
    assert.equal(error.retryAfterSeconds, 8);
    assert.doesNotMatch(JSON.stringify(error), /privateBody/);
    return true;
  });
  assert.equal(throttled.calls.length, 2);
});

test('discovers one non-subtask Task or Tarea and its create-screen fields across offset pages', async () => {
  const field = (key: string, required = false) => ({ fieldId: key, required, operations: ['set'], hasDefaultValue: false });
  for (const taskName of ['Task', 'Tarea']) {
    const r = scriptedAdapter([
      jsonResponse(browseAllowed),
      jsonResponse({ startAt: 0, total: 2, issueTypes: [{ id: '10003', name: taskName, subtask: true }] }),
      jsonResponse({ startAt: 1, total: 2, issueTypes: [{ id: fixture.issueTypeId, name: taskName, subtask: false }] }),
      jsonResponse({ startAt: 0, total: 4, fields: [field('summary', true), field('description'), field('labels'), field('duedate', true)] }),
    ]);
    assert.deepEqual(await r.adapter.getTaskCreateMetadata(), { issueTypeId: '10002', supportsDueDate: true, requiresDueDate: true });
    assert.match(r.calls[2]?.path ?? '', /\/issuetypes\?startAt=1&maxResults=50$/);
    assert.match(r.calls[3]?.path ?? '', /\/issuetypes\/10002\?/);
  }

  const ambiguous = scriptedAdapter([
    jsonResponse(browseAllowed),
    jsonResponse({ startAt: 0, total: 2, issueTypes: [
      { id: '10002', name: 'Task', subtask: false },
      { id: '10003', name: 'Tarea', subtask: false },
    ] }),
  ]);
  await assert.rejects(ambiguous.adapter.getTaskCreateMetadata(), failsWith('CONFLICT'));
  assert.equal(ambiguous.calls.length, 2);

  const invalid = scriptedAdapter([
    jsonResponse(browseAllowed),
    jsonResponse({ startAt: 0, total: 1, issueTypes: [{ id: fixture.issueTypeId, name: 'Task', subtask: false }] }),
    jsonResponse({ startAt: 0, total: 4, fields: [field('summary', true), field('description'), field('labels'), field('customfield_10000', true)] }),
  ]);
  await assert.rejects(invalid.adapter.getTaskCreateMetadata(), failsWith('CONFLICT'));
});

test('builds exactly one project-scoped ADF create request after verifying all bootstrap permissions', async () => {
  const r = scriptedAdapter([jsonResponse(bootstrapAllowed), jsonResponse({ id: '10400', key: 'PED-10400', self: 'https://private.invalid' }, 201)]);
  assert.deepEqual(await r.adapter.createFixtureTask(fixture), { id: '10400', key: 'PED-10400' });
  assert.deepEqual(r.calls.map(({ method }) => method), ['GET', 'POST']);
  assert.equal(new URL(r.calls[0]?.path ?? '', 'https://jira.example').searchParams.get('permissions'), BOOTSTRAP_PERMISSIONS.join(','));
  assert.equal(r.calls[1]?.path, '/rest/api/3/issue');
  assert.deepEqual(JSON.parse(r.calls[1]?.body ?? '{}'), { fields: {
    project: { id: projectId }, issuetype: { id: fixture.issueTypeId }, summary: fixture.summary,
    description: { type: 'doc', version: 1, content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Fixture sintético.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Entrega estimada.' }] },
    ] }, labels: [marker], duedate: fixture.dueDate,
  } });

  const denied = scriptedAdapter([jsonResponse({ permissions: {
    ...bootstrapAllowed.permissions, ADMINISTER_PROJECTS: { havePermission: false },
  } })]);
  await assert.rejects(denied.adapter.createFixtureTask(fixture), failsWith('FORBIDDEN'));
  assert.equal(denied.calls.length, 1);
});

test('leaves uncertain creation fenced on timeout, upstream exception, 5xx or malformed 201', async () => {
  for (const response of [
    jsonResponse({}, 500),
    jsonResponse({ id: '10400' }, 201),
    async () => { throw new Error('private lost response details'); },
  ]) {
    const r = scriptedAdapter([jsonResponse(bootstrapAllowed), response]);
    await assert.rejects(r.adapter.createFixtureTask(fixture), failsWith('RECONCILIATION_REQUIRED'));
    assert.equal(r.calls.length, 2);
  }

  const stalled = scriptedAdapter([jsonResponse(bootstrapAllowed), async () => new Promise(() => {})], 150);
  await assert.rejects(stalled.adapter.createFixtureTask(fixture), failsWith('RECONCILIATION_REQUIRED'));
  assert.equal(stalled.calls.length, 2);

  const rejected = scriptedAdapter([jsonResponse(bootstrapAllowed), jsonResponse({}, 400)]);
  await assert.rejects(rejected.adapter.createFixtureTask(fixture), failsWith('VALIDATION_ERROR'));
  assert.equal(rejected.calls.length, 2);
});

test('preserves the Forge consent error from Jira read and create requests', async () => {
  const consent = new NeedsAuthenticationError('Authentication Required', 'fixture-consent-service');
  const needsConsent = async () => { throw consent; };
  const read = scriptedAdapter([jsonResponse(browseAllowed), needsConsent]);
  await assert.rejects(read.adapter.getProject(), (error: unknown) => error === consent);

  const create = scriptedAdapter([jsonResponse(bootstrapAllowed), needsConsent]);
  await assert.rejects(create.adapter.createFixtureTask(fixture), (error: unknown) => error === consent);
  assert.deepEqual(create.calls.map(({ method }) => method), ['GET', 'POST']);
});

test('reconciliation survives page boundaries, confirms with a current issue read and never performs a create', async () => {
  const sameIssue = workItem();
  const r = scriptedAdapter([
    jsonResponse(browseAllowed),
    jsonResponse({ isLast: false, nextPageToken: 'cursor-a', issues: [sameIssue] }),
    jsonResponse({ isLast: true, issues: [sameIssue] }),
    jsonResponse(sameIssue),
  ]);
  const first = await reconcileFixtureTask(r.adapter, marker);
  assert.equal(first.status, 'PENDING');
  if (first.status === 'PENDING') {
    assert.deepEqual(await reconcileFixtureTask(r.adapter, marker, first.state), { status: 'FOUND', issue: { id: '10400', key: 'PED-10400' } });
  }
  assert.match(r.calls.at(-1)?.path ?? '', /\/rest\/api\/3\/issue\/10400\?/);
  assert.equal(r.calls.some((call) => call.method === 'POST' && call.path === '/rest/api/3/issue'), false);
});

test('reconciliation leaves zero visibility pending for the coordinator and reports conflicting markers', async () => {
  const empty = scriptedAdapter([jsonResponse(browseAllowed), jsonResponse({ isLast: true, issues: [] })]);
  assert.deepEqual(await reconcileFixtureTask(empty.adapter, marker), { status: 'NOT_VISIBLE' });
  assert.equal(empty.calls.length, 2);

  const duplicate = scriptedAdapter([jsonResponse(browseAllowed), jsonResponse({ isLast: true, issues: [workItem(), workItem({ id: '10401' })] })]);
  assert.deepEqual(await reconcileFixtureTask(duplicate.adapter, marker), { status: 'CONFLICT' });

  const stale = scriptedAdapter([jsonResponse(browseAllowed), jsonResponse({ isLast: true, issues: [workItem()] }), jsonResponse(workItem({ labels: [] }))]);
  assert.deepEqual(await reconcileFixtureTask(stale.adapter, marker), { status: 'CONFLICT' });
  await assert.rejects(reconcileFixtureTask(stale.adapter, marker, {
    projectId: '99999', marker, nextPageToken: 'opaque', candidate: null, usedPageTokens: [],
  }), failsWith('VALIDATION_ERROR'));
  assert.equal(stale.calls.length, 3);
});
