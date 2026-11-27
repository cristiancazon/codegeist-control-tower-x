import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JiraBoundaryError, type JiraWorkItem } from '../data/jira';
import type { ProjectRole } from '../data/sql/projects';
import { createOperationsResolvers } from './resolvers';
import { operationsJiraSource } from './scope';

const context = { accountId: 'account-demo', installContext: 'site', extension: { project: { id: '10202' } } };
const item: JiraWorkItem = {
  id: '20000', key: 'PED-1', projectId: '10202', issueTypeId: '10001', summary: 'Trabajo de prueba',
  status: { id: '1', name: 'Por hacer', categoryKey: 'new' }, assigneeAccountId: null, dueDate: null,
  updatedAt: '2026-11-24T03:00:00.000Z', labels: [],
};

function harness(overrides: Partial<Parameters<typeof createOperationsResolvers>[0]> = {}) {
  const calls: string[] = [];
  const logs: object[] = [];
  let roles: readonly ProjectRole[] = ['VIEWER'];
  const resolver = createOperationsResolvers({
    createJira: (received) => {
      assert.equal(received, context);
      calls.push('context');
      return {
        projectId: '10202',
        assertBrowsePermission: async () => { calls.push('browse'); },
        searchWorkItems: async () => {
          calls.push('jira');
          return { items: [item], nextPageToken: null };
        },
      };
    },
    getAccess: async (project, actor) => {
      assert.equal(project, '10202');
      assert.equal(actor, context.accountId);
      calls.push('roles');
      return roles.length ? { projectId: 'verified-project', roles } : undefined;
    },
    readProject: async (project, jiraId) => {
      assert.equal(project, 'verified-project');
      assert.equal(jiraId, '10202');
      calls.push('project');
      return { name: 'Proyecto de prueba', key: 'PED', snapshot: null };
    },
    list: async (_section, scope) => {
      calls.push('list');
      return { total: scope.jiraIssues.size, columns: [], rows: [], sources: [operationsJiraSource(scope)] };
    },
    detail: async (_section, scope, code) => {
      calls.push('detail');
      return { code, title: 'Detalle', fields: [], links: [], sources: [operationsJiraSource(scope)] };
    },
    log: (entry) => logs.push(entry),
    ...overrides,
  });
  return { resolver, calls, logs, setRoles: (next: readonly ProjectRole[]) => { roles = next; } };
}

test('rejects client project and role selectors and invalid dates before authorization', async () => {
  const { resolver, calls } = harness();
  for (const payload of [
    { section: 'work', projectId: '10203' },
    { section: 'hse', roles: ['HSE_READER'] },
    { section: 'logistics', from: '2026-12-01', to: '2026-11-24' },
    { section: 'work', page: -1 },
    { section: 'work', from: '2026-02-31' },
  ]) {
    const result = await resolver.list({ context, payload });
    assert.ok(!result.ok && result.error.code === 'INVALID_FILTER');
  }
  assert.deepEqual(calls, []);
});

test('VIEWER must have HSE_READER and a revoked role loses access on the next detail request', async () => {
  const { resolver, calls, logs, setRoles } = harness();
  const request = { context, payload: { section: 'hse', code: 'HSE-01' } };
  const denied = await resolver.detail(request);
  assert.ok(!denied.ok && denied.error.code === 'FORBIDDEN');
  assert.deepEqual(calls, ['context', 'browse', 'roles']);
  setRoles(['VIEWER', 'HSE_READER']);
  assert.equal((await resolver.detail(request)).ok, true);
  setRoles([]);
  assert.deepEqual((await resolver.detail(request)).ok, false);
  assert.doesNotMatch(JSON.stringify(logs), /account-demo|HSE-01|verified-project|Trabajo de prueba/);
});

test('a disconnected Jira source is distinct from an authorized empty list', async () => {
  const unavailable = harness({
    createJira: () => ({
      projectId: '10202', assertBrowsePermission: async () => {},
      searchWorkItems: async () => { throw new JiraBoundaryError('RATE_LIMITED', 'Límite de Jira'); },
    }),
  });
  const request = { context, payload: { section: 'work', page: 2 } };
  const result = await unavailable.resolver.list(request);
  assert.ok(result.ok);
  assert.equal(result.data.page, 2);
  assert.equal(result.data.total, 0);
  assert.equal(result.data.sources[0]?.state, 'UNAVAILABLE');
  const ready = await harness().resolver.list(request);
  assert.ok(ready.ok);
  assert.equal(ready.data.sources[0]?.state, 'READY');
});

test('a Jira permission denial is handled before any project or operations data is fetched', async () => {
  const { resolver, calls } = harness({
    createJira: () => ({
      projectId: '10202',
      assertBrowsePermission: async () => { throw new JiraBoundaryError('FORBIDDEN', 'Dato remoto privado'); },
      searchWorkItems: async () => { throw new Error('No se debe consultar Jira'); },
    }),
  });
  const result = await resolver.list({ context, payload: { section: 'assets' } });
  assert.ok(!result.ok && result.error.code === 'FORBIDDEN');
  assert.doesNotMatch(result.error.message, /Dato remoto privado/);
  assert.deepEqual(calls, []);
});
