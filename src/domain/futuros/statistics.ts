import type { EngineInput, LogicalSchedule, Sample } from './types';

const HISTOGRAM_BINS = 20;
const NORMAL_95 = 1.95996398454005;
const QUANTILES = { p05: 0.05, p10: 0.1, p50: 0.5, p80: 0.8, p90: 0.9, p95: 0.95 };

type Quantiles<T> = Record<keyof typeof QUANTILES, T | null>;
export type HistogramBin<T> = { from: T; to: T; count: number };
export type Distribution<T> = {
  observedCount: number;
  totalCount: number;
  percentiles: Quantiles<T>;
  lowerBounds: Quantiles<T>;
  histogram: Array<HistogramBin<T>>;
};

type Success = {
  successes: number;
  failures: number;
  unknown: number;
  probability: number | null;
  wilson95: [number, number] | null;
  bounds: [number, number] | null;
  reason: 'CENSORED_OUTCOMES' | 'NO_OBSERVATIONS' | null;
};
type SuccessCases<T> = { deadline: T; budget: T; joint: T };
type Sensitivity = { factor: string; rho: number | null; observedCount: number };

export type StatisticsSummary = {
  sampleCount: number;
  censoredCount: number;
  censoringRate: number | null;
  censoringCause: 'BEYOND_HORIZON' | null;
  distributionIncomplete: boolean;
  recommendationsAllowed: boolean;
  finishDay: Distribution<number>;
  costCents: Distribution<string>;
  waitDays: Distribution<number>;
  utilization: Distribution<number>;
  productivity: Distribution<number>;
  milestones: Array<{ taskId: string } & Distribution<number>>;
  success: SuccessCases<Success>;
  sensitivity: { finishDay: Sensitivity[]; costCents: Sensitivity[] };
  criticity: Array<{ taskId: string; observations: number; frequency: number | null }>;
};

type PairedMetric<T> = {
  p80Delta: T | null;
  pairedDeltas: Distribution<T>;
  histogram: { base: Array<HistogramBin<T>>; alternative: Array<HistogramBin<T>> };
  observedCount: { base: number; alternative: number };
};
type PairedSuccess = {
  deltaPercentagePoints: number | null;
  standardErrorPercentagePoints: number | null;
  signRobust: boolean | null;
  unknownPairs: number;
};
export type PairedComparison = {
  sampleCount: number;
  finishDay: PairedMetric<number>;
  costCents: PairedMetric<string>;
  success: SuccessCases<PairedSuccess>;
};

export class StatisticsError extends Error {
  constructor(readonly code: 'INVALID_SAMPLES' | 'INCOMPATIBLE_RUNS') {
    super(code);
    this.name = 'StatisticsError';
  }
}

const numeric = { value: (value: number) => value, integer: false };
const cents = { value: (value: number) => String(value), integer: true };
type Scale<T> = { value: (value: number) => T; integer: boolean };
type Outcome = boolean | null;
type Range = { min: number; max: number };

function quantilePosition(count: number, probability: number) {
  const index = (count - 1) * probability;
  return { left: Math.floor(index), right: Math.ceil(index), weight: index % 1 };
}

/** Linear interpolation over ascending observations (Hyndman–Fan type 7). */
export function type7(sorted: readonly number[], probability: number): number | null {
  if (sorted.length === 0) return null;
  return interpolate(sorted, sorted.length, probability);
}

function interpolate(sorted: readonly number[], count: number, probability: number): number {
  const { left, right, weight } = quantilePosition(count, probability);
  const low = sorted[left]!;
  const high = sorted[right]!;
  const width = high - low;
  return Number.isFinite(width) ? low + weight * width : (1 - weight) * low + weight * high;
}

function sortedValues(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null).sort((left, right) => left - right);
}

function rangeOf(first: readonly number[], second: readonly number[] = []): Range | undefined {
  if (first.length === 0 && second.length === 0) return;
  return {
    min: Math.min(first[0] ?? Infinity, second[0] ?? Infinity),
    max: Math.max(first.at(-1) ?? -Infinity, second.at(-1) ?? -Infinity),
  };
}

