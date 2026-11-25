import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Result } from '@forge/sql';
import { fixtureMarker, JiraBoundaryError, type JiraWorkItem, type JiraWorkItemPage } from '../jira/index.js';
import type { executeSql, SqlParameter } from '../sql/client.js';
import { advanceFixtureReconciliation } from './reconciliation.js';

const projectId = '6cc5ef56-59aa-50b8-b049-b8999f86eb1f';
const otherProjectId = 'e2c73946-067b-57b3-b3f5-0ed15916c7c9';
const jiraProjectId = '10001';
const actorAccountId = 'fixture-owner';
const marker = fixtureMarker('WP-048');

type ReconciliationInput = Parameters<typeof advanceFixtureReconciliation>[0];

type StoredRow = {
  state: string;
  source_schema_version: number;
  fence: string;
  cursor_value: string | null;
  is_fresh: number;
};

function fakeStore() {
  const projects = new Map([[projectId, jiraProjectId], [otherProjectId, '10002']]);
  const rows = new Map<string, StoredRow>();
  const idFor = (project: SqlParameter, source: SqlParameter, marker: SqlParameter) => [project, source, marker].join(':');
  const query: typeof executeSql = async <Row>(statement: string, parameters: readonly SqlParameter[]) => {
    if (statement.startsWith('SELECT')) {
      assert.match(statement, /INNER JOIN ctx_project p ON p.id = s.project_id/);
      const [project, source, marker, jira] = parameters;
      const row = rows.get(idFor(project ?? null, source ?? null, marker ?? null));
      return (project && projects.get(String(project)) === jira && row ? [{ ...row }] : []) as Result<Row>['rows'];
    }
    if (statement.startsWith('INSERT')) {
      assert.match(statement, /WHERE id = \? AND jira_project_id = \? AND data_mode = 'DEMO'/);
      const [source, marker, version, fence, project, jira] = parameters;
      const key = idFor(project ?? null, source ?? null, marker ?? null);
      if (project && projects.get(String(project)) === jira && !rows.has(key)) {
        rows.set(key, { state: 'IDLE', source_schema_version: Number(version), fence: String(fence), cursor_value: null, is_fresh: 0 });
      }
      return { affectedRows: 1 } as Result<Row>['rows'];
    }
    assert.match(statement, /AND source_schema_version = \? AND fence = \?/);
    const [cursor, state, project, source, marker, version, fence, local, jira] = parameters;
    const row = rows.get(idFor(project ?? null, source ?? null, marker ?? null));
    if (!row || local !== project || projects.get(String(project)) !== jira ||
        row.source_schema_version !== version || row.fence !== fence) {
      return { affectedRows: 0 } as Result<Row>['rows'];
    }
    row.cursor_value = typeof cursor === 'string' ? cursor : null;
    row.state = String(state);
    row.fence = String(BigInt(row.fence) + 1n);
    row.is_fresh = 1;
    return { affectedRows: 1 } as Result<Row>['rows'];
  };
  return {
    query,
    rows,
    getRow(project = projectId, forMarker = marker) {
      const row = rows.get(idFor(project, 'JIRA_RECONCILE', forMarker));
      assert.ok(row);
      return row;
    },
  };
}

function workItem(overrides: Partial<JiraWorkItem> = {}): JiraWorkItem {
  return {
    id: '12345',
    key: 'PED-1',
    projectId: jiraProjectId,
    issueTypeId: '10002',
    summary: 'Fixture A-17',
    status: { id: '1', name: 'To do', categoryKey: 'new' },
    assigneeAccountId: null,
    dueDate: null,
    updatedAt: '2026-11-25T00:00:00.000Z',
    labels: [marker],
    ...overrides,
  };
}

function makeInput(pages: JiraWorkItemPage[] = []): ReconciliationInput & { tokens: Array<string | undefined>; issueReads: string[] } {
  const tokens: Array<string | undefined> = [];
  const issueReads: string[] = [];
  return {
    projectId,
    actorAccountId,
    marker,
    tokens,
    issueReads,
    jira: {
      projectId: jiraProjectId,
      async searchWorkItems(options) {
        assert.equal(options?.marker, marker);
        tokens.push(options?.nextPageToken);
        const page = pages.shift();
        assert.ok(page, 'Unexpected Jira page request');
        return page;
      },
      async getWorkItem(id) {
        issueReads.push(id);
        return workItem();
      },
    },
  };
}

