import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  DECISIONS_APPROVE, DECISIONS_EXECUTE, DECISIONS_GET, DECISIONS_LIST, DECISIONS_PREPARE,
  DECISIONS_PROPOSE, DECISIONS_RECONCILE, DECISIONS_REJECT,
  type Decision, type DecisionsResult,
} from '../../shared/decisions';
import { JiraBoundaryError } from '../data/jira';
import type { SqlParameter, executeSql } from '../data/sql/client';
import { decisionMigrations } from '../data/sql/migrations';
import type { ProjectRole } from '../data/sql/projects';
import { modelMigrations } from '../data/sql/schema';
import { createDecisionResolvers, DecisionFailure } from './resolvers';
import { createDecisionStore } from './store';

const projectId = '84000000-0000-4000-8000-000000000009';
const runId = '84000000-0000-4000-8000-000000000018';
const snapshotId = '84000000-0000-4000-8000-000000000019';
const idempotencyKey = '84000000-0000-4000-8000-000000000029';
const target = { projectKey: 'PED', issueTypeId: '10207' };
const expiresAt = '2026-12-01T00:00:00.000Z';
const issue = { id: '88000', key: 'PED-121' };

function harness(post: 'ok' | 'lost' = 'ok') {
  const db = new DatabaseSync(':memory:');
  let now = Date.parse('2026-11-27T00:00:00.000Z');
  const sqlTime = (time: number) => new Date(time).toISOString().replace('T', ' ').slice(0, -1);
  db.function('db_now', () => sqlTime(now));
  db.function('shift_seconds', (seconds) => sqlTime(now + Number(seconds) * 1_000));
  for (const [name, statement] of modelMigrations) {
    if (!/^v001_(01|02|26|27|28)_/.test(name)) continue;
    db.exec(statement.replace(/DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin/g, '')
      .replace(/^\s*KEY \w+ \([^\n]*\),?\r?\n/gm, '')
      .replace(/UNIQUE KEY \w+/g, 'UNIQUE').replace(/,\s*\)\s*$/g, ')'));
  }
  for (const [, statement] of decisionMigrations) db.exec(statement.replace('IF NOT EXISTS ', ''));
  db.prepare(`INSERT INTO ctx_project (id, code, name, jira_project_id, jira_project_key, time_zone, currency, data_mode, status, version, updated_at)
    VALUES (?, 'PED', 'Patagonia', '10202', 'PED', 'UTC', 'USD', 'DEMO', 'ACTIVE', 1, db_now())`).run(projectId);
  const grant = db.prepare(`INSERT INTO ctx_project_role (project_id, account_id, role_code, granted_by, granted_at)
    VALUES (?, ?, ?, 'operator', db_now())`);
  grant.run(projectId, 'planner', 'PLANNER');
  grant.run(projectId, 'planner', 'APPROVER');
  grant.run(projectId, 'reviewer', 'APPROVER');
  grant.run(projectId, 'viewer', 'VIEWER');
  const query = (async (statement: string, params: readonly SqlParameter[]) => {
    const prepared = db.prepare(statement.replaceAll('UTC_TIMESTAMP(3)', 'db_now()')
      .replace(/TIMESTAMPADD\(SECOND, (-?\d+), db_now\(\)\)/g, 'shift_seconds($1)')
      .replaceAll('LEAST(', 'MIN(').replace(/ON DUPLICATE KEY UPDATE id = ctx_\w+\.id/g, 'ON CONFLICT DO NOTHING'));
    const values = params.map((value) => typeof value === 'boolean' ? Number(value) : value);
    if (statement.trimStart().startsWith('SELECT')) return prepared.all(...values);
    return { affectedRows: Number(prepared.run(...values).changes) };
  }) as typeof executeSql;
  const store = createDecisionStore(query);
  let posts = 0;
  let reconciliationVisible = false;
  const resolvers = createDecisionResolvers({ store, now: () => now,
    async authorize(context) {
      if (typeof context !== 'string') throw new DecisionFailure('FORBIDDEN');
      const roles = db.prepare('SELECT role_code FROM ctx_project_role WHERE project_id = ? AND account_id = ? AND revoked_at IS NULL')
        .all(projectId, context).map((row) => row.role_code as ProjectRole);
      if (!roles.length) throw new DecisionFailure('FORBIDDEN');
      return { actor: context, projectId, jiraProjectId: '10202', roles, target, jira: {
        assertCorrectiveCreateTarget: async () => ({ id: '10202', key: 'PED', name: 'Patagonia' }),
        createCorrectiveIssue: async (input) => {
          assert.match(input.marker, /^ctx-decision-[0-9a-f-]+$/);
          assert.equal(input.projectKey, 'PED');
          assert.match(input.description, /Hash de resultado:/);
          posts++;
          if (post === 'lost') throw new JiraBoundaryError('RECONCILIATION_REQUIRED', 'Respuesta perdida');
          return issue;
        },
        findCorrectiveByMarker: async () => reconciliationVisible ? issue : undefined,
        getWorkItem: async () => ({ ...issue, projectId: '10202', issueTypeId: '10207', summary: 'Mitigar A-17',
          status: { id: '1', name: 'To do', categoryKey: 'new' }, assigneeAccountId: null, dueDate: null,
          updatedAt: new Date(now).toISOString(), labels: [] }),
      } };
    },
    async evidence(_scope, id) {
      if (id !== runId) throw new DecisionFailure('STALE_INPUT');
      return { expiresAt, data: { runId, snapshotId, scenario: 'S2', resultHash: 'a'.repeat(64), modelVersion: 'cpm-pert-v1',
        asOf: '2026-11-24', sourceIssueKey: 'PED-48', durationP80Days: 37, costP80Cents: '4521000000' } };
    },
  });
  const revokeReview = () => db.prepare("UPDATE ctx_project_role SET revoked_at = db_now() WHERE account_id = 'reviewer'").run();
  return { resolvers, posts: () => posts, revokeReview, showIssue: () => { reconciliationVisible = true; },
    advance: (ms: number) => { now += ms; }, close: () => db.close() };
}

