import { type7 } from './statistics';

export type SeriesObservation = { month: string; value: number };
export type SeriesOptions = { horizon?: 1 | 2 | 3; min?: number; max?: number };
type Model = 'NAIVE' | 'LINEAR' | 'HOLT';
type Horizon = 1 | 2 | 3;
type InsufficientReason = 'SHORT_HISTORY' | 'IRREGULAR_HISTORY' | 'INVALID_OBSERVATION'
  | 'INSUFFICIENT_BACKTEST' | 'INVALID_EXTRAPOLATION';

export type SeriesForecast = {
  horizon: Horizon;
  month: string;
  model: Model;
  forecast: number;
  backtest: { mae: number; naiveMae: number; errors: number };
  residualBand: { p05: number; p95: number } | null;
  bandStatus: 'AVAILABLE' | 'INSUFFICIENT_HISTORY';
  residualCount: number;
};

export type SeriesDiagnostic = {
  status: 'AVAILABLE' | 'INSUFFICIENT_HISTORY';
  reason: InsufficientReason | null;
  observedCount: number;
  linearSlope: number | null;
  forecasts: SeriesForecast[];
};

type Fit = { level: number; slope: number };
type Candidate = { model: Model; fits: Array<Fit | undefined> };
const MIN_HISTORY = 12;
const HOLT_HISTORY = 24;
const HOLDOUT = 6;
const MIN_BAND_ERRORS = 20;
const MIN_RELATIVE_IMPROVEMENT = 0.05;
const HORIZONS: readonly Horizon[] = [1, 2, 3];
const HOLT_GRID = Array.from({ length: 9 }, (_, index) => (index + 1) / 10);

