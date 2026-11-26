import assert from 'node:assert/strict';
import test from 'node:test';
import type { Distribution, PairedComparison } from '../../domain/futuros/statistics';
import type { FuturosResultReference } from '../../shared/futuros';
import { createCompareFuturosResults } from './compare-runs';
import { resolveJiraProjectReference } from './context';

const base = '11111111-2222-4333-8444-555555555555';
const first = '22222222-2222-4333-8444-555555555555';
const second = '33333333-2222-4333-8444-555555555555';
const context = { accountId: 'verified-user', installContext: 'ari:cloud:jira::site/example' };
const selectors = { jiraProjectId: '10202', baseRunId: base, candidateRunId: first };

function distribution<T>(value: T): Distribution<T> {
  const values = { p05: value, p10: value, p50: value, p80: value, p90: value, p95: value };
  return { observedCount: 4000, totalCount: 4000, percentiles: values, lowerBounds: values, histogram: [] };
}

const success = { deltaPercentagePoints: -6.525, standardErrorPercentagePoints: 0.391, signRobust: true, unknownPairs: 0 };
const comparison: PairedComparison = {
  sampleCount: 4000,
  finishDay: { p80Delta: 4, pairedDeltas: distribution(5), observedCount: { base: 4000, alternative: 4000 },
    histogram: { base: [{ from: 25, to: 26, count: 120 }], alternative: [] } },
  costCents: { p80Delta: '11250000', pairedDeltas: distribution('10950000'),
    observedCount: { base: 4000, alternative: 4000 }, histogram: { base: [], alternative: [] } },
  success: { deadline: success, budget: success, joint: success },
};

function reference(id: string): FuturosResultReference {
  return { id, scenarioId: id, snapshotId: base, snapshotAsOf: '2026-11-24', modelVersion: 'cpm-pert-v1',
    engineBuild: 'futuros-1.0.0', rngVersion: 'hmac-sha256-v1', resultHash: 'f'.repeat(64),
    finishedAt: '2026-11-26T09:00:02.000Z', sampleCount: 4000 };
}

test('CT007-02 action resolves only configured project aliases and rejects forged context and run selectors', async () => {
  assert.equal(resolveJiraProjectReference('PED', '10202'), '10202');
  assert.equal(resolveJiraProjectReference('PED', ''), undefined);
  assert.equal(resolveJiraProjectReference('https://attacker.invalid/PED', '10202'), undefined);
  const action = createCompareFuturosResults(async () => { throw new Error('Authorization must stop before reading'); });
  const spoofed = await action({ ...selectors, context }, { installContext: context.installContext });
  assert.ok(!spoofed.ok && spoofed.error.code === 'AUTH_REQUIRED');
  const duplicate = await action({ ...selectors, secondCandidateRunId: base }, context);
  assert.ok(!duplicate.ok && duplicate.error.code === 'INVALID_REFERENCE');
  const url = await action({ ...selectors, candidateRunId: 'https://attacker.invalid/private' }, context);
  assert.deepEqual(url, duplicate);
  assert.doesNotMatch(JSON.stringify(url), /attacker|private|verified-user/);
});

test('CT007-03 comparison preserves marginal and paired quantiles with exact authorized references', async () => {
  const action = createCompareFuturosResults(async (request) => {
    assert.deepEqual(request, { payload: { baselineRunId: base, alternativeRunIds: [first, second] },
      context: { ...context, extension: { project: { id: '10202' } } } });
    return { ok: true, requestId: 'comparison-request', data: { baselineId: base,
      items: [{ runId: first, comparison }, { runId: second, comparison }], references: [base, first, second].map(reference) } };
  });
  const output = await action({ ...selectors, secondCandidateRunId: second, url: 'https://attacker.invalid' }, context);
  assert.ok(output.ok);
  assert.deepEqual(output.references.map(({ runId }) => runId), [base, first, second]);
  assert.equal(output.comparisons[0]?.finishDay.p80Delta, 4);
  assert.equal(output.comparisons[0]?.finishDay.pairedDeltas.percentiles.p80, 5);
  assert.equal(output.comparisons[0]?.costCents.p80Delta, '11250000');
  assert.equal(output.comparisons[1]?.success.joint.deltaPercentagePoints, -6.525);
  assert.doesNotMatch(JSON.stringify(output), /attacker|histogram|verified-user/);
  assert.ok(Buffer.byteLength(JSON.stringify(output)) < 32 * 1024);
});

test('CT007-03 protected, incomplete and incompatible comparisons return typed absences without partial evidence', async () => {
  for (const [code, expected] of [['NOT_FOUND', 'NOT_AVAILABLE'], ['FORBIDDEN', 'NOT_AVAILABLE'],
    ['RUN_NOT_READY', 'NOT_READY'], ['INCOMPATIBLE_RUNS', 'INCOMPATIBLE_RUNS'], ['SAMPLES_EXPIRED', 'SAMPLES_EXPIRED']] as const) {
    const action = createCompareFuturosResults(async () => ({ ok: false, requestId: 'private', error: { code, message: 'private' } }));
    const output = await action(selectors, context);
    assert.ok(!output.ok && output.error.code === expected);
    assert.doesNotMatch(JSON.stringify(output), /private|reference|histogram/);
  }
});
