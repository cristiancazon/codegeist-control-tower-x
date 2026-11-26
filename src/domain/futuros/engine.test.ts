import assert from 'node:assert/strict';
import { createHmac, createSecretKey } from 'node:crypto';
import { test } from 'node:test';
import { EngineValidationError, indexedUniform, prepareEngine } from './engine';
import { prepareIntegerPert, preparePert } from './pert';
import { FUTUROS_RNG, type EngineInput, type Pert, type Task } from './types';

const seed = '57f6286e7a6048ada8d6cf468c3b2e18';
const digest = '0'.repeat(64);
const fixed = (value: number): Pert => [value, value, value];
const task = (id: string, duration: number | Pert, options: Partial<Task> = {}): Task => ({
  id, code: id, duration: typeof duration === 'number' ? fixed(duration) : duration,
  releaseDay: 0, priority: 0, requirements: [], milestone: false, ...options,
});
const edge = (predecessorId: string, successorId: string, lagDays = 0) => ({ predecessorId, successorId, lagDays });

function input(tasks: Task[], extra: Partial<EngineInput> = {}): EngineInput {
  return {
    snapshotId: 'snapshot', snapshotHash: digest, scenarioId: 'S0', scenarioHash: digest,
    seed, sampleCount: 10_000, asOf: '2026-11-24', calendar: 'CONTINUOUS', currency: 'USD',
    horizon: 730, targetDay: 30, budgetCents: '9000000000', tasks, dependencies: [], resources: [], gates: [], risks: [],
    costs: { actualCents: '0', remainingCents: '0', indirectCentsPerDay: '0', standby: [] }, ...extra,
  };
}

test('STAT-01: CPM includes every finish-to-start predecessor and applies backward slack', () => {
  const engine = prepareEngine(input([task('A', 2), task('B', 3), task('C', 4), task('D', 1)], {
    dependencies: [edge('A', 'B'), edge('A', 'C'), edge('B', 'D'), edge('C', 'D')],
  }));
  assert.deepEqual(engine.logical, {
    finishDay: 7,
    tasks: [
      { id: 'A', startDay: 0, finishDay: 2, slackDays: 0 },
      { id: 'B', startDay: 2, finishDay: 5, slackDays: 1 },
      { id: 'C', startDay: 2, finishDay: 6, slackDays: 0 },
      { id: 'D', startDay: 6, finishDay: 7, slackDays: 0 },
    ],
  });
  assert.deepEqual(engine.sample(0).critical, [0, 2, 3]);
  assert.equal(engine.sample(0).finishDay, 7);
});

test('STAT-02/04: beta-PERT CDF, moments and independent draws match analytical oracles', () => {
  const key = createSecretKey(Buffer.from(seed, 'hex'));
  const beta = preparePert([2, 5, 8]);
  const asymmetry = preparePert([2, 4, 8]);
  const points = [3.5, 5, 6.5];
  const expected = [0.103515625, 0.5, 0.896484375];
  for (const [index, x] of points.entries()) assert.ok(Math.abs(beta.cdf(x) - expected[index]!) < 1e-11);

  const size = 10_000;
  let total = 0;
  let squared = 0;
  let asymmetricTotal = 0;
  let sumTotal = 0;
  let sumSquared = 0;
  const counts = [0, 0, 0];
  for (let index = 0; index < size; index += 1) {
    const uniform = indexedUniform(key, index, 'test:A');
    const first = beta.quantile(uniform);
    const second = beta.quantile(indexedUniform(key, index, 'test:B'));
    const shifted = asymmetry.quantile(uniform);
    assert.ok(shifted >= 2 && shifted <= 8);
    total += first;
    squared += first * first;
    asymmetricTotal += shifted;
    const sum = first + second;
    sumTotal += sum;
    sumSquared += sum * sum;
    for (const [i, point] of points.entries()) counts[i] = counts[i]! + Number(first <= point);
  }
  const mean = total / size;
  const variance = squared / size - mean * mean;
  const sumMean = sumTotal / size;
  const sumVariance = sumSquared / size - sumMean * sumMean;
  assert.ok(Math.abs(mean - 5) <= 0.07);
  assert.ok(Math.abs(variance / (9 / 7) - 1) <= 0.1);
  assert.ok(Math.abs(asymmetricTotal / size - 13 / 3) <= 0.07);
  assert.ok(Math.abs(sumMean - 10) <= 5 * Math.sqrt((18 / 7) / size));
  assert.ok(Math.abs(sumVariance / (18 / 7) - 1) <= 0.12);
  for (const [index, count] of counts.entries()) assert.ok(Math.abs(count / size - expected[index]!) <= 0.02);
});

