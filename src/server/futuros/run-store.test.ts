import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { Result } from '@forge/sql';
import { canonicalJson, inputDigest, sha256 } from '../../domain/futuros/digest';
import type { EngineInput } from '../../domain/futuros/types';
import type { executeSql, SqlParameter } from '../data/sql/client';
import { modelMigrations } from '../data/sql/schema';
import { createRunStore, type NewRun } from './run-store';
import { createFuturosWorker, readRunSamples, type FuturosResultManifest } from './worker';

const projectId = 'test-project';
const syntheticInput: EngineInput = {
  snapshotId: 'test-snapshot', snapshotHash: 'a'.repeat(64), scenarioId: 'test-scenario', scenarioHash: 'b'.repeat(64),
  asOf: '2026-11-25', calendar: 'CONTINUOUS', currency: 'USD', seed: '10'.repeat(16), sampleCount: 201,
  horizon: 60, targetDay: 12, budgetCents: '9000',
  tasks: [
    { id: 'work-1', code: 'WP-001', duration: [2, 3, 5], releaseDay: 0, priority: 1, milestone: false, requirements: [] },
    { id: 'work-gate', code: 'WP-002', duration: [0, 0, 0], releaseDay: 0, priority: 2, milestone: true, requirements: [] },
  ],
  dependencies: [{ predecessorId: 'work-1', successorId: 'work-gate', lagDays: 1 }],
  resources: [], gates: [], risks: [],
  costs: { actualCents: '1000', remainingCents: '3000', indirectCentsPerDay: '10', standby: [] },
};

function fixedDatabase(t: { after(callback: () => void): void }) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const selected = new Set(['ctx_project', 'ctx_data_snapshot', 'ctx_scenario', 'ctx_simulation_run', 'ctx_run_batch', 'ctx_prediction']);
  for (const [, ddl] of modelMigrations) {
    const table = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(ddl)?.[1];
    if (!table || !selected.has(table)) continue;
    const indexes = Array.from(ddl.matchAll(/^\s+(UNIQUE )?KEY (\w+) \(([^)]+)\),?$/gm));
    db.exec(ddl.replace(/^\s+(?:UNIQUE )?KEY .+$/gm, '')
      .replace(/,\s*\)(?: DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin)?\s*$/, ')')
      .replace(/ DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin\s*$/, ''));
    for (const [, unique = '', name, columns] of indexes) {
      db.exec(`CREATE ${unique}INDEX ${name} ON ${table} (${columns})`);
    }
  }
  const { snapshotId, snapshotHash, scenarioId, scenarioHash } = syntheticInput;
  db.prepare(`INSERT INTO ctx_project (id, code, name, jira_project_id, jira_project_key, time_zone, currency,
         data_mode, status, version, updated_at)
    VALUES (?, 'PED', 'Synthetic test project', '10001', 'PED', 'UTC', 'USD', 'DEMO', 'ACTIVE', 1, '2026-11-25 00:00:00.000')`)
    .run(projectId);
  db.prepare(`INSERT INTO ctx_data_snapshot (id, project_id, state, schema_version, as_of_date, collected_at, sealed_at,
         expires_at, created_by, access_class, chunk_count, content_hash, source_manifest_jcs, quality_jcs)
    VALUES (?, ?, 'SEALED', 1, '2026-11-25', '2026-11-25 00:00:00.000', '2026-11-25 00:00:00.000',
         '2026-12-25 00:00:00.000', 'owner', 'SYNTHETIC_DEMO', 1, ?, '{}', '{}')`)
    .run(snapshotId, projectId, snapshotHash);
  db.prepare(`INSERT INTO ctx_scenario (id, project_id, snapshot_id, root_id, revision, name, schema_version,
         state, content_hash, request_hash, idempotency_key, created_by, created_at, published_at)
    VALUES (?, ?, ?, ?, 1, 'Test scenario', 1, 'PUBLISHED', ?, ?, 'seeded', 'owner',
         '2026-11-25 00:00:00.000', '2026-11-25 00:00:00.000')`)
    .run(scenarioId, projectId, snapshotId, scenarioId, scenarioHash, 'c'.repeat(64));

  let nowMs = Date.parse('2026-11-25T00:00:00.000Z');
  let interruptProgress = false;
  const query: typeof executeSql = async <Row>(statement: string, parameters: readonly SqlParameter[]): Promise<Result<Row>['rows']> => {
    assert.doesNotMatch(statement, /\bLIMIT\s*\?/i, 'Forge SQL rejects parameterized LIMIT clauses');
    if (interruptProgress && statement.includes('SET materialized_count =')) {
      interruptProgress = false;
      throw new Error('simulated interruption between batch and progress update');
    }
    const now = new Date(nowMs).toISOString().slice(0, -1).replace('T', ' ');
    const prepared = db.prepare(statement
      .replace(/ON DUPLICATE KEY UPDATE \w+ = \w+\.\w+/g, 'ON CONFLICT DO NOTHING')
      .replaceAll('TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))', "strftime('%Y-%m-%d %H:%M:%f', UTC_TIMESTAMP(3), ? || ' seconds')")
      .replaceAll('UTC_TIMESTAMP(3)', `'${now}'`)
      .replaceAll('CAST(? AS UNSIGNED)', 'CAST(? AS INTEGER)'));
    const values = parameters.map((value) => typeof value === 'boolean' ? Number(value) : value);
    if (statement.trimStart().startsWith('SELECT')) return prepared.all(...values) as Result<Row>['rows'];
    return { affectedRows: prepared.run(...values).changes } as Result<Row>['rows'];
  };
  return {
    db, store: createRunStore(query), advance: (seconds: number) => { nowMs += seconds * 1000; },
    interruptProgress: () => { interruptProgress = true; },
  };
}

