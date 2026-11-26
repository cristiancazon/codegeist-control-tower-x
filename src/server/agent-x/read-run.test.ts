import assert from 'node:assert/strict';
import test from 'node:test';
import type { Distribution, StatisticsSummary } from '../../domain/futuros/statistics';
import type { FuturosRun } from '../../shared/futuros';
import { createReadFuturosResult } from './read-run';

const runId = '11111111-2222-4333-8444-555555555555';
const selectors = { runId, jiraProjectId: '10202' };
const context = { principal: { accountId: 'invoking-account' }, installContext: 'ari:cloud:jira::site/example' };

function distribution<T>(point: T): Distribution<T> {
  const absent = { p05: null, p10: null, p50: null, p80: null, p90: null, p95: null };
  return {
    observedCount: 2, totalCount: 2, lowerBounds: absent,
    percentiles: { p05: point, p10: point, p50: point, p80: point, p90: point, p95: point },
    histogram: [{ from: point, to: point, count: 2 }],
  };
}

const success: StatisticsSummary['success']['joint'] = {
  probability: 1, successes: 2, failures: 0, unknown: 0, wilson95: [0.342, 1], bounds: null, reason: null,
};
const result: StatisticsSummary = {
  sampleCount: 2, censoredCount: 0, censoringRate: 0, censoringCause: null, distributionIncomplete: false,
  recommendationsAllowed: true, finishDay: distribution(26), costCents: distribution('4606500000'),
  waitDays: distribution(0), utilization: distribution(1), productivity: distribution(1), milestones: [],
  success: { deadline: success, budget: success, joint: success }, sensitivity: { finishDay: [], costCents: [] }, criticity: [],
};
const run: FuturosRun = {
  id: runId, scenarioId: 'scenario', status: 'SUCCEEDED', sampleCount: 2, createdAt: '2026-11-26T09:00:00.000Z',
  seed: '0'.repeat(32), snapshotId: 'snapshot', retryOfId: null, materializedCount: 2,
  modelVersion: 'cpm-pert-v1', engineBuild: 'futuros-1.0.0', rngVersion: 'hmac-sha256-v1',
  inputHash: 'e'.repeat(64), resultHash: 'f'.repeat(64), startedAt: '2026-11-26T09:00:01.000Z',
  deadlineAt: '2026-11-26T09:20:00.000Z', finishedAt: '2026-11-26T09:00:02.000Z', errorCode: null,
  snapshotAsOf: '2026-11-24', canCancel: false, canRetry: false, logical: { finishDay: 26, tasks: [] }, result,
};

test('missing, anonymous or inconsistent Forge Rovo identity cannot reach the read boundary', async () => {
  const action = createReadFuturosResult(async () => { throw new Error('The read must not run.'); });
  const supplied = { ...selectors, context, accountId: 'payload-account' };
  for (const denied of [undefined, { accountId: 'tenant' }, { ...context, accountType: 'anonymous' },
    { ...context, accountId: 'conflicts-with-principal' }, { installContext: context.installContext }]) {
    assert.deepEqual(await action(supplied, denied), {
      ok: false, error: { code: 'AUTH_REQUIRED', message: 'Se requiere una sesión autorizada para consultar Futuros en Jira.' },
    });
  }
});

test('malformed selectors are rejected before the read and never echoed', async () => {
  const action = createReadFuturosResult(async () => { throw new Error('The read must not run.'); });
  for (const payload of [{ ...selectors, runId: 'injected-instruction' }, { ...selectors, jiraProjectId: 'PED' },
    { ...selectors, jiraProjectId: 10202 }, { runId }]) {
    const output = await action(payload, context);
    assert.ok(!output.ok);
    if (!output.ok) assert.equal(output.error.code, 'INVALID_REFERENCE');
    assert.doesNotMatch(JSON.stringify(output), /injected-instruction|PED|10202/);
  }
});

test('Agent X uses the authorized read service and projects only published aggregates', async () => {
  const action = createReadFuturosResult(async (request) => {
    assert.deepEqual(request, {
      payload: { runId }, context: {
        accountId: 'invoking-account', installContext: context.installContext, extension: { project: { id: '10202' } },
      },
    });
    return { ok: true, data: run, requestId: 'request-digest' };
  });
  const output = await action({ ...selectors, context: { accountId: 'other', installContext: 'foreign' } }, context);
  assert.ok(output.ok && output.status === 'SUCCEEDED' && 'result' in output);
  assert.equal(output.reference.runId, runId);
  assert.equal(output.reference.resultHash, run.resultHash);
  assert.equal(output.result.finishDay.percentiles.p80, 26);
  assert.equal(output.result.costCents.percentiles.p80, '4606500000');
  assert.deepEqual(output.result.success.joint.wilson95, [0.342, 1]);
  assert.doesNotMatch(JSON.stringify(output), /histogram|seed|logical|foreign|invoking-account/);
});

test('denied reads are indistinguishable and authorized pending runs expose only their state', async () => {
  const forge = { accountId: 'invoking-account', installContext: context.installContext };
  let referenceFailure: unknown;
  for (const code of ['FORBIDDEN', 'NOT_FOUND', 'STALE_INPUT'] as const) {
    const action = createReadFuturosResult(async () => ({
      ok: false, error: { code, message: 'private-detail' }, requestId: 'scoped-reference',
    }));
    const output = await action(selectors, forge);
    assert.ok(!output.ok && output.error.code === 'NOT_AVAILABLE');
    assert.doesNotMatch(JSON.stringify(output), /private-detail|scoped-reference/);
    if (referenceFailure) assert.deepEqual(output, referenceFailure);
    referenceFailure = output;
  }
  const action = createReadFuturosResult(async () => ({ ok: true, data: { ...run, status: 'RUNNING' }, requestId: 'sane' }));
  const pending = await action(selectors, forge);
  assert.ok(pending.ok && pending.status === 'RUNNING');
  assert.equal('result' in pending, false);
});
