import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { Result } from '@forge/sql';
import { canonicalJson, inputDigest, sha256 } from '../../domain/futuros/digest';
import { prepareEngine } from '../../domain/futuros/engine';
import { compareSamples, summarizeSamples } from '../../domain/futuros/statistics';
import type { JiraWorkItem } from '../data/jira/types';
import { fixture } from '../data/bootstrap/fixture';
import type { executeSql, SqlParameter } from '../data/sql/client';
import { modelMigrations } from '../data/sql/schema';
import { parseScenarioEdit, publishScenarioRevision } from './scenario-editor';
import { confirmFuturosVisibility, listFuturosScenarios, loadFuturosSnapshot, SnapshotFailure } from './snapshot';

const seed = '00000000000000000000000020261125';
const projectId = fixture.project.id;
const sections = {
  project: [fixture.project], zones: fixture.zones, phases: fixture.phases, facilities: fixture.facilities,
  contractors: fixture.contractors, assets: fixture.assets, crewPools: fixture.crewPools, workPackages: fixture.workPackages,
  dependencies: fixture.dependencies, shipments: fixture.shipments, workResources: fixture.workResources,
  resourceWindows: fixture.resourceWindows, costRecords: fixture.costRecords, historicalMetrics: fixture.historicalMetrics,
};
const schemaVersion = fixture.snapshot.schemaVersion;
const contentHash = sha256(canonicalJson({ schemaVersion, sections }));
const chunks = Object.entries(sections).flatMap(([section, rows]) => {
  const payloads: string[] = [];
  for (let start = 0; start < rows.length; start += 50) {
    payloads.push(canonicalJson({ section, rows: rows.slice(start, start + 50) }));
  }
  return payloads;
}).map((payload, index) => ({ chunk_index: index, chunk_hash: sha256(payload), payload_jcs: payload }));

function mockDb(scenario: PatagoniaScenario, corrupt?: 'chunk' | 'variable' | 'snapshot'): typeof executeSql {
  return async <Row>(sql: string, params: readonly SqlParameter[]): Promise<Result<Row>['rows']> => {
    let rows: unknown[];
    if (sql.includes('FROM ctx_scenario c')) {
      assert.deepEqual(params, [projectId, scenario.id, fixture.snapshot.id]);
      rows = corrupt === 'snapshot' ? [] : [{
        snapshot_id: fixture.snapshot.id, snapshot_hash: contentHash, schema_version: schemaVersion, scenario_version: schemaVersion,
        as_of: fixture.snapshot.asOfDate, scenario_hash: sha256(canonicalJson(scenario)), revision: scenario.revision, chunk_count: chunks.length,
      }];
    } else if (sql.includes('FROM ctx_snapshot_chunk k')) {
      assert.deepEqual(params, [fixture.snapshot.id, projectId]);
      rows = chunks.map((chunk, index) => index === 0 && corrupt === 'chunk'
        ? { ...chunk, payload_jcs: chunk.payload_jcs + ' ' } : chunk);
    } else {
      assert.match(sql, /FROM ctx_scenario_variable v/);
      assert.deepEqual(params, [projectId, scenario.id]);
      rows = scenario.variables.map((variable) => ({
        ordinal: variable.ordinal, variable_code: variable.variableCode, unit_code: variable.unitCode,
        target_kind: variable.targetKind, target_id: variable.targetId,
        value_jcs: corrupt === 'variable' ? '16' : canonicalJson(variable.value),
        evidence_jcs: canonicalJson(variable.sourceRefs), reason: variable.reason,
      }));
    }
    return rows as Result<Row>['rows'];
  };
}

type PatagoniaScenario = (typeof fixture.scenarios)[number];
const scenario = (code: string) => fixture.scenarios.find((item) => item.code === code)!;
const profile = (code: string, sampleCount = 4000, corrupt?: 'chunk' | 'variable' | 'snapshot') => {
  const selected = scenario(code);
  return loadFuturosSnapshot({ projectId, scenarioId: selected.id, seed, sampleCount }, mockDb(selected, corrupt));
};

