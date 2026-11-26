import assert from 'node:assert/strict';
import test from 'node:test';
import { compareSamples, spearman, StatisticsError, summarizeSamples, type7, wilson95 } from './statistics';
import type { EngineInput, Sample } from './types';

function input(sampleCount: number, overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    snapshotId: 'snapshot', snapshotHash: 'snapshot-hash', scenarioId: 'S0', scenarioHash: 'S0-hash', asOf: '2026-11-24',
    calendar: 'CONTINUOUS', currency: 'USD', seed: '12341234123412341234123412341234', sampleCount,
    horizon: 30, targetDay: 5, budgetCents: '100',
    tasks: [{ id: 't1', code: 'WP-064', duration: [1, 3, 5], releaseDay: 0, priority: 0, milestone: false, requirements: [] }],
    dependencies: [], resources: [], gates: [], risks: [],
    costs: { actualCents: '0', remainingCents: '0', indirectCentsPerDay: '0', standby: [] },
    ...overrides,
  };
}

function sample(index: number, finishDay: number | null, costCents: number | null, overrides: Partial<Sample> = {}): Sample {
  return { index, finishDay, costCents, milestoneDays: [finishDay], waits: 1, utilization: null, productivity: 1,
    factors: [42, finishDay ?? 31], critical: [0], ...overrides };
}

const options = {
  factorNames: ['constant', 'effective-duration'], milestoneIds: ['milestone'],
  logical: { finishDay: 3, tasks: [{ id: 't1', startDay: 0, finishDay: 3, slackDays: 0 }] },
};

test('STAT-05 Wilson uses the specified bilateral interval with finite endpoints', () => {
  assert.equal(wilson95(0, 0), null);
  const interval = wilson95(50, 100)!;
  assert.ok(Math.abs(interval[0] - 0.4038315303659957) < 1e-12);
  assert.ok(Math.abs(interval[1] - 0.5961684696340044) < 1e-12);
  assert.equal(wilson95(0, 100)![0], 0);
  assert.equal(wilson95(100, 100)![1], 1);
  assert.ok(wilson95(0, 100)![1] < 1);
  assert.ok(wilson95(100, 100)![0] > 0);
});

test('STAT-12 type 7, histogram counts and constant values are represented directly', () => {
  const values = [1, 2, 3, 4, 5];
  assert.equal(type7(values, 0.5), 3);
  assert.equal(type7(values, 0.8), 4.2);
  assert.equal(type7(values, 0.9), 4.6);
  const result = summarizeSamples(input(5), values.map((value, index) => sample(index, value, 42)), options);
  assert.equal(result.finishDay.percentiles.p90, 4.6);
  assert.equal(result.finishDay.histogram.length, 20);
  assert.equal(result.finishDay.histogram.reduce((total, bin) => total + bin.count, 0), 5);
  assert.deepEqual(result.costCents.histogram, [{ from: '42', to: '42', count: 5 }]);
  assert.deepEqual(result.utilization.histogram, []);
  assert.equal(result.utilization.percentiles.p50, null);
  assert.equal(result.utilization.observedCount, 0);
  assert.equal(result.sensitivity.finishDay[0]?.rho, 1);
  assert.equal(result.sensitivity.finishDay[1]?.rho, null);
  assert.ok(Math.abs(spearman([1, 1, 2, 3], [4, 3, 2, 2])! + 8 / 9) < 1e-12);
  assert.equal(spearman([9, 9], [2, 3]), null);
  assert.equal(spearman([], []), null);
});

test('joint outcomes are measured on the same indices and equality meets both targets', () => {
  const result = summarizeSamples(input(4), [sample(0, 5, 110), sample(1, 8, 100), sample(2, 5, 100), sample(3, 8, 110)], options);
  assert.equal(result.success.deadline.probability, 0.5);
  assert.equal(result.success.budget.probability, 0.5);
  assert.equal(result.success.joint.probability, 0.25);
  const empty = summarizeSamples(input(0), [], options);
  assert.equal(empty.success.joint.probability, null);
  assert.equal(empty.success.joint.reason, 'NO_OBSERVATIONS');
  assert.equal(empty.criticity[0]?.frequency, null);
});

test('horizon censoring preserves ranks and bounds unknown cost and success', () => {
  const samples = [sample(0, 3, 80), sample(1, 6, 90), sample(2, 10, 110), sample(3, null, null)];
  const result = summarizeSamples(input(4, { targetDay: 35 }), samples, options);
  assert.equal(result.distributionIncomplete, true);
  assert.equal(result.recommendationsAllowed, false);
  assert.equal(result.censoringRate, 0.25);
  assert.equal(result.censoringCause, 'BEYOND_HORIZON');
  assert.equal(result.finishDay.percentiles.p50, 8);
  assert.equal(result.finishDay.percentiles.p80, null);
  assert.ok(Math.abs(result.finishDay.lowerBounds.p80! - 18) < 1e-12);
  assert.equal(result.finishDay.histogram.reduce((total, bin) => total + bin.count, 0), 3);
  assert.equal(result.costCents.observedCount, 3);
  assert.equal(result.costCents.percentiles.p05, null);
  assert.equal(result.costCents.lowerBounds.p05, null);
  assert.equal(result.milestones[0]?.percentiles.p50, 8);
  assert.ok(Math.abs(result.milestones[0]!.lowerBounds.p80! - 18) < 1e-12);
  assert.equal(result.sensitivity.costCents[0]?.observedCount, 3);
  assert.deepEqual(result.success.deadline.bounds, [0.75, 1]);
  assert.deepEqual(result.success.budget.bounds, [0.5, 0.75]);
  assert.deepEqual(result.success.joint.bounds, [0.5, 0.75]);
  assert.equal(result.success.joint.wilson95, null);

  const knownDeadline = summarizeSamples(input(4, { targetDay: 30 }), samples, options);
  assert.equal(knownDeadline.success.deadline.probability, 0.75);
  assert.ok(knownDeadline.success.deadline.wilson95);
  assert.equal(knownDeadline.success.joint.probability, 0.5);
});