test('STAT-03/07: fixed durations, indexed HMAC, and civil days are reproducible', () => {
  const key = createSecretKey(Buffer.from(seed, 'hex'));
  const digest = createHmac('sha256', key).update(JSON.stringify([FUTUROS_RNG, 3, 'alpha', 2])).digest();
  const bits = Number(digest.readBigUInt64BE(0) >> 11n);
  assert.equal(indexedUniform(key, 3, 'alpha', 2), Math.min((bits + 1) / 2 ** 53, 1 - 2 ** -53));
  assert.notEqual(indexedUniform(key, 3, 'alpha', 2), indexedUniform(key, 3, 'alpha', 3));

  const prepared = prepareEngine(input([task('A', 4)], {
    costs: { actualCents: '100', remainingCents: '29', indirectCentsPerDay: '1', standby: [] },
  }));
  assert.equal(prepared.sample(0).finishDay, 4);
  assert.equal(prepared.sample(0).costCents, 133);
  assert.deepEqual(prepared.sample(0), { ...prepared.sample(1), index: 0 });

  const calendar = prepareEngine(input([task('A', 2, { releaseDay: 3 })]));
  const finish = new Date(Date.UTC(2026, 10, 24 + calendar.logical.finishDay)).toISOString().slice(0, 10);
  assert.equal(finish, '2026-11-29');
});

test('integer beta-PERT draws agree with inverse CDF followed by productivity rounding', () => {
  const key = createSecretKey(Buffer.from(seed, 'hex'));
  for (const [range, productivity] of [[[2, 4, 8], 1], [[0, 2, 7], 1.7], [[3.2, 4.1, 5.3], 0.9]] as const) {
    const distribution = preparePert(range);
    const integer = prepareIntegerPert(range, productivity);
    for (let index = 0; index < 300; index += 1) {
      const uniform = indexedUniform(key, index, 'threshold-test');
      assert.equal(integer.draw(uniform), Math.ceil(distribution.quantile(uniform) / productivity));
    }
  }
});

test('STAT-05/08: a shared Bernoulli risk charges once and a paired delay shifts the direct path', () => {
  const schedule = input([task('gate', 2), task('one', 2), task('two', 1)], {
    dependencies: [edge('gate', 'one'), edge('gate', 'two')],
    gates: [{ id: 'A-17', taskId: 'gate', delivery: [2, 4, 7], delayDays: 0 }],
    risks: [
      { id: 'shared', probability: 0.5, gateId: 'A-17', delayDays: 4, costCents: '30' },
      { id: 'never', probability: 0, gateId: 'A-17', delayDays: 80, costCents: '1000' },
      { id: 'always', probability: 1, delayDays: 0, costCents: '5' },
    ],
  });
  const base = prepareEngine(schedule);
  const late = prepareEngine({
    ...schedule, scenarioId: 'S1', scenarioHash: '1'.repeat(64),
    gates: [{ ...schedule.gates[0]!, delayDays: 15 }],
  });
  assert.deepEqual(base.factorNames, late.factorNames);
  let events = 0;
  for (let index = 0; index < 10_000; index += 1) {
    const baseline = base.sample(index);
    const delayed = late.sample(index);
    assert.equal(delayed.finishDay! - baseline.finishDay!, 15);
    assert.equal(baseline.costCents, delayed.costCents);
    assert.ok(baseline.costCents === 5 || baseline.costCents === 35);
    events += Number(baseline.costCents === 35);
  }
  assert.ok(events / 10_000 >= 0.475 && events / 10_000 <= 0.525);
  assert.deepEqual(base.sample(57), base.sample(57));
});

