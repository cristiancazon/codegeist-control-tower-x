import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Overview } from '../../shared/overview';
import { JiraBoundaryError, type JiraWorkItem } from '../data/jira';
import { createOverviewResolvers, readVisibleJiraIssues } from './resolvers';

const context = { accountId: 'actor-viewer', installContext: 'site-from-forge', extension: { project: { id: '10202' } } };
const empty: Overview = {
  project: { name: 'Proyecto de prueba', key: 'PED', currency: 'USD' },
  asOf: null, snapshot: null, phases: [], sources: [{ source: 'JIRA', state: 'READY', observedAt: null, detail: '' }],
  metrics: [], alerts: [], map: [],
};

function work(id: string, updatedAt = '2026-11-24T23:00:00.000Z'): JiraWorkItem {
  return {
    id, key: 'PED-1', projectId: '10202', issueTypeId: '10001', summary: 'Título privado',
    status: { id: '10001', name: 'Por hacer', categoryKey: 'new' },
    updatedAt, dueDate: null, labels: [], assigneeAccountId: null,
  };
}

function harness(overrides: Partial<Parameters<typeof createOverviewResolvers>[0]> = {}) {
  const calls: string[] = [];
  const entries: object[] = [];
  const resolvers = createOverviewResolvers({
    createJira: (received) => {
      assert.equal(received, context);
      calls.push('context');
      return {
        projectId: context.extension.project.id,
        assertBrowsePermission: async () => { calls.push('jira-permission'); },
        searchWorkItems: async () => {
          calls.push('jira-page');
          return { items: [work('10010')], nextPageToken: null };
        },
      };
    },
    getAccess: async (project, actor) => {
      calls.push('app-role');
      assert.equal(project, '10202');
      assert.equal(actor, 'actor-viewer');
      return { projectId: 'project-on-server', roles: ['VIEWER'] };
    },
    readOverview: async (input) => {
      calls.push('overview-data');
      assert.equal(input.projectId, 'project-on-server');
      assert.deepEqual(input.jiraIssues, [work('10010')]);
      return empty;
    },
    readAlert: async () => {
      calls.push('alert-data');
      return undefined;
    },
    now: () => new Date('2026-11-25T12:00:00.000Z'),
    log: (entry) => entries.push(entry),
    ...overrides,
  });
  return { calls, entries, resolvers };
}

test('reads current Jira scope with a single verified app Viewer role', async () => {
  const { calls, entries, resolvers } = harness();
  const result = await resolvers.get({ context, payload: { asOf: '2026-11-24', phaseCode: 'PH-01' } });
  assert.ok(result.ok);
  assert.equal(result.data.project.jiraProjectId, '10202');
  assert.deepEqual(calls, ['context', 'jira-permission', 'app-role', 'jira-page', 'overview-data']);
  assert.match(JSON.stringify(entries), new RegExp(result.requestId));
  assert.doesNotMatch(JSON.stringify(entries), /actor-viewer|10202|Título privado|project-on-server/);
});

test('rejects spoofed selectors, an invalid alert and impossible dates before any data access', async () => {
  const { calls, resolvers } = harness();
  for (const result of [
    await resolvers.get({ context, payload: { projectId: '10203' } }),
    await resolvers.get({ context, payload: { jiraProjectId: '10203' } }),
    await resolvers.get({ context, payload: { actorAccountId: 'another-actor' } }),
    await resolvers.get({ context, payload: { asOf: '2026-02-31' } }),
    await resolvers.alert({ context, payload: { code: 'A-18' } }),
  ]) {
    assert.ok(!result.ok && result.error.code === 'INVALID_FILTER');
  }
  assert.deepEqual(calls, []);
});

test('denies an absent role before reading Jira items and denies an unavailable alert generically', async () => {
  const { resolvers, calls } = harness({ getAccess: async () => undefined });
  const denied = await resolvers.get({ context });
  assert.ok(!denied.ok && denied.error.code === 'FORBIDDEN');
  assert.deepEqual(calls, ['context', 'jira-permission']);
  const alert = await harness().resolvers.alert({ context, payload: { code: 'A-17' } });
  assert.ok(!alert.ok && alert.error.code === 'FORBIDDEN');
});

test('a transient second-page failure returns partial data, while Jira denial propagates', async () => {
  const first = work('10010');
  async function load(code: 'SOURCE_UNAVAILABLE' | 'FORBIDDEN') {
    return readVisibleJiraIssues({
      projectId: '10202',
      assertBrowsePermission: async () => {},
      searchWorkItems: async ({ nextPageToken } = {}) => {
        if (nextPageToken === 'second') {
          throw new JiraBoundaryError(code, 'Upstream details');
        }
        return { items: [first], nextPageToken: 'second' };
      },
    });
  }
  assert.deepEqual(await load('SOURCE_UNAVAILABLE'), { issues: [first], state: 'PARTIAL' });
  await assert.rejects(load('FORBIDDEN'), (error: unknown) =>
    error instanceof JiraBoundaryError && error.code === 'FORBIDDEN');
});

test('deduplicates a Jira issue by newest version across visible pages and rejects foreign rows', async () => {
  const first = work('10010');
  const newer = work('10010', '2026-11-25T00:00:00.000Z');
  const result = await readVisibleJiraIssues({
    projectId: '10202',
    assertBrowsePermission: async () => {},
    searchWorkItems: async ({ nextPageToken } = {}) =>
      nextPageToken === 'second' ? { items: [newer], nextPageToken: null } : { items: [first], nextPageToken: 'second' },
  });
  assert.deepEqual(result, { issues: [newer], state: 'READY' });
  const foreign = await readVisibleJiraIssues({
    projectId: '10202',
    assertBrowsePermission: async () => {},
    searchWorkItems: async () => ({ items: [{ ...first, projectId: '10203' }], nextPageToken: null }),
  });
  assert.deepEqual(foreign, { issues: null, state: 'UNAVAILABLE' });
});
