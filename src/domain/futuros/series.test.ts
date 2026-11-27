import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseSeries } from './series';

function months(count: number, observe: (index: number) => number) {
  return Array.from({ length: count }, (_, index) => ({
    month: `${2024 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`,
    value: observe(index),
  }));
}

test('STAT-10 rolling-origin regression predicts a noiseless trend through three months', () => {
  const result = diagnoseSeries(months(24, (index) => 5 + 2 * index));
  assert.equal(result.status, 'AVAILABLE');
  assert.ok(Math.abs(result.linearSlope! - 2) < 1e-8);
  assert.equal(result.forecasts.length, 3);
  for (const forecast of result.forecasts) {
    assert.equal(forecast.model, 'LINEAR');
    assert.equal(forecast.month, `2026-0${forecast.horizon}`);
    assert.ok(Math.abs(forecast.forecast - (51 + 2 * forecast.horizon)) < 1e-8);
    assert.equal(forecast.backtest.errors, 6);
    assert.ok(forecast.backtest.mae < 1e-8);
    assert.equal(forecast.backtest.naiveMae, 2 * forecast.horizon);
    assert.ok(forecast.residualCount >= 20);
    assert.deepEqual(forecast.residualBand, { p05: forecast.forecast, p95: forecast.forecast });
  }
});

test('STAT-10 missing or too few months never produce a fabricated projection', () => {
  const series = months(12, (index) => index);
  const gapped = diagnoseSeries(series.filter((_, index) => index !== 6));
  assert.equal(gapped.status, 'INSUFFICIENT_HISTORY');
  assert.equal(gapped.reason, 'IRREGULAR_HISTORY');
  assert.deepEqual(gapped.forecasts, []);
  assert.equal(diagnoseSeries(series.slice(0, 11)).reason, 'SHORT_HISTORY');
  assert.equal(diagnoseSeries(series.slice().reverse()).reason, 'IRREGULAR_HISTORY');
});

test('exact ties use naive and small histories retain MAE without residual bands', () => {
  const result = diagnoseSeries(months(12, () => 7).map(({ month, value }) => ({ month: `${month}-01`, value })), { horizon: 2 });
  assert.equal(result.status, 'AVAILABLE');
  assert.deepEqual(result.forecasts.map((value) => value.horizon), [1, 2]);
  for (const forecast of result.forecasts) {
    assert.equal(forecast.model, 'NAIVE');
    assert.equal(forecast.forecast, 7);
    assert.equal(forecast.backtest.mae, 0);
    assert.equal(forecast.residualBand, null);
    assert.equal(forecast.bandStatus, 'INSUFFICIENT_HISTORY');
  }
});

test('Holt can win a shifting trend after 24 observations with fresh fits at each origin', () => {
  const shift = (index: number) => 5 + Math.max(0, index - 16) * 4;
  const result = diagnoseSeries(months(32, shift));
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.forecasts[0]?.model, 'HOLT');
  assert.ok(result.forecasts[0]!.backtest.mae < 0.01);
  assert.ok(Math.abs(result.forecasts[0]!.forecast - shift(32)) < 0.01);
  assert.equal(diagnoseSeries(months(23, shift)).forecasts.some(({ model }) => model === 'HOLT'), false);
});

test('physical limits reject bad observations or extrapolations and bound descriptive bands', () => {
  const linear = months(12, (index) => 5 + 2 * index);
  assert.equal(diagnoseSeries(linear, { max: 25 }).reason, 'INVALID_OBSERVATION');
  assert.equal(diagnoseSeries(linear, { max: 27 }).reason, 'INVALID_EXTRAPOLATION');
  const noisy = months(26, (index) => index % 2);
  const bounded = diagnoseSeries(noisy, { horizon: 1, min: 0, max: 1 });
  assert.equal(bounded.status, 'AVAILABLE');
  assert.ok(bounded.forecasts[0]?.residualBand);
  assert.ok(bounded.forecasts[0]!.residualBand!.p05 >= 0);
  assert.ok(bounded.forecasts[0]!.residualBand!.p95 <= 1);
});