test('STAT-06: validation fails closed before preparing an incompatible workload', () => {
  const tasks = [task('A', 2), task('B', 1)];
  const cases: Array<[string, EngineInput]> = [
    ['dependencies', input(tasks, { dependencies: [edge('A', 'B'), edge('B', 'A')] })],
    ['dependencies', input(tasks, { dependencies: [edge('A', 'missing')] })],
    ['dependencies', input(tasks, { dependencies: [edge('A', 'B', -1)] })],
    ['dependencies', input(tasks, { dependencies: [edge('A', 'B'), edge('A', 'B')] })],
    ['task:A:duration', input([task('A', [-1, 2, 3])])],
    ['task:A:duration', input([task('A', [1, 4, 3])])],
    ['calendar', input(tasks, { calendar: 'WORKING_DAYS' as EngineInput['calendar'] })],
    ['currency', input(tasks, { currency: 'ARS' as EngineInput['currency'] })],
    ['risk:bad', input(tasks, { risks: [{ id: 'bad', probability: 1.01, delayDays: 0, costCents: '0' }] })],
    ['costs', input(tasks, { costs: { actualCents: '9007199254740991', remainingCents: '1', indirectCentsPerDay: '0', standby: [] } })],
  ];
  for (const [field, workload] of cases) {
    assert.throws(() => prepareEngine(workload), { name: 'EngineValidationError', code: 'INVALID_SCENARIO', field });
  }
});

test('fixes observed negative times in logical CPM and keeps prepared inputs immutable', () => {
  const workload = input([
    task('past', 1, { releaseDay: -5, actual: { startDay: -5, finishDay: -4 } }),
    task('pending', 2, { releaseDay: -1 }),
  ], { dependencies: [edge('past', 'pending')] });
  const prepared = prepareEngine(workload);
  assert.deepEqual(prepared.logical.tasks.map(({ startDay, finishDay }) => [startDay, finishDay]), [[-5, -4], [0, 2]]);
  const before = prepared.sample(3);
  workload.tasks[1]!.duration = fixed(100);
  workload.seed = '1'.repeat(32);
  assert.deepEqual(prepared.sample(3), before);
  assert.throws(() => prepared.sample(-1), EngineValidationError);
  assert.throws(() => prepared.sample(workload.sampleCount), EngineValidationError);
});

test('resources respect half-open windows, deterministic priority, capacity and unavailable horizon', () => {
  const resource = { id: 'R1', kind: 'ASSET' as const, windows: [
    { fromDay: 0, untilDay: 2, capacity: 1 }, { fromDay: 2, untilDay: 8, capacity: 1 },
  ] };
  const requirement = [{ resourceId: resource.id, quantity: 1 }];
  const workload = input([
    task('A', 3, { requirements: requirement }),
    task('B', 3, { priority: 1, requirements: requirement }),
    task('MA', 0, { milestone: true }),
    task('MB', 0, { milestone: true }),
    task('M0', 0, { milestone: true, releaseDay: 1 }),
  ], { resources: [resource], dependencies: [edge('A', 'MA'), edge('B', 'MB')] });
  const engine = prepareEngine(workload);
  assert.deepEqual(engine.milestoneIds, ['M0', 'MA', 'MB']);
  assert.deepEqual(engine.sample(0).milestoneDays, [1, 6, 3]);
  assert.equal(engine.sample(0).utilization, 1);
  assert.equal(engine.logical.finishDay, 3);

  const censored = prepareEngine({ ...workload, horizon: 4 }).sample(0);
  assert.equal(censored.finishDay, null);
  assert.equal(censored.costCents, null);
  assert.deepEqual(censored.milestoneDays, [1, null, 3]);
  assert.throws(() => prepareEngine({ ...workload, resources: [
    { ...resource, windows: [{ fromDay: 0, untilDay: 2, capacity: 1 }, { fromDay: 3, untilDay: 5, capacity: 1 }] },
  ] }), { code: 'RESOURCE_INFEASIBLE', field: 'task:A' });
});

test('overlapping standby estimates charge an idle resource once, and exclude reserved work', () => {
  const requirement = [{ resourceId: 'R1', quantity: 1 }];
  const engine = prepareEngine(input([
    task('A', 2, { requirements: requirement, releaseDay: 5 }),
    task('B', 2, { requirements: requirement, releaseDay: 5 }),
  ], {
    resources: [{ id: 'R1', kind: 'ASSET', windows: [{ fromDay: 0, untilDay: 12, capacity: 1 }] }],
    costs: {
      actualCents: '0', remainingCents: '0', indirectCentsPerDay: '0',
      standby: ['A', 'B'].map((taskId) => ({ taskId, resourceId: 'R1', rateCentsPerDay: '100', mobilizedDay: 0, quantity: 1 })),
    },
  }));
  const sample = engine.sample(0);
  assert.equal(sample.finishDay, 9);
  assert.equal(sample.costCents, 500);
});

