import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Result } from '@forge/sql';
import { canonicalJson, inputDigest, sha256 } from '../../domain/futuros/digest';
import { prepareEngine } from '../../domain/futuros/engine';
import { compareSamples, summarizeSamples } from '../../domain/futuros/statistics';
import type { JiraWorkItem } from '../data/jira/types';
import { fixture } from '../data/bootstrap/fixture';
import type { executeSql, SqlParameter } from '../data/sql/client';
import { confirmFuturosVisibility, loadFuturosSnapshot, SnapshotFailure } from './snapshot';

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