function histogram<T>(values: readonly number[], scale: Scale<T>, range: Range | undefined): Array<HistogramBin<T>> {
  if (range === undefined) return [];
  const { min, max } = range;
  if (max === min) return [{ from: scale.value(min), to: scale.value(max), count: values.length }];

  const width = max - min;
  const binCount = BigInt(HISTOGRAM_BINS);
  const integerWidth = scale.integer ? BigInt(max) - BigInt(min) : 0n;
  const counts = Array<number>(HISTOGRAM_BINS).fill(0);
  for (const value of values) {
    const index = scale.integer
      ? Number((BigInt(value) - BigInt(min)) * binCount / integerWidth)
      : Math.floor((value - min) / width * HISTOGRAM_BINS);
    const bin = Math.min(index, HISTOGRAM_BINS - 1);
    counts[bin] = counts[bin]! + 1;
  }

  // Each bin is [from,to), with the last bin including the maximum. Round a
  // fractional cent boundary up to its equivalent integer membership cutoff.
  const boundary = (index: number) => scale.value(scale.integer
    ? Number(BigInt(min) + (integerWidth * BigInt(index) + binCount - 1n) / binCount)
    : min + width * (index / HISTOGRAM_BINS));
  return counts.map((count, index) => ({ from: boundary(index), to: boundary(index + 1), count }));
}

function centHundredths(sorted: readonly number[], count: number, probability: number): bigint {
  // All published percentiles use integer percentages. Preserve the exact
  // numerator before rounding so a large cost does not lose its fraction.
  const steps = (count - 1) * Math.round(probability * 100);
  const left = BigInt(sorted[Math.floor(steps / 100)]!);
  const right = BigInt(sorted[Math.ceil(steps / 100)]!);
  return left * 100n + BigInt(steps % 100) * (right - left);
}

/** Nearest integer cent with half cents rounded away from zero. */
function roundCentHundredths(value: bigint): number {
  const rounded = value < 0n ? (value - 50n) / 100n : (value + 50n) / 100n;
  return Number(rounded);
}

function readQuantile<T>(values: readonly number[], count: number, probability: number, scale: Scale<T>): T {
  const value = scale.integer
    ? roundCentHundredths(centHundredths(values, count, probability))
    : interpolate(values, count, probability);
  return scale.value(value);
}

function quantiles<T>(read: (probability: number) => T | null): Quantiles<T> {
  return {
    p05: read(QUANTILES.p05), p10: read(QUANTILES.p10), p50: read(QUANTILES.p50),
    p80: read(QUANTILES.p80), p90: read(QUANTILES.p90), p95: read(QUANTILES.p95),
  };
}

function distribution<T>(values: readonly (number | null)[], scale: Scale<T>, options?: {
  missing: 'SUPPRESS' | 'OBSERVED';
  rightCensoredAt?: number;
}): Distribution<T> {
  const known = sortedValues(values);
  const totalCount = values.length;
  const observedCount = known.length;
  const incomplete = observedCount < totalCount;
  const lowerBound = options?.rightCensoredAt;
  const rankValues = lowerBound === undefined || !incomplete
    ? known
    : known.concat(Array<number>(totalCount - observedCount).fill(lowerBound));
  const usesCensoredRank = (probability: number) => quantilePosition(totalCount, probability).right >= observedCount;

  return {
    observedCount,
    totalCount,
    percentiles: quantiles((p) => {
      if (observedCount === 0 || (incomplete && lowerBound !== undefined && usesCensoredRank(p))) return null;
      if (incomplete && lowerBound !== undefined) return readQuantile(rankValues, totalCount, p, scale);
      if (incomplete && options?.missing !== 'OBSERVED') return null;
      return readQuantile(known, observedCount, p, scale);
    }),
    lowerBounds: quantiles((p) => lowerBound !== undefined && incomplete && usesCensoredRank(p)
      ? readQuantile(rankValues, totalCount, p, scale)
      : null),
    histogram: histogram(known, scale, rangeOf(known)),
  };
}