function monthIndex(value: string): number | undefined {
  const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/.exec(value);
  if (!match) return;
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function monthLabel(month: number): string {
  const year = String(Math.floor(month / 12)).padStart(4, '0');
  return `${year}-${String(month % 12 + 1).padStart(2, '0')}`;
}

function fitLinear(values: readonly number[]): Candidate {
  let mean = values[0]!;
  let cross = 0;
  const fits = values.map((value, index) => {
    if (index === 0) return undefined;
    const count = index + 1;
    mean += (value - mean) / count;
    // Centered covariance over the prefix; its time indices are always 0…index.
    cross += (index + 1) / 2 * (value - mean);
    const slope = cross / (count * (count ** 2 - 1) / 12);
    return { level: mean + slope * index / 2, slope };
  });
  return { model: 'LINEAR', fits };
}

function fitHolt(values: readonly number[]): Candidate {
  const first = { level: values[1]!, slope: values[1]! - values[0]! };
  const grid = HOLT_GRID.flatMap((alpha) => HOLT_GRID.map((beta) => ({ alpha, beta, ...first, error: 0 })));
  const fits = values.map((value, index) => {
    if (index < 2) return undefined;
    let best: typeof grid[number] | undefined;
    for (const trial of grid) {
      const previousLevel = trial.level;
      const predicted = previousLevel + trial.slope;
      trial.error += Math.abs(value - predicted);
      trial.level = trial.alpha * value + (1 - trial.alpha) * predicted;
      trial.slope = trial.beta * (trial.level - previousLevel) + (1 - trial.beta) * trial.slope;
      if (!best || trial.error < best.error) best = trial;
    }
    return { level: best!.level, slope: best!.slope };
  });
  return { model: 'HOLT', fits };
}

function project(fit: Fit, horizon: Horizon): number {
  return fit.level + horizon * fit.slope;
}

function score(candidate: Candidate, horizon: Horizon, values: readonly number[]) {
  const residuals: number[] = [];
  const recent: number[] = [];
  for (let target = horizon; target < values.length; target++) {
    const fit = candidate.fits[target - horizon];
    if (fit === undefined) continue;
    const residual = values[target]! - project(fit, horizon);
    if (!Number.isFinite(residual)) continue;
    residuals.push(residual);
    if (target >= values.length - HOLDOUT) recent.push(residual);
  }
  const mae = recent.reduce((mean, residual, index) => mean + (Math.abs(residual) - mean) / (index + 1), 0);
  return { candidate, residuals, recentCount: recent.length, mae: recent.length === HOLDOUT && Number.isFinite(mae) ? mae : null };
}

function forecastHorizon(candidates: Candidate[], values: readonly number[], lastMonth: number, horizon: Horizon,
  min: number, max: number): SeriesForecast | undefined {
  // Candidate order breaks exact ties in favor of the simpler earlier model.
  const [naive, ...other] = candidates.map((candidate) => score(candidate, horizon, values));
  if (naive?.mae === null || naive?.mae === undefined) return;
  const naiveMae = naive.mae;
  let best = { ...naive, mae: naiveMae };
  for (const candidate of other) {
    if (candidate.mae === null || candidate.mae >= best.mae || candidate.mae > naiveMae * (1 - MIN_RELATIVE_IMPROVEMENT)) continue;
    best = { ...candidate, mae: candidate.mae };
  }

  const forecast = project(best.candidate.fits.at(-1)!, horizon);
  const residualCount = best.residuals.length;
  const sorted = best.residuals.sort((left, right) => left - right);
  const preserveBounds = (value: number) => Math.min(max, Math.max(min, value));
  const residualBand = residualCount >= MIN_BAND_ERRORS ? {
    p05: preserveBounds(forecast + type7(sorted, 0.05)!),
    p95: preserveBounds(forecast + type7(sorted, 0.95)!),
  } : null;
  return {
    horizon, month: monthLabel(lastMonth + horizon), model: best.candidate.model, forecast,
    backtest: { mae: best.mae, naiveMae, errors: best.recentCount },
    residualBand, bandStatus: residualBand ? 'AVAILABLE' : 'INSUFFICIENT_HISTORY', residualCount,
  };
}

export function diagnoseSeries(observations: readonly SeriesObservation[], options: SeriesOptions = {}): SeriesDiagnostic {
  const observedCount = observations.length;
  const insufficient = (reason: InsufficientReason, linearSlope: number | null = null): SeriesDiagnostic => ({
    status: 'INSUFFICIENT_HISTORY', reason, observedCount, linearSlope, forecasts: [],
  });
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;
  if (Number.isNaN(min) || Number.isNaN(max) || min > max
    || observations.some(({ value }) => !Number.isFinite(value) || value < min || value > max)) {
    return insufficient('INVALID_OBSERVATION');
  }

  const months = observations.map(({ month }) => monthIndex(month));
  if (months.some((month, index) => month === undefined || (index > 0 && month !== months[index - 1]! + 1))) {
    return insufficient('IRREGULAR_HISTORY');
  }
  if (observedCount < MIN_HISTORY) return insufficient('SHORT_HISTORY');

  const requestedHorizon = options.horizon ?? 3;
  const lastMonth = months.at(-1)!;
  if (!HORIZONS.includes(requestedHorizon) || lastMonth + requestedHorizon >= 10_000 * 12) {
    return insufficient('INVALID_EXTRAPOLATION');
  }
  const values = observations.map(({ value }) => value);
  const linear = fitLinear(values);
  const fittedSlope = linear.fits.at(-1)!.slope;
  const linearSlope = Number.isFinite(fittedSlope) ? fittedSlope : null;
  const candidates: Candidate[] = [
    { model: 'NAIVE', fits: values.map((level) => ({ level, slope: 0 })) },
    linear,
  ];
  if (observedCount >= HOLT_HISTORY) candidates.push(fitHolt(values));

  const forecasts: SeriesForecast[] = [];
  for (const horizon of HORIZONS.slice(0, requestedHorizon)) {
    const result = forecastHorizon(candidates, values, lastMonth, horizon, min, max);
    if (result === undefined) return insufficient('INSUFFICIENT_BACKTEST', linearSlope);
    if (!Number.isFinite(result.forecast) || result.forecast < min || result.forecast > max
      || (result.residualBand && (!Number.isFinite(result.residualBand.p05) || !Number.isFinite(result.residualBand.p95)))) {
      return insufficient('INVALID_EXTRAPOLATION', linearSlope);
    }
    forecasts.push(result);
  }
  return { status: 'AVAILABLE', reason: null, observedCount, linearSlope, forecasts };
}
