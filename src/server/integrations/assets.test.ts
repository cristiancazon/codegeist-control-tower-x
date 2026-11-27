import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAssetsProbe } from './assets';

const cloudId = '10000000-0000-4000-8000-000000000000';
const workSpace = '20000000-0000-4000-8000-000000000000';
const binding = { cloudId, projectId: '10202', workspaceId: workSpace, objectId: '88', typeId: '23' };
const context = { accountId: 'actor', installContext: `ari:cloud:jira::site/${cloudId}` };
const observedAt = '2026-11-26T12:00:00.000Z';

function setup({ status = 200, revoked = false, objectType = '23' } = {}) {
  const calls: string[] = [];
  const probe = createAssetsProbe({
    authorize: () => ({ projectId: '10202', assertBrowsePermission: async () => { calls.push('browse'); } }),
    getAccess: async () => {
      calls.push('role');
      return revoked ? undefined : { projectId: 'project', roles: ['VIEWER'] };
    },
    cloudIds: () => [cloudId], now: () => new Date(observedAt),
    getObject: async (path) => {
      calls.push(path.value);
      return { status, json: async () => ({
        id: binding.objectId, workspaceId: binding.workspaceId, objectType: { id: objectType }, objectKey: 'EQUIP-88',
        attributes: ['data that must not be serialized'],
      }) };
    },
  });
  return { calls, probe };
}

test('Assets requires the current installation, project, and a current actor role before GET', async () => {
  const { calls, probe } = setup({ revoked: true });
  assert.deepEqual(await probe(context), { state: 'DISABLED' });
  assert.deepEqual(await probe({ ...context, installContext: 'foreign' }, binding), { state: 'DISABLED' });
  assert.deepEqual(await probe(context, { ...binding, projectId: '999' }), { state: 'DISABLED' });
  assert.deepEqual(calls, []);
  assert.deepEqual(await probe(context, binding), { state: 'NOT_AVAILABLE' });
  assert.deepEqual(calls, ['browse', 'role']);
});

test('Assets returns only confirmed object provenance and discards denied or mismatched responses', async () => {
  const { calls, probe } = setup();
  assert.deepEqual(await probe(context, binding), { state: 'READY', source: 'ASSETS', observedAt, reference: 'EQUIP-88' });
  assert.deepEqual(calls, ['browse', 'role', `/jsm/assets/workspace/${workSpace}/v1/object/88`]);
  for (const status of [401, 403, 404]) {
    assert.deepEqual(await setup({ status }).probe(context, binding), { state: 'NOT_AVAILABLE' });
  }
  for (const status of [302, 429, 500]) {
    assert.deepEqual(await setup({ status }).probe(context, binding), { state: 'UNAVAILABLE' });
  }
  assert.deepEqual(await setup({ objectType: '99' }).probe(context, binding), { state: 'UNAVAILABLE' });
});