function orderSamples(input: EngineInput, samples: readonly Sample[]): Sample[] {
  const sorted = [...samples].sort((first, second) => first.index - second.index);
  if (sorted.length !== input.sampleCount || sorted.some((sample, index) => sample.index !== index
    || (sample.finishDay !== null && (!Number.isSafeInteger(sample.finishDay) || sample.finishDay > input.horizon))
    || (sample.costCents !== null && (!Number.isSafeInteger(sample.costCents) || sample.costCents < 0)))) {
    throw new StatisticsError('INVALID_SAMPLES');
  }
  return sorted;
}

function outcomes(input: EngineInput, samples: readonly Sample[]): SuccessCases<Outcome[]> {
  const budgetAmount = Number(input.budgetCents);
  const deadline = samples.map(({ finishDay }) => finishDay === null
    ? (input.targetDay <= input.horizon ? false : null)
    : finishDay <= input.targetDay);
  const budget = samples.map(({ costCents }) => costCents === null ? null : costCents <= budgetAmount);
  const joint = deadline.map((onTime, index) => {
    const onBudget = budget[index]!;
    if (onTime === false || onBudget === false) return false;
    if (onTime === null || onBudget === null) return null;
    return true;
  });
  return { deadline, budget, joint };
}

export function wilson95(successes: number, count: number): [number, number] | null {
  if (count === 0) return null;
  const estimate = successes / count;
  const zSquared = NORMAL_95 ** 2;
  const denominator = 1 + zSquared / count;
  const center = (estimate + zSquared / (2 * count)) / denominator;
  const radius = NORMAL_95 * Math.sqrt(estimate * (1 - estimate) / count + zSquared / (4 * count ** 2)) / denominator;
  return [successes === 0 ? 0 : Math.max(0, center - radius), successes === count ? 1 : Math.min(1, center + radius)];
}

function summarizeSuccess(values: readonly Outcome[]): Success {
  let successes = 0;
  let failures = 0;
  for (const value of values) {
    if (value === true) successes++;
    if (value === false) failures++;
  }
  const count = values.length;
  const unknown = count - successes - failures;
  const known = count > 0 && unknown === 0;
  return {
    successes, failures, unknown,
    probability: known ? successes / count : null,
    wilson95: known ? wilson95(successes, count) : null,
    bounds: unknown > 0 ? [successes / count, (successes + unknown) / count] : null,
    reason: unknown > 0 ? 'CENSORED_OUTCOMES' : count === 0 ? 'NO_OBSERVATIONS' : null,
  };
}

function ranks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((first, second) => first.value - second.value);
  const result = Array<number>(values.length);
  for (let start = 0; start < order.length;) {
    let end = start + 1;
    while (end < order.length && order[end]!.value === order[start]!.value) end++;
    const average = (start + end + 1) / 2;
    for (let index = start; index < end; index++) result[order[index]!.index] = average;
    start = end;
  }
  return result;
}

export function spearman(x: readonly number[], y: readonly number[]): number | null {
  if (x.length !== y.length || x.length < 2) return null;
  const xRanks = ranks(x);
  const yRanks = ranks(y);
  const mean = (x.length + 1) / 2;
  let covariance = 0;
  let xVariance = 0;
  let yVariance = 0;
  for (let index = 0; index < x.length; index++) {
    const dx = xRanks[index]! - mean;
    const dy = yRanks[index]! - mean;
    covariance += dx * dy;
    xVariance += dx * dx;
    yVariance += dy * dy;
  }
  return xVariance === 0 || yVariance === 0 ? null : covariance / Math.sqrt(xVariance * yVariance);
}

function sensitivity(samples: readonly Sample[], factorNames: readonly string[], output: 'finishDay' | 'costCents'): Sensitivity[] {
  const complete = samples.filter((sample) => sample[output] !== null);
  const observedCount = complete.length;
  const observedOutputs = complete.map((sample) => sample[output]!);
  return factorNames.slice(0, 10).map((factor, index) => ({
    factor, observedCount, rho: spearman(complete.map((sample) => sample.factors[index]!), observedOutputs),
  })).sort((first, second) => (second.rho === null ? -1 : Math.abs(second.rho))
    - (first.rho === null ? -1 : Math.abs(first.rho)));
}