test('rejects stale or tampered chunks, mismatch in published variables and unrelated projects before scheduling', async () => {
  for (const target of ['chunk', 'variable', 'snapshot'] as const) {
    await assert.rejects(profile('S1', 4000, target), (error: unknown) =>
      error instanceof SnapshotFailure && error.code === (target === 'variable' ? 'INVALID_SCENARIO' : 'STALE_INPUT'));
  }
  await assert.rejects(loadFuturosSnapshot({
    projectId: 'foreign', scenarioId: scenario('S0').id, seed, sampleCount: 4000,
  }, async () => { throw new Error('foreign reads are forbidden'); }), { code: 'FORBIDDEN' });
});

test('snapshot-wide source authority requires every mapped work item and discards a foreign Jira project', async () => {
  const rows = fixture.workPackages.map(({ id }, index) => ({ id, jira_issue_id: String(10000 + index) }));
  const jira: JiraWorkItem[] = rows.map(({ jira_issue_id: id }, index) => ({
    id, projectId: '10202', key: 'PED-' + (index + 1), issueTypeId: '10001', summary: 'Fixture',
    status: { id: '1', name: 'Open', categoryKey: 'new' }, assigneeAccountId: null, dueDate: null,
    updatedAt: '2026-11-24T14:00:00.000Z', labels: [],
  }));
  const query = (async (_sql: string, args: readonly SqlParameter[]) => {
    assert.deepEqual(args, [projectId, '10202']);
    return rows;
  }) as typeof executeSql;
  assert.equal(await confirmFuturosVisibility(projectId, '10202', jira, query), true);
  assert.equal(await confirmFuturosVisibility(projectId, '10202', jira.slice(0, -1), query), false);
  assert.equal(await confirmFuturosVisibility(projectId, '10202',
    [{ ...jira[0]!, projectId: '10203' }, ...jira.slice(1)], query), false);
});

test('CT005-05 Patagonia modal independently closes on days 26, 37 and 27', async () => {
  const inputs = await Promise.all(['S0', 'S1', 'S2'].map((code) => profile(code)));
  const [base, delay, mitigation] = inputs.map((input) => prepareEngine(input).sample(0, true));
  assert.deepEqual([base!.finishDay, delay!.finishDay, mitigation!.finishDay], [26, 37, 27]);
  assert.ok(base!.costCents !== null && delay!.costCents !== null && mitigation!.costCents !== null);
  assert.deepEqual([delay!.costCents - base!.costCents, mitigation!.costCents - base!.costCents], [14_450_000, 8_950_000]);
});

test('CT005-05 4000 shared draws reproduce Patagonia and justify a schedule trade-off', async (context) => {
  const inputs = await Promise.all(['S0', 'S1', 'S2'].map((code) => profile(code)));
  const collections = inputs.map((input) => {
    const start = performance.now();
    const engine = prepareEngine(input);
    const samples = Array.from({ length: input.sampleCount }, (_, index) => engine.sample(index));
    const result = summarizeSamples(input, samples, engine);
    return { input, samples, result, hash: sha256(canonicalJson(result)), cpuMs: Math.round(performance.now() - start) };
  });
  const [base, delay, mitigation] = collections;
  assert.ok(base && delay && mitigation);
  const p80 = (result: typeof base.result) => result.finishDay.percentiles.p80 ?? Number.POSITIVE_INFINITY;
  assert.ok(p80(base.result) < p80(delay.result));
  assert.ok(p80(mitigation.result) < p80(delay.result));
  assert.ok(Number(mitigation.result.costCents.percentiles.p80) > Number(base.result.costCents.percentiles.p80));
  const comparison = compareSamples(delay.input, delay.samples, mitigation.input, mitigation.samples);
  assert.ok(comparison.finishDay.p80Delta !== null && comparison.finishDay.p80Delta < 0);
  const same = await profile('S1');
  assert.equal(inputDigest(same), inputDigest(delay.input));
  assert.deepEqual(prepareEngine(same).sample(3310), delay.samples[3310]);
  context.diagnostic('A17-BENCH ' + JSON.stringify(collections.map(({ input, result, hash, cpuMs }) => ({
    inputHash: inputDigest(input), resultHash: hash, cpuMs, finishP80: result.finishDay.percentiles.p80,
    costP80: result.costCents.percentiles.p80, joint: result.success.joint.probability,
  }))));
});

const actor = 'planner';
const baselineId = scenario('S0').id;