function data<T>(result: DecisionsResult<T>): T {
  if (!result.ok) assert.fail(`${result.error.code}: ${result.error.message}`);
  return result.data;
}

function errorCode(result: DecisionsResult<unknown>) {
  assert.equal(result.ok, false);
  return !result.ok ? result.error.code : undefined;
}

const proposal = { runId, summary: 'Mitigar A-17', description: 'Confirmar el suministro alternativo.', idempotencyKey,
  expectedResultHash: 'a'.repeat(64), expectedIssueTypeId: '10207', expectedProjectKey: 'PED' };

const ref = ({ id, revision, hash }: Decision) => ({ decisionId: id, expectedRevision: revision, expectedHash: hash, confirmed: true });

test('CT009-01/02 guards preview revisions, idempotency and approval by a distinct account', async (t) => {
  const { resolvers: r, posts, close } = harness();
  t.after(close);
  assert.equal(data(await r[DECISIONS_PREPARE]({ context: 'planner', payload: { runId } })).target.issueTypeId, '10207');
  assert.equal(errorCode(await r[DECISIONS_PROPOSE]({ context: 'planner', payload: { ...proposal, expectedProjectKey: 'OTHER' } })), 'STALE_INPUT');
  assert.equal(errorCode(await r[DECISIONS_PROPOSE]({ context: 'planner', payload: { ...proposal, runId: snapshotId } })), 'STALE_INPUT');
  const proposed = data(await r[DECISIONS_PROPOSE]({ context: 'planner', payload: proposal }));
  assert.equal(data(await r[DECISIONS_PROPOSE]({ context: 'planner', payload: proposal })).id, proposed.id);
  assert.equal(errorCode(await r[DECISIONS_PROPOSE]({ context: 'planner', payload: { ...proposal, summary: 'Distinto' } })), 'CONFLICT');
  const review = { ...ref(proposed), reason: 'Coincide con la evidencia de S2.' };
  assert.equal(errorCode(await r[DECISIONS_APPROVE]({ context: 'planner', payload: review })), 'FORBIDDEN');
  assert.equal(errorCode(await r[DECISIONS_APPROVE]({ context: 'reviewer', payload: { ...review, expectedRevision: 2 } })), 'CONFLICT');
  const results = await Promise.all([r[DECISIONS_APPROVE]({ context: 'reviewer', payload: review }),
    r[DECISIONS_APPROVE]({ context: 'reviewer', payload: review })]);
  assert.equal(results.filter(({ ok }) => ok).length, 1);
  assert.equal(posts(), 0);
  assert.equal(data(await r[DECISIONS_LIST]({ context: 'viewer' })).length, 1);
  const persisted = data(await r[DECISIONS_GET]({ context: 'planner', payload: { decisionId: proposed.id } }));
  assert.equal(persisted.reviewReason, review.reason);
  assert.deepEqual(new Set(persisted.activity.map(({ event }) => event)), new Set(['proposed', 'approved']));
});