function criticalOccurrences(taskCount: number, samples: readonly Sample[]): number[] {
  const counts = Array<number>(taskCount).fill(0);
  for (const { critical } of samples) {
    let previous = -1;
    for (const index of critical) {
      if (!Number.isInteger(index) || index <= previous || index >= taskCount) {
        throw new StatisticsError('INVALID_SAMPLES');
      }
      counts[index] = counts[index]! + 1;
      previous = index;
    }
  }
  return counts;
}

export function summarizeSamples(input: EngineInput, samples: Sample[], options: {
  factorNames: string[];
  milestoneIds: string[];
  logical: LogicalSchedule;
  criticalCounts?: number[];
}): StatisticsSummary {
  const ordered = orderSamples(input, samples);
  if (options.logical.tasks.length !== input.tasks.length || options.logical.tasks.some((task, index) => task.id !== input.tasks[index]!.id)
    || ordered.some((sample) => sample.factors.length !== options.factorNames.length
    || sample.factors.some((factor) => !Number.isFinite(factor))
    || sample.milestoneDays.length !== options.milestoneIds.length
    || sample.milestoneDays.some((day) => day !== null && (!Number.isSafeInteger(day) || day > input.horizon))
    || !Number.isFinite(sample.waits) || sample.waits < 0
    || (sample.utilization !== null && (!Number.isFinite(sample.utilization) || sample.utilization < 0 || sample.utilization > 1))
    || (sample.productivity !== null && (!Number.isFinite(sample.productivity) || sample.productivity <= 0)))) {
    throw new StatisticsError('INVALID_SAMPLES');
  }
  const sampleCount = ordered.length;
  const criticalCounts = options.criticalCounts ?? criticalOccurrences(input.tasks.length, ordered);
  if (criticalCounts.length !== input.tasks.length
    || criticalCounts.some((count) => !Number.isInteger(count) || count < 0 || count > sampleCount)) {
    throw new StatisticsError('INVALID_SAMPLES');
  }
  const successValues = outcomes(input, ordered);
  const success = {
    deadline: summarizeSuccess(successValues.deadline),
    budget: summarizeSuccess(successValues.budget),
    joint: summarizeSuccess(successValues.joint),
  };
  const timed = { missing: 'SUPPRESS' as const, rightCensoredAt: input.horizon };
  const finishDay = distribution(ordered.map((sample) => sample.finishDay), numeric, timed);
  const costCents = distribution(ordered.map((sample) => sample.costCents), cents);
  const censoredCount = sampleCount - finishDay.observedCount;
  const censoringRate = sampleCount > 0 ? censoredCount / sampleCount : null;
  const distributionIncomplete = censoringRate !== null && censoringRate > 0.01;
  return {
    sampleCount, censoredCount, censoringRate, distributionIncomplete,
    censoringCause: censoredCount > 0 ? 'BEYOND_HORIZON' : null,
    recommendationsAllowed: !distributionIncomplete && success.joint.probability !== null
      && finishDay.percentiles.p80 !== null && costCents.percentiles.p80 !== null,
    finishDay, costCents, success,
    waitDays: distribution(ordered.map((sample) => sample.finishDay === null ? null : sample.waits), numeric),
    utilization: distribution(ordered.map((sample) => sample.utilization), numeric, { missing: 'OBSERVED' }),
    productivity: distribution(ordered.map((sample) => sample.productivity), numeric, { missing: 'OBSERVED' }),
    milestones: options.milestoneIds.map((taskId, index) => ({
      taskId, ...distribution(ordered.map((sample) => sample.milestoneDays[index]!), numeric, timed),
    })),
    sensitivity: {
      finishDay: sensitivity(ordered, options.factorNames, 'finishDay'),
      costCents: sensitivity(ordered, options.factorNames, 'costCents'),
    },
    criticity: input.tasks.map((task, index) => ({
      taskId: task.id,
      observations: sampleCount,
      frequency: sampleCount > 0 ? criticalCounts[index]! / sampleCount : null,
    })),
  };
}