test('STAT-11: A-17 modal oracle and paired samples propagate one delivery change', () => {
  const tasks = [
    task('WP-047', 1, { releaseDay: -13, actual: { startDay: -13, finishDay: -12 } }),
    task('WP-048', [2, 4, 7]),
    task('WP-064', [9, 10, 11], {
      priority: 100,
      requirements: [{ resourceId: 'EQ-017', quantity: 1 }, { resourceId: 'CR-09', quantity: 8 }],
    }),
    task('WP-083', [7, 8, 9], { priority: 100 }),
    task('WP-119', 0, { milestone: true, releaseDay: 26 }),
    task('WP-120', 0, { milestone: true }),
  ];
  const base = input(tasks, {
    dependencies: [
      edge('WP-047', 'WP-048'), edge('WP-048', 'WP-064'), edge('WP-064', 'WP-083'),
      edge('WP-083', 'WP-120'), edge('WP-119', 'WP-120'),
    ],
    resources: [
      { id: 'EQ-017', kind: 'ASSET', windows: [{ fromDay: 6, untilDay: 731, capacity: 1 }] },
      { id: 'CR-09', kind: 'CREW', windows: [{ fromDay: 6, untilDay: 731, capacity: 8 }] },
    ],
    costs: { actualCents: '3000000000', remainingCents: '1600000000', indirectCentsPerDay: '250000',
      standby: [
        { taskId: 'WP-064', resourceId: 'EQ-017', mobilizedDay: 6, rateCentsPerDay: '300000', quantity: 1 },
        { taskId: 'WP-064', resourceId: 'CR-09', mobilizedDay: 6, rateCentsPerDay: '600000', quantity: 1 },
      ] },
    budgetCents: '4619500000',
  });
  const receipt = { id: 'A-17', taskId: 'WP-048', delivery: [2, 4, 7] as const, delayDays: 0 };
  const s0 = prepareEngine({ ...base, gates: [receipt] });
  const s1 = prepareEngine({ ...base, scenarioId: 'S1', scenarioHash: '1'.repeat(64), gates: [{ ...receipt, delayDays: 15 }] });
  const s2 = prepareEngine({ ...base, scenarioId: 'S2', scenarioHash: '2'.repeat(64), gates: [
    { ...receipt, delayDays: 15, alternative: { offsetDays: 5, commitmentCents: '6000000' } },
  ] });
  const modal = [s0, s1, s2].map((engine) => engine.sample(0, true));
  assert.deepEqual(modal.map(({ finishDay, waits }) => [finishDay, waits]), [[26, 0], [37, 13], [27, 3]]);
  assert.deepEqual(modal.map(({ costCents }) => costCents! - modal[0]!.costCents!), [0, 14_450_000, 8_950_000]);
  assert.deepEqual(s0.factorNames, s1.factorNames);
  assert.deepEqual(s1.factorNames, s2.factorNames);

  for (let index = 0; index < 100; index += 1) {
    const baseline = s0.sample(index);
    const delayed = s1.sample(index);
    const alternate = s2.sample(index);
    assert.equal(delayed.factors[0]! - baseline.factors[0]!, 15);
    assert.equal(alternate.factors[0]! - baseline.factors[0]!, 5);
    assert.ok(baseline.finishDay! <= 30 && delayed.finishDay! > 30);
    assert.ok(alternate.finishDay! < delayed.finishDay! && alternate.costCents! > baseline.costCents!);
  }

  const committedButUnused = prepareEngine({ ...base, gates: [
    { ...receipt, alternative: { offsetDays: 5, commitmentCents: '6000000' } },
  ] });
  assert.equal(committedButUnused.sample(0, true).finishDay, modal[0]!.finishDay);
  assert.equal(committedButUnused.sample(0, true).costCents! - modal[0]!.costCents!, 6_000_000);
});
