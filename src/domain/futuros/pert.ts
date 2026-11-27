import { requireModel } from './engine-error';
import type { Pert } from './types';

const cdfTolerance = 1e-12;

// Shift before evaluating the Stirling series (DLMF 5.11.1).
function logGamma(argument: number): number {
  let x = argument;
  let recurrence = 0;
  while (x < 12) {
    recurrence -= Math.log(x);
    x += 1;
  }
  const inverse = 1 / x;
  const square = inverse * inverse;
  const correction = inverse * (1 / 12 + square * (-1 / 360 + square * (1 / 1260
    + square * (-1 / 1680 + square * (1 / 1188 - square * 691 / 360360)))));
  return recurrence + (x - 0.5) * Math.log(x) - x + Math.log(2 * Math.PI) / 2 + correction;
}

// DLMF 8.17.22 continued fraction, evaluated by modified Lentz iteration.
function betaFraction(alpha: number, beta: number, x: number): number {
  const epsilon = 3e-14;
  const safe = (value: number) => Math.abs(value) < 1e-30 ? (value < 0 ? -1e-30 : 1e-30) : value;
  let value = 1;
  let numerator = 1;
  let denominator = 0;
  for (let n = 1; n <= 300; n += 1) {
    const m = Math.floor(n / 2);
    const coefficient = n % 2 === 0
      ? m * (beta - m) * x / ((alpha + 2 * m - 1) * (alpha + 2 * m))
      : -(alpha + m) * (alpha + beta + m) * x / ((alpha + 2 * m) * (alpha + 2 * m + 1));
    numerator = safe(1 + coefficient / numerator);
    denominator = 1 / safe(1 + coefficient * denominator);
    const correction = numerator * denominator;
    value *= correction;
    // Every even numerator after m=beta vanishes when beta is integral.
    if (n > 1 && Math.abs(correction - 1) <= epsilon) return 1 / value;
  }
  requireModel(false, 'duration', 'No convergió la distribución beta-PERT.', 'MODEL_UNAVAILABLE');
}

export function preparePert(range: Pert) {
  const [min, mode, max] = range;
  const width = max - min;
  if (width === 0) return { cdf: (value: number) => Number(value >= min), quantile: () => min };

  const alpha = 1 + 4 * (mode - min) / width;
  const beta = 1 + 4 * (max - mode) / width;
  const logBeta = logGamma(alpha) + logGamma(beta) - logGamma(alpha + beta);

  function cdf(value: number): number {
    if (value <= min) return 0;
    if (value >= max) return 1;
    const x = (value - min) / width;
    const coefficient = Math.exp(alpha * Math.log(x) + beta * Math.log1p(-x) - logBeta);
    const probability = x < (alpha + 1) / (alpha + beta + 2)
      ? coefficient * betaFraction(alpha, beta, x) / alpha
      : 1 - coefficient * betaFraction(beta, alpha, 1 - x) / beta;
    requireModel(Number.isFinite(probability) && probability >= -cdfTolerance && probability <= 1 + cdfTolerance,
      'duration', 'La distribución beta-PERT devolvió una probabilidad inválida.', 'MODEL_UNAVAILABLE');
    return Math.min(1, Math.max(0, probability));
  }

  function quantile(probability: number): number {
    if (probability <= 0) return min;
    if (probability >= 1) return max;
    let lower = min;
    let upper = max;
    for (let step = 0; step < 64; step += 1) {
      const midpoint = (lower + upper) / 2;
      if (cdf(midpoint) < probability) lower = midpoint;
      else upper = midpoint;
    }
    return (lower + upper) / 2;
  }
  return { cdf, quantile };
}

export function prepareIntegerPert(range: Pert, productivity = 1) {
  const [min, mode, max] = range;
  const modal = Math.ceil(mode / productivity);
  if (min === max) return { modal, minimum: modal, constant: true, draw: () => modal };

  // Exact CDF for ceil(D / productivity). A non-degenerate PERT has no mass at its lower endpoint.
  const maximum = Math.ceil(max / productivity);
  const minimum = Math.min(Math.floor(min / productivity) + 1, maximum);
  const thresholds = new Float64Array(maximum - minimum + 1);
  const { cdf } = preparePert(range);
  let previous = 0;
  for (let index = 0; index < thresholds.length; index += 1) {
    const probability = index === thresholds.length - 1 ? 1 : cdf((minimum + index) * productivity);
    requireModel(probability + cdfTolerance >= previous, 'duration', 'La CDF beta-PERT perdió monotonía.', 'MODEL_UNAVAILABLE');
    previous = Math.max(previous, probability);
    thresholds[index] = previous;
  }
  const draw = (probability: number) => {
    let lower = 0;
    let upper = thresholds.length - 1;
    while (lower < upper) {
      const middle = (lower + upper) >>> 1;
      if (thresholds[middle]! < probability) lower = middle + 1;
      else upper = middle;
    }
    return minimum + lower;
  };
  return { modal, minimum, constant: false, draw };
}