test('CT009-03 rechecks approval role and creates exactly once under concurrent execution', async (t) => {
  const active = harness();
  const revoked = harness();
  t.after(() => { active.close(); revoked.close(); });
  for (const setup of [active, revoked]) {
    const r = setup.resolvers;
    const submitted = data(await r[DECISIONS_PROPOSE]({ context: 'planner', payload: proposal }));
    const pinned = ref(submitted);
    data(await r[DECISIONS_APPROVE]({ context: 'reviewer', payload: { ...pinned, reason: 'Aprobado para la demo.' } }));
    assert.equal(errorCode(await r[DECISIONS_EXECUTE]({ context: 'reviewer', payload: pinned })), 'FORBIDDEN');
    if (setup === revoked) setup.revokeReview();
    const results = await Promise.all([r[DECISIONS_EXECUTE]({ context: 'planner', payload: pinned }),
      r[DECISIONS_EXECUTE]({ context: 'planner', payload: pinned })]);
    assert.equal(setup.posts(), setup === active ? 1 : 0);
    assert.equal(results.filter((result) => result.ok && result.data.issueKey === 'PED-121').length, setup === active ? 1 : 0);
  }
});

test('CT009-04 never repeats a POST when the response is lost and resolves through a visible matching issue', async (t) => {
  const { resolvers: r, posts, showIssue, advance, close } = harness('lost');
  t.after(close);
  const proposed = data(await r[DECISIONS_PROPOSE]({ context: 'planner', payload: proposal }));
  const pinned = ref(proposed);
  data(await r[DECISIONS_APPROVE]({ context: 'reviewer', payload: { ...pinned, reason: 'Aprobado para la demo.' } }));
  const uncertain = data(await r[DECISIONS_EXECUTE]({ context: 'planner', payload: pinned }));
  assert.equal(uncertain.status, 'RECONCILIATION_REQUIRED');
  assert.equal(uncertain.canExecute, false);
  assert.equal(errorCode(await r[DECISIONS_EXECUTE]({ context: 'planner', payload: pinned })), 'CONFLICT');
  assert.equal(data(await r[DECISIONS_RECONCILE]({ context: 'planner', payload: pinned })).status, 'RECONCILIATION_REQUIRED');
  advance(36 * 60 * 60 * 1_000);
  showIssue();
  const applied = data(await r[DECISIONS_RECONCILE]({ context: 'planner', payload: pinned }));
  assert.equal(posts(), 1);
  assert.equal(applied.issueKey, issue.key);
  assert.ok(applied.activity.some(({ event }) => event === 'reconciled'));
});

test('CT009-02 rejection and elapsed approval are terminal for execution', async (t) => {
  const { resolvers: r, posts, advance, close } = harness();
  t.after(close);
  const first = data(await r[DECISIONS_PROPOSE]({ context: 'planner', payload: proposal }));
  const rejected = data(await r[DECISIONS_REJECT]({ context: 'reviewer', payload: { ...ref(first), reason: 'Revisar el plan.' } }));
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(errorCode(await r[DECISIONS_EXECUTE]({ context: 'planner', payload: ref(first) })), 'CONFLICT');
  const next = data(await r[DECISIONS_PROPOSE]({ context: 'planner', payload: { ...proposal, idempotencyKey: runId } }));
  data(await r[DECISIONS_APPROVE]({ context: 'reviewer', payload: { ...ref(next), reason: 'Revisado.' } }));
  advance(24 * 60 * 60 * 1_000 + 1);
  const expired = data(await r[DECISIONS_GET]({ context: 'planner', payload: { decisionId: next.id } }));
  assert.equal(expired.status, 'EXPIRED');
  assert.equal(errorCode(await r[DECISIONS_EXECUTE]({ context: 'planner', payload: ref(next) })), 'CONFLICT');
  assert.equal(posts(), 0);
});
