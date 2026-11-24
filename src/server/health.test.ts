import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HEALTH_OPERATION, type HealthErrorCode, type HealthResponse } from '../shared/health';
import { createHealthResolver, type HealthDependencies } from './health';

const context = {
  accountId: 'account-from-forge',
  installContext: 'installation-from-forge',
  extension: { project: { id: '10001' } },
};

function browsePermission(havePermission: unknown) {
  return { permissions: { BROWSE_PROJECTS: { havePermission } } };
}

function setup(overrides: Partial<HealthDependencies> = {}) {
  const projectIds: string[] = [];
  const logs: Parameters<HealthDependencies['log']>[0][] = [];
  const resolve = createHealthResolver({
    requestBrowsePermission: async (projectId) => {
      projectIds.push(projectId);
      return { status: 200, json: async () => browsePermission(true) };
    },
    log: (entry) => logs.push(entry),
    ...overrides,
  });

  return { resolve, projectIds, logs };
}

function assertFailure(result: HealthResponse, code: HealthErrorCode, retryable: boolean) {
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, code);
    assert.equal(result.error.retryable, retryable);
  }
}

test('uses the project from the Forge resolver context after Jira grants Browse Projects', async () => {
  const { resolve, projectIds, logs } = setup();
  const result = await resolve({ payload: {}, context });

  assert.deepEqual(result, { ok: true, data: { status: 'READY', projectId: '10001' }, requestId: result.requestId });
  assert.deepEqual(projectIds, ['10001']);
  assert.match(result.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0], {
    requestId: result.requestId,
    operation: HEALTH_OPERATION,
    durationMs: logs[0]?.durationMs,
    code: 'READY',
  });
  assert.ok(typeof logs[0]?.durationMs === 'number' && logs[0].durationMs >= 0);
});

test('rejects client-supplied account, installation and project data before calling Jira', async () => {
  const { resolve, projectIds } = setup();

  for (const payload of [
    { accountId: 'other-account' },
    { installContext: 'other-installation' },
    { projectId: '10002' },
    { context },
    [],
    null,
  ]) {
    assertFailure(await resolve({ payload, context }), 'VALIDATION_ERROR', false);
  }

  assert.deepEqual(projectIds, []);
});

test('fails closed without an authenticated user, installation or valid project context', async () => {
  const { resolve, projectIds } = setup();

  assertFailure(await resolve({ context: { ...context, accountId: undefined } }), 'AUTH_REQUIRED', false);
  assertFailure(await resolve({ context: { ...context, accountType: 'anonymous' } }), 'AUTH_REQUIRED', false);
  assertFailure(await resolve({ context: { ...context, installContext: '' } }), 'FORBIDDEN', false);
  assertFailure(await resolve({ context: { ...context, extension: {} } }), 'FORBIDDEN', false);
  assertFailure(await resolve({ context: { ...context, extension: { project: { id: '10001?permissions=ADMINISTER' } } } }), 'FORBIDDEN', false);
  assert.deepEqual(projectIds, []);
});

test('distinguishes Jira permission denial from an unverifiable permission response', async () => {
  const denied = setup({ requestBrowsePermission: async () => ({ status: 200, json: async () => browsePermission(false) }) });
  assertFailure(await denied.resolve({ context }), 'FORBIDDEN', false);

  const malformed = setup({ requestBrowsePermission: async () => ({ status: 200, json: async () => browsePermission('true') }) });
  assertFailure(await malformed.resolve({ context }), 'SOURCE_UNAVAILABLE', true);

  const invalidJson = setup({ requestBrowsePermission: async () => ({
    status: 200,
    json: async () => { throw new SyntaxError('private upstream body'); },
  }) });
  assertFailure(await invalidJson.resolve({ context }), 'SOURCE_UNAVAILABLE', true);
});

test('classifies unsuccessful Jira responses without reading the upstream body', async () => {
  for (const [status, code, retryable] of [
    [401, 'AUTH_REQUIRED', false],
    [403, 'FORBIDDEN', false],
    [404, 'FORBIDDEN', false],
    [429, 'RATE_LIMITED', true],
    [503, 'SOURCE_UNAVAILABLE', true],
  ] as const) {
    let readBody = false;
    const { resolve } = setup({ requestBrowsePermission: async () => ({
      status,
      json: async () => { readBody = true; return {}; },
    }) });

    assertFailure(await resolve({ context }), code, retryable);
    assert.equal(readBody, false);
  }
});

test('reports correlation without leaking exceptions, account or installation data', async () => {
  const sentinel = 'private Atlassian response, simulated credential and stack';
  const { resolve, logs } = setup({ requestBrowsePermission: async () => { throw new Error(sentinel); } });
  const result = await resolve({ context });

  assertFailure(result, 'INTERNAL_ERROR', true);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.requestId, result.requestId);
  assert.equal(logs[0]?.code, 'INTERNAL_ERROR');
  const output = JSON.stringify({ result, logs });
  for (const privateValue of [sentinel, context.accountId, context.installContext, 'stack']) {
    assert.equal(output.includes(privateValue), false);
  }
});

test('a Forge proxy exception maps by numeric status and only a consent signal is delegated', async () => {
  const proxy = setup({
    requestBrowsePermission: async () => { throw Object.assign(new Error('upstream request details'), { status: 429 }); },
  });
  assertFailure(await proxy.resolve({ context }), 'RATE_LIMITED', true);

  const legacyProxy = setup({
    requestBrowsePermission: async () => { throw Object.assign(new Error('upstream request details'), { statusCode: 403 }); },
  });
  assertFailure(await legacyProxy.resolve({ context }), 'FORBIDDEN', false);

  const consentSignal = new Error('Forge consent test signal');
  const consent = setup({
    requestBrowsePermission: async () => { throw consentSignal; },
    isForgeConsentError: (error) => error === consentSignal,
  });
  await assert.rejects(consent.resolve({ context }), (error) => error === consentSignal);
  assert.equal(consent.logs.length, 1);
  assert.equal(consent.logs[0]?.code, 'AUTH_REQUIRED');
  assert.equal(JSON.stringify(consent.logs).includes(consentSignal.message), false);
});