function pairedMetric<T>(base: readonly (number | null)[], alternative: readonly (number | null)[],
  scale: Scale<T>, rightCensoredAt?: number): PairedMetric<T> {
  const baseValues = sortedValues(base);
  const altValues = sortedValues(alternative);
  const range = rangeOf(baseValues, altValues);
  const count = base.length;
  const probability = QUANTILES.p80;
  const requiredCount = rightCensoredAt === undefined ? count : quantilePosition(count, probability).right + 1;
  let p80Delta: T | null = null;
  if (count > 0 && baseValues.length >= requiredCount && altValues.length >= requiredCount) {
    const delta = scale.integer
      ? roundCentHundredths(centHundredths(altValues, count, probability) - centHundredths(baseValues, count, probability))
      : interpolate(altValues, count, probability) - interpolate(baseValues, count, probability);
    p80Delta = scale.value(delta);
  }
  const differences = base.map((value, index) => {
    const alternateValue = alternative[index]!;
    return value === null || alternateValue === null ? null : alternateValue - value;
  });
  return {
    p80Delta,
    pairedDeltas: distribution(differences, scale),
    histogram: {
      base: histogram(baseValues, scale, range), alternative: histogram(altValues, scale, range),
    },
    observedCount: { base: baseValues.length, alternative: altValues.length },
  };
}

function pairedSuccess(base: readonly Outcome[], alternative: readonly Outcome[]): PairedSuccess {
  const differences: number[] = [];
  for (const [index, original] of base.entries()) {
    const changed = alternative[index]!;
    if (original !== null && changed !== null) differences.push(Number(changed) - Number(original));
  }
  const unknownPairs = base.length - differences.length;
  if (unknownPairs > 0 || !differences.length) {
    return { deltaPercentagePoints: null, standardErrorPercentagePoints: null, signRobust: null, unknownPairs };
  }
  const mean = differences.reduce((sum, delta) => sum + delta, 0) / differences.length;
  const squaredResiduals = differences.reduce((sum, delta) => sum + (delta - mean) ** 2, 0);
  const standardError = differences.length > 1
    ? Math.sqrt(squaredResiduals / (differences.length - 1) / differences.length)
    : null;
  return {
    deltaPercentagePoints: mean * 100,
    standardErrorPercentagePoints: standardError === null ? null : standardError * 100,
    signRobust: standardError === null ? null : Math.abs(mean) > NORMAL_95 * standardError,
    unknownPairs,
  };
}

export function compareSamples(baseInput: EngineInput, base: Sample[], altInput: EngineInput, alt: Sample[]): PairedComparison {
  if (baseInput.snapshotId !== altInput.snapshotId || baseInput.snapshotHash !== altInput.snapshotHash
    || baseInput.asOf !== altInput.asOf || baseInput.calendar !== altInput.calendar || baseInput.currency !== altInput.currency
    || baseInput.seed !== altInput.seed || baseInput.sampleCount !== altInput.sampleCount || baseInput.horizon !== altInput.horizon
    || baseInput.targetDay !== altInput.targetDay || baseInput.budgetCents !== altInput.budgetCents) {
    throw new StatisticsError('INCOMPATIBLE_RUNS');
  }
  const original = orderSamples(baseInput, base);
  const changed = orderSamples(altInput, alt);
  const originalSuccess = outcomes(baseInput, original);
  const changedSuccess = outcomes(altInput, changed);
  return {
    sampleCount: original.length,
    finishDay: pairedMetric(original.map((sample) => sample.finishDay), changed.map((sample) => sample.finishDay), numeric, baseInput.horizon),
    costCents: pairedMetric(original.map((sample) => sample.costCents), changed.map((sample) => sample.costCents), cents),
    success: {
      deadline: pairedSuccess(originalSuccess.deadline, changedSuccess.deadline),
      budget: pairedSuccess(originalSuccess.budget, changedSuccess.budget),
      joint: pairedSuccess(originalSuccess.joint, changedSuccess.joint),
    },
  };
}