test('persists a page continuation and confirms one candidate after a fresh call', async () => {
  const store = fakeStore();
  const first = makeInput([{ items: [workItem()], nextPageToken: 'page-two' }]);
  assert.deepEqual(await advanceFixtureReconciliation(first, store.query), { status: 'PENDING' });
  assert.deepEqual(first.tokens, [undefined]);
  assert.deepEqual(first.issueReads, []);

  const row = store.getRow();
  assert.equal(row.state, 'PENDING');
  assert.match(row.cursor_value ?? '', /page-two/);
  assert.doesNotMatch(row.cursor_value ?? '', /fixture-owner|Fixture A-17/);

  const second = makeInput([{ items: [], nextPageToken: null }]);
  assert.deepEqual(await advanceFixtureReconciliation(second, store.query), {
    status: 'FOUND', issue: { id: '12345', key: 'PED-1' },
  });
  assert.deepEqual(second.tokens, ['page-two']);
  assert.deepEqual(second.issueReads, ['12345']);
  assert.equal(row.cursor_value, null);
  assert.equal(row.state, 'IDLE');
});

test('keeps markers and projects separate and refuses another actor or a corrupt active cursor', async () => {
  const store = fakeStore();
  const first = makeInput([{ items: [workItem()], nextPageToken: 'private-page-two' }]);
  assert.deepEqual(await advanceFixtureReconciliation(first, store.query), { status: 'PENDING' });

  const next = makeInput();
  assert.deepEqual(await advanceFixtureReconciliation({ ...next, actorAccountId: 'another-owner' }, store.query), { status: 'CONFLICT' });
  await assert.rejects(advanceFixtureReconciliation({ ...next, projectId: otherProjectId }, store.query),
    (error: unknown) => error instanceof JiraBoundaryError && error.code === 'FORBIDDEN');
  assert.deepEqual(next.tokens, []);

  const separateMarker = fixtureMarker('WP-049');
  const separateInput = {
    ...next,
    marker: separateMarker,
    jira: {
      ...next.jira,
      async searchWorkItems(options: Parameters<typeof next.jira.searchWorkItems>[0]) {
        assert.equal(options?.marker, separateMarker);
        assert.equal(options?.nextPageToken, undefined);
        return { items: [], nextPageToken: null };
      },
    },
  };
  assert.deepEqual(await advanceFixtureReconciliation(separateInput, store.query), { status: 'NOT_VISIBLE' });

  const row = store.getRow();
  assert.equal(row.state, 'PENDING');
  row.cursor_value = '{"checkpoint":';
  assert.deepEqual(await advanceFixtureReconciliation(next, store.query), { status: 'CONFLICT' });
  assert.deepEqual(next.tokens, []);
});

test('restarts expired cursors, reports visibility only, and keeps denied checkpoints intact', async () => {
  const store = fakeStore();
  const first = makeInput([{ items: [workItem()], nextPageToken: 'page-two' }]);
  await advanceFixtureReconciliation(first, store.query);

  const row = store.getRow();
  const saved = { ...row };
  const deny = new JiraBoundaryError('FORBIDDEN', 'Fixture permission revoked');
  const denied = makeInput();
  denied.jira.searchWorkItems = async () => { throw deny; };
  await assert.rejects(advanceFixtureReconciliation(denied, store.query), (error: unknown) => error === deny);
  assert.deepEqual(row, saved);

  row.is_fresh = 0;
  const expired = makeInput([{ items: [], nextPageToken: null }]);
  assert.deepEqual(await advanceFixtureReconciliation(expired, store.query), { status: 'NOT_VISIBLE' });
  assert.deepEqual(expired.tokens, [undefined]);
  assert.deepEqual(expired.issueReads, []);
});

test('only a CAS winner returns a terminal result for concurrent reconciliations', async () => {
  const store = fakeStore();
  const first = makeInput([{ items: [workItem()], nextPageToken: 'page-two' }]);
  await advanceFixtureReconciliation(first, store.query);

  let release: () => void = () => {};
  const bothEnter = new Promise<void>((resolve) => { release = resolve; });
  let arrived = 0;
  const attempt = makeInput();
  attempt.jira.searchWorkItems = async (options) => {
    assert.equal(options?.nextPageToken, 'page-two');
    arrived += 1;
    if (arrived === 2) {
      release();
    }
    await bothEnter;
    return { items: [], nextPageToken: null };
  };

  const results = await Promise.all([
    advanceFixtureReconciliation(attempt, store.query),
    advanceFixtureReconciliation(attempt, store.query),
  ]);
  assert.deepEqual(results.map(({ status }) => status).sort(), ['FOUND', 'PENDING']);
  assert.equal(store.getRow().cursor_value, null);
});

test('bounds checkpoint bytes before persisting opaque Jira page tokens', async () => {
  const store = fakeStore();
  // JSON escaping grows control characters even when Jira tokens meet the character limit.
  const first = makeInput([{ items: [], nextPageToken: '\u0001'.repeat(4095) + '1' }]);
  const second = makeInput([{ items: [], nextPageToken: '\u0001'.repeat(4095) + '2' }]);
  assert.deepEqual(await advanceFixtureReconciliation(first, store.query), { status: 'PENDING' });
  const checkpoint = { ...store.getRow() };
  assert.deepEqual(await advanceFixtureReconciliation(second, store.query), { status: 'CONFLICT' });
  assert.deepEqual(store.getRow(), checkpoint);
});