test('STAT-08 pairs using sample index and keeps marginal bins equal', () => {
  const base = [1, 4, 7, 9].map((day, index) => sample(index, day, 100 + index));
  const alternate = base.map((original) => ({ ...original, finishDay: original.finishDay! + 15, costCents: 200 + original.index }));
  const originalInput = input(4);
  const alternateInput = input(4, { scenarioId: 'S1', scenarioHash: 'S1-hash' });
  const comparison = compareSamples(originalInput, base.slice().reverse(), alternateInput, alternate);
  assert.equal(comparison.finishDay.pairedDeltas.percentiles.p50, 15);
  assert.equal(comparison.finishDay.p80Delta, 15);
  assert.equal(comparison.costCents.p80Delta, '100');
  assert.deepEqual(comparison.finishDay.pairedDeltas.histogram, [{ from: 15, to: 15, count: 4 }]);
  assert.equal(comparison.finishDay.histogram.base.length, 20);
  assert.deepEqual(comparison.finishDay.histogram.base.map(({ from, to }) => ({ from, to })),
    comparison.finishDay.histogram.alternative.map(({ from, to }) => ({ from, to })));
  assert.deepEqual(comparison, compareSamples(originalInput, base, alternateInput, alternate.slice().reverse()));
  assert.equal(comparison.success.deadline.deltaPercentagePoints, -50);
  assert.ok(Math.abs(comparison.success.deadline.standardErrorPercentagePoints! - 100 / Math.sqrt(12)) < 1e-12);
  assert.equal(comparison.success.deadline.signRobust, false);
  assert.equal(comparison.success.deadline.unknownPairs, 0);
});

test('paired success and costs with unknown outcomes retain coverage and suppress estimates', () => {
  const base = [sample(0, 1, 100), sample(1, 3, 100)];
  const alternate = [sample(0, null, null), sample(1, 3, 101)];
  const comparison = compareSamples(input(2), base, input(2), alternate);
  assert.equal(comparison.success.budget.deltaPercentagePoints, null);
  assert.equal(comparison.success.budget.unknownPairs, 1);
  assert.equal(comparison.success.deadline.deltaPercentagePoints, -50);
  assert.equal(comparison.costCents.p80Delta, null);
  assert.deepEqual(comparison.costCents.observedCount, { base: 2, alternative: 1 });
  assert.equal(comparison.finishDay.pairedDeltas.percentiles.p50, null);
  assert.equal(comparison.finishDay.pairedDeltas.observedCount, 1);
});

test('paired success identifies a unanimous gain and keeps an unchanged tie separate', () => {
  const base = [sample(0, 8, 100), sample(1, 8, 100)];
  const alternate = [sample(0, 3, 100), sample(1, 3, 100)];
  const comparison = compareSamples(input(2), base, input(2), alternate);
  assert.deepEqual(comparison.success.deadline, {
    deltaPercentagePoints: 100, standardErrorPercentagePoints: 0, signRobust: true, unknownPairs: 0,
  });
  assert.equal(comparison.success.budget.signRobust, false);
});

test('cent strings preserve exact Type 7 rounding and narrow integer histogram membership', () => {
  const large = Number.MAX_SAFE_INTEGER;
  const original = [sample(0, 1, large - 1), sample(1, 1, large)];
  const alternate = [sample(0, 1, large - 2), sample(1, 1, large)];
  const result = summarizeSamples(input(2), original, options);
  assert.equal(result.costCents.percentiles.p05, String(large - 1));
  assert.equal(result.costCents.percentiles.p50, String(large));
  assert.equal(result.costCents.histogram[0]?.count, 1);
  assert.equal(result.costCents.histogram[19]?.count, 1);
  const paired = compareSamples(input(2), original, input(2), alternate);
  assert.equal(paired.costCents.p80Delta, '0');
  assert.equal(paired.costCents.pairedDeltas.percentiles.p50, '-1');
});

test('ordered reduction, compact criticity and malformed batches are explicit', () => {
  const samples = [sample(0, 1, 100), sample(1, 3, 100, { critical: [] })];
  const summary = summarizeSamples(input(2), samples, options);
  assert.equal(summary.criticity[0]?.frequency, 0.5);
  assert.deepEqual(summary, summarizeSamples(input(2), samples.slice().reverse(), options));
  assert.deepEqual(summary, summarizeSamples(input(2), samples.map((value) => ({ ...value, critical: [] })), {
    ...options, criticalCounts: [1],
  }));
  assert.throws(() => summarizeSamples(input(2), samples, { ...options, criticalCounts: [3] }), { code: 'INVALID_SAMPLES' });
  assert.throws(() => summarizeSamples(input(2), [samples[0]!, samples[0]!], options), StatisticsError);
  assert.throws(() => compareSamples(input(2), samples, input(2, { seed: 'other' }), samples), { code: 'INCOMPATIBLE_RUNS' });
});