function editorDatabase(t: { after(callback: () => void): void }) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const selected = new Set(['ctx_project', 'ctx_project_role', 'ctx_data_snapshot', 'ctx_snapshot_chunk',
    'ctx_scenario', 'ctx_scenario_variable']);
  for (const [, ddl] of modelMigrations) {
    const table = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(ddl)?.[1];
    if (!table || !selected.has(table)) continue;
    const indexes = Array.from(ddl.matchAll(/^\s+(UNIQUE )?KEY (\w+) \(([^)]+)\),?$/gm));
    db.exec(ddl.replace(/^\s+(?:UNIQUE )?KEY .+$/gm, '')
      .replace(/,\s*\)(?: DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin)?\s*$/, ')')
      .replace(/ DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin\s*$/, ''));
    for (const [, unique = '', name, columns] of indexes) db.exec(`CREATE ${unique}INDEX ${name} ON ${table} (${columns})`);
  }
  db.exec('ALTER TABLE ctx_scenario ADD COLUMN editor_definition_jcs TEXT');
  const utc = '2026-11-26 00:00:00.000';
  db.prepare(`INSERT INTO ctx_project (id, code, name, jira_project_id, jira_project_key, time_zone, currency,
    data_mode, status, version, updated_at) VALUES (?, 'PED', 'Patagonia', '10001', 'PED', 'UTC', 'USD', 'DEMO', 'ACTIVE', 1, ?)`)
    .run(projectId, utc);
  db.prepare(`INSERT INTO ctx_project_role (project_id, account_id, role_code, granted_by, granted_at)
    VALUES (?, ?, 'PLANNER', ?, ?), (?, 'viewer', 'VIEWER', ?, ?)`)
    .run(projectId, actor, actor, utc, projectId, actor, utc);
  db.prepare(`INSERT INTO ctx_data_snapshot (id, project_id, state, schema_version, as_of_date, collected_at, sealed_at,
    expires_at, created_by, access_class, chunk_count, content_hash, source_manifest_jcs, quality_jcs)
    VALUES (?, ?, 'SEALED', ?, ?, ?, ?, '2026-12-26 00:00:00.000', ?, 'SYNTHETIC_DEMO', ?, ?, '{}', '{}')`)
    .run(fixture.snapshot.id, projectId, schemaVersion, fixture.snapshot.asOfDate, utc, utc, actor, chunks.length, contentHash);
  const addChunk = db.prepare('INSERT INTO ctx_snapshot_chunk (snapshot_id, chunk_index, chunk_hash, payload_jcs) VALUES (?, ?, ?, ?)');
  for (const chunk of chunks) addChunk.run(fixture.snapshot.id, chunk.chunk_index, chunk.chunk_hash, chunk.payload_jcs);
  const addScenario = db.prepare(`INSERT INTO ctx_scenario (id, project_id, snapshot_id, root_id, baseline_id, revision,
    name, schema_version, state, content_hash, request_hash, idempotency_key, created_by, created_at, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED', ?, ?, ?, 'fixture', ?, ?)`);
  for (const item of fixture.scenarios) {
    const hash = sha256(canonicalJson(item));
    addScenario.run(item.id, projectId, fixture.snapshot.id, item.id, item.baselineId, item.revision, item.name,
      schemaVersion, hash, hash, `fixture-${item.code}`, utc, utc);
  }
  const query: typeof executeSql = async <Row>(statement: string, params: readonly SqlParameter[]) => {
    const prepared = db.prepare(statement.replace('ON DUPLICATE KEY UPDATE id = ctx_scenario.id', 'ON CONFLICT DO NOTHING')
      .replaceAll('UTC_TIMESTAMP(3)', `'${utc}'`));
    const bindings = params.map((value) => typeof value === 'boolean' ? Number(value) : value);
    return (statement.trimStart().startsWith('SELECT') ? prepared.all(...bindings) : {
      affectedRows: prepared.run(...bindings).changes,
    }) as Result<Row>['rows'];
  };
  return { db, query };
}

function edit(overrides: Partial<ReturnType<typeof parseScenarioEdit>> = {}) {
  return parseScenarioEdit({ sourceScenarioId: baselineId, expectedRevision: 1, name: ' Suministro replanteado ',
    delayDays: 15, idempotencyKey: 'edit-unique-key', ...overrides });
}

