import assert from 'node:assert/strict';
import { test } from 'node:test';
import { futurosPollIntervalMs, futurosPollWait } from './futuros-poll';

test('CT006-02 doubles transient polling intervals up to thirty seconds and recovers after success', () => {
  const retry = futurosPollWait(futurosPollIntervalMs, 0, true, 250);
  assert.deepEqual(retry, { nextMs: 10_000, timeoutMs: 10_250 });
  assert.deepEqual(futurosPollWait(20_000, 0, true), { nextMs: 30_000, timeoutMs: 30_000 });
  assert.deepEqual(futurosPollWait(30_000, 0, false), { nextMs: 5_000, timeoutMs: 5_000 });
});

test('CT006-02 polling respects a Jira 429 Retry-After even beyond the exponential cap', () => {
  assert.deepEqual(futurosPollWait(5_000, 40_000, true, 500), { nextMs: 10_000, timeoutMs: 40_500 });
  assert.equal(futurosPollWait(5_000, 3_000_000_000, true).timeoutMs, 2_147_483_647);
});
