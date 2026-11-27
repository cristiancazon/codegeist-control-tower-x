import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HealthResponse } from '../../shared/health';
import { createIntegrationsResolver } from './resolvers';

const timestamp = '2026-11-26T12:00:00.000Z';
const ready: HealthResponse = { ok: true, data: { status: 'READY', projectId: '10202' }, requestId: 'ready' };

test('authorization and input failures prevent every optional probe', async () => {
  const failure: HealthResponse = { ok: false, requestId: 'deny', error: {
    code: 'FORBIDDEN', message: 'El proyecto no está disponible.', retryable: false,
  } };
  const blocked = async () => assert.fail('No debe consultar una fuente opcional sin acceso a Jira.');
  const resolve = createIntegrationsResolver({
    resolveHealth: async (request) => {
      assert.deepEqual(request.payload, { projectId: '999' });
      return failure;
    },
    probes: { JSM: blocked, ASSETS: blocked, CONFLUENCE: blocked }, now: () => new Date(timestamp),
  });
  assert.deepEqual(await resolve({ payload: { projectId: '999' } }), failure);
});

test('probes keep evidence local to the allowed source and isolate degraded dependencies', async () => {
  const context = { accountId: 'pseudonym' };
  const resolve = createIntegrationsResolver({
    resolveHealth: async () => ready,
    now: () => new Date(timestamp),
    probes: {
      JSM: async (trusted) => {
        assert.equal(trusted, context);
        return { state: 'READY', observedAt: timestamp, reference: 'SAFE-4' };
      },
      ASSETS: async () => { throw new Error('restricted upstream response'); },
      CONFLUENCE: async () => ({ state: 'NOT_AVAILABLE' }),
    },
  });
  const response = await resolve({ context });
  assert.ok(response.ok);
  assert.deepEqual(Object.fromEntries(response.data.capabilities.map(({ id, status }) => [id, status])), {
    JIRA: 'VERIFIED', JSM: 'VERIFIED', ASSETS: 'DEGRADED', CONFLUENCE: 'UNVERIFIED', ROVO: 'UNVERIFIED',
    MCP: 'DISABLED', TEAMWORK_GRAPH: 'DISABLED', ROVO_SKILL: 'DISABLED',
  });
  const evidence = response.data.capabilities.filter((row) => row.evidence).map((row) => row.evidence);
  assert.deepEqual(evidence, [
    { operation: 'BROWSE_PROJECTS', observedAt: timestamp },
    { operation: 'GET /rest/servicedeskapi/request/{id}', observedAt: timestamp, reference: 'SAFE-4' },
  ]);
  assert.doesNotMatch(JSON.stringify(response), /restricted upstream response|pseudonym/);
});
