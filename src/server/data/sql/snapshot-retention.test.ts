import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import type { Result } from '@forge/sql';
import type { executeSql, SqlParameter } from './client';
import { pruneAbandonedDemoSnapshotChunks } from './snapshot-retention';

const projectId = 'e882ac2c-3128-4352-9fa4-90f2afc70001';
const otherProject = 'e882ac2c-3128-4352-9fa4-90f2afc70002';
const liveProject = 'e882ac2c-3128-4352-9fa4-90f2afc70003';
const expired = '2026-11-25 12:00:00.000';
const future = '2026-11-25 12:00:00.001';

function setup(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE ctx_project (id TEXT PRIMARY KEY, data_mode TEXT NOT NULL);
    CREATE TABLE ctx_data_snapshot (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, state TEXT NOT NULL, access_class TEXT NOT NULL,
      expires_at TEXT NOT NULL, sealed_at TEXT
    );
    CREATE TABLE ctx_snapshot_chunk (
      snapshot_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, PRIMARY KEY (snapshot_id, chunk_index)
    );
    CREATE TABLE ctx_scenario (project_id TEXT NOT NULL, snapshot_id TEXT NOT NULL);
    CREATE TABLE ctx_simulation_run (project_id TEXT NOT NULL, snapshot_id TEXT NOT NULL);
  `);
  db.function('fixed_utc_time', () => expired);
  const insertProject = db.prepare('INSERT INTO ctx_project VALUES (?, ?)');
  insertProject.run(projectId, 'DEMO');
  insertProject.run(otherProject, 'DEMO');
  insertProject.run(liveProject, 'LIVE');

  function put(id: string, overrides: {
    project?: string; state?: string; access?: string; expiresAt?: string; sealedAt?: string;
  } = {}) {
    db.prepare('INSERT INTO ctx_data_snapshot VALUES (?, ?, ?, ?, ?, ?)').run(
      id, overrides.project ?? projectId, overrides.state ?? 'BUILDING', overrides.access ?? 'SYNTHETIC_DEMO',
      overrides.expiresAt ?? expired, overrides.sealedAt ?? null,
    );
    db.prepare('INSERT INTO ctx_snapshot_chunk VALUES (?, 0)').run(id);
  }

  function query(before?: (statement: string) => void): typeof executeSql {
    return async <Row>(statement: string, params: readonly SqlParameter[]): Promise<Result<Row>['rows']> => {
      before?.(statement);
      const sql = db.prepare(statement.replaceAll('UTC_TIMESTAMP(3)', 'fixed_utc_time()'));
      const bound = params.map((param) => typeof param === 'boolean' ? Number(param) : param);
      if (statement.startsWith('SELECT')) {
        return sql.all(...bound) as Result<Row>['rows'];
      }
      return { affectedRows: sql.run(...bound).changes } as Result<Row>['rows'];
    };
  }

  function inspect(id: string) {
    const state = db.prepare('SELECT state FROM ctx_data_snapshot WHERE id = ?').get(id)?.state;
    const chunks = db.prepare('SELECT COUNT(*) AS n FROM ctx_snapshot_chunk WHERE snapshot_id = ?').get(id)?.n;
    return { state, chunks };
  }
  return { db, put, query, inspect };
}

test('CT002-05: cleanup fences only expired synthetic drafts in the authorized project', async (t) => {
  const { db, put, query, inspect } = setup(t);
  put('due');
  put('live-cut', { expiresAt: future });
  put('sealed', { state: 'SEALED', sealedAt: expired });
  put('previously-sealed', { sealedAt: expired });
  put('sensitive', { access: 'HSE_READER' });
  put('other-project', { project: otherProject });
  put('non-demo', { project: liveProject });
  put('scenario-ref');
  put('run-ref');
  db.prepare('INSERT INTO ctx_scenario VALUES (?, ?)').run(projectId, 'scenario-ref');
  db.prepare('INSERT INTO ctx_simulation_run VALUES (?, ?)').run(otherProject, 'run-ref');

  assert.deepEqual(await pruneAbandonedDemoSnapshotChunks(projectId, query()), { snapshotsFenced: 1, chunksDeleted: 1 });
  assert.deepEqual(inspect('due'), { state: 'EXPIRED_BUILD', chunks: 0 });
  for (const id of ['live-cut', 'previously-sealed', 'sensitive', 'other-project', 'non-demo', 'scenario-ref', 'run-ref']) {
    assert.deepEqual(inspect(id), { state: 'BUILDING', chunks: 1 });
  }
  assert.deepEqual(inspect('sealed'), { state: 'SEALED', chunks: 1 });
  assert.deepEqual(await pruneAbandonedDemoSnapshotChunks(liveProject, query()), { snapshotsFenced: 0, chunksDeleted: 0 });
  assert.deepEqual(await pruneAbandonedDemoSnapshotChunks(projectId, query()), { snapshotsFenced: 0, chunksDeleted: 0 });
});

test('CT002-05: a concurrent seal or reference prevents removal and the tombstone stops a late seal', async (t) => {
  const { db, put, query, inspect } = setup(t);
  put('concurrent-seal');
  let sealed = false;
  let referenced = false;
  const execute = query((statement) => {
    if (!sealed && statement.startsWith('UPDATE')) {
      db.exec(`UPDATE ctx_data_snapshot SET state = 'SEALED' WHERE id = 'concurrent-seal'`);
      sealed = true;
    }
    if (!referenced && statement.startsWith('DELETE')) {
      db.prepare('INSERT INTO ctx_scenario VALUES (?, ?)').run(projectId, 'concurrent-seal');
      referenced = true;
    }
  });
  assert.deepEqual(await pruneAbandonedDemoSnapshotChunks(projectId, execute), { snapshotsFenced: 0, chunksDeleted: 0 });
  assert.deepEqual(inspect('concurrent-seal'), { state: 'SEALED', chunks: 1 });

  put('new-reference');
  const addReference = query((statement) => {
    if (statement.startsWith('DELETE')) {
      db.prepare('INSERT INTO ctx_scenario VALUES (?, ?)').run(projectId, 'new-reference');
    }
  });
  assert.deepEqual(await pruneAbandonedDemoSnapshotChunks(projectId, addReference), { snapshotsFenced: 1, chunksDeleted: 0 });
  assert.deepEqual(inspect('new-reference'), { state: 'EXPIRED_BUILD', chunks: 1 });
  assert.equal(db.prepare(`UPDATE ctx_data_snapshot SET state = 'SEALED'
    WHERE id = ? AND project_id = ? AND state = 'BUILDING'`).run('new-reference', projectId).changes, 0);
});

test('CT002-05: interrupted cleanup resumes in bounded batches and invalid scope performs no SQL', async (t) => {
  const { db, put, query, inspect } = setup(t);
  put('interrupted');
  const append = db.prepare('INSERT INTO ctx_snapshot_chunk VALUES (?, ?)');
  for (let i = 1; i <= 50; i += 1) {
    append.run('interrupted', i);
  }

  await assert.rejects(pruneAbandonedDemoSnapshotChunks('invalid', query(() => assert.fail('unexpected SQL'))),
    /Invalid snapshot retention project scope/);
  await assert.rejects(pruneAbandonedDemoSnapshotChunks(projectId, query((statement) => {
    if (statement.startsWith('DELETE')) {
      throw new Error('interrupted');
    }
  })), /interrupted/);
  assert.deepEqual(inspect('interrupted'), { state: 'EXPIRED_BUILD', chunks: 51 });
  assert.deepEqual(await pruneAbandonedDemoSnapshotChunks(projectId, query()), { snapshotsFenced: 0, chunksDeleted: 50 });
  assert.deepEqual(await pruneAbandonedDemoSnapshotChunks(projectId, query()), { snapshotsFenced: 0, chunksDeleted: 1 });
  assert.deepEqual(inspect('interrupted'), { state: 'EXPIRED_BUILD', chunks: 0 });
});