function newRun(idempotencyKey = 'sample-run', input = syntheticInput): NewRun {
  return {
    projectId, scenarioId: input.scenarioId, snapshotId: input.snapshotId, seed: input.seed, sampleCount: input.sampleCount,
    inputHash: inputDigest(input), requestedBy: 'owner', requestHash: 'd'.repeat(64), idempotencyKey,
  };
}

function batch(batchIndex: number, sampleCount: number, marker = 'test') {
  const samplesJcs = canonicalJson({ marker });
  return { batchIndex, firstSample: batchIndex * 100, sampleCount, samplesJcs, hash: sha256(samplesJcs) };
}

test('CT005-04 startup scopes the durable journal, replays the same request, and rejects a changed request', async (t) => {
  const { store } = fixedDatabase(t);
  await assert.rejects(store.startRun({ ...newRun(), projectId: 'other-project' }), { code: 'STALE_INPUT' });
  const first = await store.startRun(newRun());
  assert.equal(first.created, true);
  assert.equal(first.run.status, 'QUEUED');
  assert.equal(first.run.deadlineAt, '2026-11-25T00:20:00.000Z');
  assert.deepEqual(await store.startRun(newRun()), { run: first.run, created: false });
  await assert.rejects(store.startRun({ ...newRun(), requestHash: 'e'.repeat(64) }), { code: 'CONFLICT' });
  assert.equal(await store.getRun('other-project', first.run.id), undefined);
  assert.equal(await store.cancelRun(projectId, first.run.id, 'other-actor'), undefined);
  await assert.rejects(store.startRun({ ...newRun('invalid-retry'), retryOfId: first.run.id }), { code: 'STALE_INPUT' });
  assert.equal((await store.cancelRun(projectId, first.run.id, 'owner'))?.status, 'CANCELED');
  const retry = await store.startRun({ ...newRun('retry'), retryOfId: first.run.id });
  assert.equal(retry.run.retryOfId, first.run.id);
  assert.notEqual(retry.run.id, first.run.id);
});

test('CT005-04 stale fences cannot persist, cancel invalidates the lease, and publication requires all batches', async (t) => {
  const { store, advance } = fixedDatabase(t);
  const { run } = await store.startRun(newRun());
  const expired = await store.claimRun(run.id);
  assert.ok(expired);
  assert.equal(await store.claimRun(run.id), undefined);
  advance(151);
  const current = await store.claimRun(run.id);
  assert.ok(current);
  assert.notEqual(current.fence, expired.fence);
  assert.equal(await store.saveBatch(expired, batch(0, 100)), false);
  const manifest = '{"metric":"test"}';
  assert.equal(await store.publishRun(current, sha256(manifest), manifest), false);
  assert.equal(await store.saveBatch(current, batch(2, 1)), true);
  assert.equal(await store.saveBatch(current, batch(0, 100)), true);
  assert.equal(await store.saveBatch(current, batch(0, 100)), true);
  assert.deepEqual(await store.batchIndexes(run.id), [0, 2]);
  assert.equal((await store.getRun(projectId, run.id))?.materializedCount, 101);
  await assert.rejects(store.saveBatch(current, batch(0, 100, 'conflict')), { code: 'MODEL_UNAVAILABLE' });
  assert.equal(await store.saveBatch(current, batch(1, 100)), true);
  assert.equal(await store.publishRun(expired, sha256(manifest), manifest), false);
  assert.equal((await store.cancelRun(projectId, run.id, 'owner'))?.status, 'CANCELED');
  assert.equal(await store.publishRun(current, sha256(manifest), manifest), false);
  assert.equal((await store.getRun(projectId, run.id))?.resultManifestJcs, null);
  assert.equal(await readRunSamples({ ...run, status: 'CANCELED' }, store), undefined);
});