test('CT006-01 publishes an A-17 assumption with server provenance and keeps old revision inputs reproducible', async (t) => {
  const { db, query } = editorDatabase(t);
  const input = (scenarioId: string) => loadFuturosSnapshot({ projectId, scenarioId, seed, sampleCount: 1000 }, query);
  const clone = await publishScenarioRevision(projectId, actor, edit(), async (days) => {
    assert.equal(days, 15);
    await input(baselineId);
  }, query);
  assert.equal(clone.name, 'Suministro replanteado');
  assert.equal(clone.revision, 1);
  assert.equal(clone.editor?.unit, 'DAY');
  assert.equal(clone.editor?.baselineScenarioId, baselineId);
  assert.equal(clone.editor?.previousScenarioId, baselineId);
  const first = await input(clone.id);
  assert.equal(first.scenarioHash, clone.scenarioHash);
  assert.equal(prepareEngine(first).sample(0, true).finishDay, 37);
  const revise = edit({ sourceScenarioId: clone.id, delayDays: 0, idempotencyKey: 'edit-next-version' });
  const current = await publishScenarioRevision(projectId, actor, revise, async () => {}, query);
  assert.equal(current.code, clone.code);
  assert.equal(current.revision, 2);
  assert.equal(current.editor?.previousScenarioId, clone.id);
  assert.equal(prepareEngine(await input(current.id)).sample(0, true).finishDay, 26);
  assert.equal(inputDigest(await input(clone.id)), inputDigest(first));
  assert.deepEqual(await publishScenarioRevision(projectId, actor, edit(), async () => assert.fail('replay validated again'), query), clone);
  await assert.rejects(publishScenarioRevision(projectId, actor, edit({ delayDays: 17 }), async () => {}, query), { code: 'CONFLICT' });
  const catalog = await listFuturosScenarios(projectId, query);
  assert.deepEqual(catalog.slice(0, 5).map(({ code }) => code), ['S0', 'S1', 'S2', 'S3', 'S4']);
  assert.deepEqual(catalog.slice(5).map(({ id }) => id), [current.id, clone.id]);
  assert.equal((await listFuturosScenarios(projectId, query, false)).length, 5);
  db.prepare('UPDATE ctx_scenario SET name = ? WHERE id = ?').run('Nombre cambiado', current.id);
  await assert.rejects(input(current.id), { code: 'STALE_INPUT' });
});

test('CT006-01 atomically rejects a competing revision and a revoked Planner before publication', async (t) => {
  const { db, query } = editorDatabase(t);
  const clone = await publishScenarioRevision(projectId, actor, edit(), async () => {}, query);
  let releaseValidation!: () => void;
  const bothValidated = new Promise<void>((resolve) => { releaseValidation = resolve; });
  let validated = 0;
  const validate = async () => {
    validated += 1;
    if (validated === 2) releaseValidation();
    await bothValidated;
  };
  const attempts = await Promise.allSettled(['first-next-key', 'second-next-key'].map((idempotencyKey) =>
    publishScenarioRevision(projectId, actor, edit({ sourceScenarioId: clone.id, idempotencyKey }), validate, query)));
  assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejected = attempts.find((item) => item.status === 'rejected');
  assert.equal(rejected?.reason.code, 'STALE_INPUT');
  await assert.rejects(publishScenarioRevision('foreign-project', actor, edit(), async () => assert.fail(), query), { code: 'FORBIDDEN' });
  await assert.rejects(publishScenarioRevision(projectId, 'viewer', edit(), async () => assert.fail(), query), { code: 'FORBIDDEN' });
  await assert.rejects(publishScenarioRevision(projectId, actor,
    edit({ sourceScenarioId: scenario('S1').id, idempotencyKey: 'authored-scenario' }), async () => assert.fail(), query),
    { code: 'INVALID_SCENARIO' });
  await assert.rejects(publishScenarioRevision(projectId, actor, edit({ idempotencyKey: 'revoked-during-save' }), async () => {
    db.prepare('UPDATE ctx_project_role SET revoked_at = ? WHERE project_id = ? AND account_id = ?').run('2026-11-26', projectId, actor);
  }, query), { code: 'FORBIDDEN' });
  await assert.rejects(publishScenarioRevision(projectId, actor, edit(), async () => assert.fail(), query), { code: 'FORBIDDEN' });
  assert.equal((await listFuturosScenarios(projectId, query)).length, 7);
  for (const delayDays of [-1, 1.5, 366]) assert.throws(() => edit({ delayDays }), { code: 'INVALID_REQUEST' });
  assert.throws(() => edit({ name: 'A\u202EB' }), { code: 'INVALID_REQUEST' });
});