test('CT005-04 fixed LIMIT pages retain every batch in index order', async (t) => {
  const { store } = fixedDatabase(t);
  const { run } = await store.startRun(newRun('many-batches', { ...syntheticInput, sampleCount: 901 }));
  const lease = await store.claimRun(run.id);
  assert.ok(lease);
  for (let index = 9; index >= 0; index -= 1) {
    assert.equal(await store.saveBatch(lease, batch(index, index === 9 ? 1 : 100)), true);
  }
  const stored = await store.listBatches(run.id);
  assert.deepEqual(stored.map(({ batchIndex }) => batchIndex), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(stored.reduce((count, entry) => count + entry.sampleCount, 0), 901);
});

test('CT005-04 resumed processing publishes the same result hash and retained sample order as a complete invocation', async (t) => {
  const { db, store, advance } = fixedDatabase(t);
  const queued: Array<[string, number]> = [];
  const push = async (id: string, delay: number) => { queued.push([id, delay]); };
  const resumed = (await store.startRun(newRun())).run;
  const clock = [0, 0, 101];
  const loadInput = async () => syntheticInput;
  const partialWorker = createFuturosWorker({ store, loadInput, push, monotonicClock: () => clock.shift() ?? 101, invocationBudgetMs: 100 });
  await partialWorker.consume(resumed.id);
  assert.deepEqual(queued, [[resumed.id, 0]]);
  const partial = await store.getRun(projectId, resumed.id);
  assert.equal(partial?.status, 'RUNNING');
  assert.equal(partial.materializedCount, 100);
  assert.equal(partial.resultManifestJcs, null);
  assert.equal(await readRunSamples(partial, store), undefined);

  const abandoned = await store.claimRun(resumed.id);
  assert.ok(abandoned);
  assert.equal(await store.savePredictions(abandoned, [{
    metricCode: 'FINISH_DAY', subjectId: projectId, unitCode: 'DAY', summaryJcs: '{"staged":true}', evidenceJcs: '{}',
  }], syntheticInput.horizon), true);
  assert.equal(await store.releaseRun(abandoned), true);

  const finalWorker = createFuturosWorker({ store, loadInput, push });
  await finalWorker.consume(resumed.id);
  const complete = (await store.startRun(newRun('same-input'))).run;
  await finalWorker.consume(complete.id);
  const resumedResult = await store.getRun(projectId, resumed.id);
  assert.ok(resumedResult?.resultManifestJcs);
  assert.equal(resumedResult.status, 'SUCCEEDED');
  assert.equal(resumedResult.materializedCount, 201);
  assert.equal(resumedResult.resultHash, (await store.getRun(projectId, complete.id))?.resultHash);
  const manifest = JSON.parse(resumedResult.resultManifestJcs) as FuturosResultManifest;
  assert.equal(manifest.summary.sampleCount, 201);
  assert.ok(manifest.summary.criticity.every((item) => item.frequency === 1));
  assert.equal(db.prepare(`SELECT COUNT(*) AS number FROM ctx_prediction p JOIN ctx_simulation_run r
      ON r.id = p.run_id AND r.result_generation = p.result_generation
      WHERE r.id = ? AND r.status = 'SUCCEEDED'`).get(resumed.id)?.number, 9);
  const samples = await readRunSamples(resumedResult, store);
  assert.ok(samples);
  assert.deepEqual(samples.map(({ index }) => index), Array.from({ length: 201 }, (_, index) => index));
  advance(8 * 86_400);
  assert.equal(await readRunSamples(resumedResult, store), undefined);
  assert.equal(await finalWorker.recover(), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS number FROM ctx_run_batch').get()?.number, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS number FROM ctx_prediction WHERE run_id = ?').get(resumed.id)?.number, 9);
  assert.equal((await store.getRun(projectId, resumed.id))?.resultHash, resumedResult.resultHash);
});

test('CT005-04 resumes after a batch commits before its progress update and refuses a changed immutable input', async (t) => {
  const { store, advance, interruptProgress } = fixedDatabase(t);
  const { run } = await store.startRun(newRun());
  const pushed: Array<[string, number]> = [];
  const worker = createFuturosWorker({
    store, loadInput: async () => syntheticInput, push: async (id, delay) => { pushed.push([id, delay]); },
  });
  interruptProgress();
  await worker.consume(run.id);
  assert.deepEqual(await store.batchIndexes(run.id), [0]);
  assert.equal((await store.getRun(projectId, run.id))?.materializedCount, 0);
  assert.deepEqual(pushed, [[run.id, 15]]);
  advance(15);
  await worker.consume(run.id);
  assert.equal((await store.getRun(projectId, run.id))?.status, 'SUCCEEDED');

  const changed = (await store.startRun(newRun('changed-input'))).run;
  const changedWorker = createFuturosWorker({
    store, loadInput: async () => ({ ...syntheticInput, targetDay: syntheticInput.targetDay + 1 }),
    push: async () => { assert.fail('changed input is terminal'); },
  });
  await changedWorker.consume(changed.id);
  const rejected = await store.getRun(projectId, changed.id);
  assert.equal(rejected?.status, 'FAILED');
  assert.equal(rejected.errorCode, 'STALE_INPUT');
  assert.equal(rejected.resultManifestJcs, null);
  assert.deepEqual(await store.batchIndexes(changed.id), []);

  const forbidden = (await store.startRun(newRun('forbidden-source'))).run;
  const forbiddenWorker = createFuturosWorker({
    store, loadInput: async () => { throw Object.assign(new Error('private source detail'), { code: 'FORBIDDEN' }); },
    push: async () => { assert.fail('forbidden input is terminal'); },
  });
  await forbiddenWorker.consume(forbidden.id);
  const restricted = await store.getRun(projectId, forbidden.id);
  assert.equal(restricted?.status, 'FAILED');
  assert.equal(restricted.errorCode, 'STALE_INPUT');
  assert.deepEqual(await store.batchIndexes(forbidden.id), []);
});

test('CT005-06 failed queue push is recoverable after the durable cooldown and the 20-minute deadline closes the run', async (t) => {
  const { store, advance } = fixedDatabase(t);
  const { run } = await store.startRun(newRun());
  const sent: string[] = [];
  const worker = createFuturosWorker({
    store, loadInput: async () => syntheticInput, push: async (id) => {
      sent.push(id);
      if (sent.length === 1) throw new Error('queue service unavailable');
    },
  });
  assert.equal(await worker.dispatch(run.id), false);
  assert.equal(await worker.recover(), 0);
  advance(31);
  assert.equal(await worker.recover(), 1);
  assert.deepEqual(sent, [run.id, run.id]);
  assert.ok(await store.claimRun(run.id));
  await worker.consume(run.id);
  assert.deepEqual(await store.batchIndexes(run.id), []);
  advance(20 * 60);
  assert.equal(await worker.recover(), 0);
  const failed = await store.getRun(projectId, run.id);
  assert.equal(failed?.status, 'FAILED');
  assert.equal(failed.errorCode, 'RUN_TIMEOUT');
  assert.equal(failed.resultManifestJcs, null);
});

test('CT005-04 scoped expiry preserves ownership and lets the owner retry an overdue run', async (t) => {
  const { store, db, advance } = fixedDatabase(t);
  const { run } = await store.startRun(newRun());
  const other = (await store.startRun({ ...newRun('other-run'), requestedBy: 'other-actor' })).run;
  advance(1199);
  const lease = await store.claimRun(run.id);
  assert.ok(lease);
  assert.equal(await store.expireRun(projectId, run.id, 'owner'), false);
  advance(1);
  assert.equal(await store.expireRun(projectId, run.id, 'other-actor'), false);
  assert.equal(await store.expireRun('other-project', run.id, 'owner'), false);
  assert.equal(await store.expireRun(projectId, run.id, 'owner'), true);
  assert.equal(await store.expireRun(projectId, run.id, 'owner'), false);
  assert.equal((await store.getRun(projectId, run.id))?.errorCode, 'RUN_TIMEOUT');
  assert.equal((await store.getRun(projectId, other.id))?.status, 'QUEUED');
  assert.deepEqual({ ...db.prepare('SELECT fence, lease_owner, lease_until FROM ctx_simulation_run WHERE id = ?').get(run.id) },
    { fence: Number(lease.fence) + 1, lease_owner: null, lease_until: null });
  const retry = await store.startRun({ ...newRun('after-timeout'), retryOfId: run.id });
  assert.notEqual(retry.run.id, run.id);
  assert.equal(retry.run.retryOfId, run.id);
});
