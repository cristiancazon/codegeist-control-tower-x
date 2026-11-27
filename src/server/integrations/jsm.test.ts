import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JiraBoundaryError } from '../data/jira';
import type { ProjectAccess } from '../data/sql/projects';
import { createJsmReader, type JsmIncidentBinding } from './jsm';

const cloudId = '11111111-2222-4333-8444-555555555555';
const tenantAri = `ari:cloud:jira::site/${cloudId}`;
const jiraProjectId = '10202';
const binding: JsmIncidentBinding = {
  enabled: true, cloudId, jiraProjectId, serviceDeskId: '12', serviceProjectId: '10500', serviceProjectKey: 'SAFETY',
  requestTypeIds: ['301', '302'], portalId: '17',
};
const context = { accountId: 'current-account', installContext: tenantAri, extension: { project: { id: jiraProjectId } } };
const desk = { id: '12', projectId: '10500', projectKey: 'SAFETY', projectName: 'Ignored private metadata' };
const timestamp = '2026-11-26T17:00:00.000Z';
const options = { runtime: () => ({ installation: { contexts: [{ cloudId, toString: () => tenantAri }] } }),
  verifyBrowse: async () => {}, now: () => new Date(timestamp),
  getProjectAccess: async (): Promise<ProjectAccess> => ({ projectId: 'verified-app-project', roles: ['VIEWER', 'HSE_READER'] }),
};

function incident(index: number, requestTypeId = '301') {
  return {
    issueId: String(1200 + index), issueKey: `SAFETY-${index}`, serviceDeskId: '12', requestTypeId,
    createdDate: { iso8601: '2026-11-25T06:00:00-0300', friendly: 'private date' },
    currentStatus: { statusCategory: 'NEW', status: 'do not share configured title',
      statusDate: { iso8601: '2026-11-25T14:00:30.001+01:00' } },
    requestFieldValues: [{ fieldId: 'description', value: 'clinical and private' }],
    reporter: { emailAddress: 'person@example.invalid' }, attachments: [{ name: 'treatment report' }],
    _links: { web: 'https://malicious.example/steal' }, comments: 'private comments',
  };
}

const payloadPage = (start: number, values: unknown[], isLastPage = true) => ({
  limit: 20, start, size: values.length, isLastPage, values, _links: { next: 'https://malicious.example' },
});
const response = (payload: unknown, status = 200, headers: Record<string, string> = {}) => ({
  status, text: async () => JSON.stringify(payload), headers: { get: (name: string) => headers[name] ?? null },
});

type Request = NonNullable<Parameters<typeof createJsmReader>[0]>['request'];
function mockRequests(respond: (url: URL) => ReturnType<typeof response>) {
  const paths: URL[] = [];
  const request: Request = async (path, requestOptions) => {
    assert.equal(requestOptions.method, 'GET');
    assert.equal(requestOptions.redirect, 'manual');
    assert.ok(requestOptions.signal instanceof AbortSignal);
    const url = new URL(path.value, 'https://jsm.example.invalid');
    assert.equal(url.origin, 'https://jsm.example.invalid');
    paths.push(url);
    return respond(url);
  };
  return { request, paths };
}

test('CT008-02 scopes every request and page to actor, installed Jira site, desk and mapped type', async () => {
  const { request, paths } = mockRequests((url) => {
    if (url.pathname === '/rest/servicedeskapi/servicedesk/12') return response(desk);
    assert.equal(url.pathname, '/rest/servicedeskapi/request');
    assert.equal(url.searchParams.get('serviceDeskId'), '12');
    assert.equal(url.searchParams.get('limit'), '20');
    assert.equal(url.searchParams.has('expand'), false);
    const type = url.searchParams.get('requestTypeId');
    const start = Number(url.searchParams.get('start'));
    if (type === '301') return response(payloadPage(start, [incident(start ? 2 : 1)], start > 0));
    assert.equal(type, '302');
    return response(payloadPage(start, [incident(3, '302')]));
  });
  const api = createJsmReader({ ...options, request,
    verifyBrowse: async (requestContext) => { assert.equal(requestContext, context); },
    getProjectAccess: async (projectId, actor) => {
      assert.equal(projectId, jiraProjectId);
      assert.equal(actor, 'current-account');
      return { projectId: 'verified-app-project', roles: ['VIEWER', 'HSE_READER'] };
    },
  });
  const result = await api.readJsmIncidentSummaries(context, binding);
  assert.ok(result.state === 'READY' && result.data);
  assert.equal(result.observedAt, timestamp);
  assert.equal(result.visibility, 'CURRENT_ACTOR');
  assert.deepEqual(result.data.map(({ issueKey }) => issueKey), ['SAFETY-1', 'SAFETY-2', 'SAFETY-3']);
  assert.deepEqual(result.data[0], {
    issueId: '1201', issueKey: 'SAFETY-1', serviceDeskId: '12', requestTypeId: '301', status: 'OPEN',
    createdAt: '2026-11-25T09:00:00.000Z', statusChangedAt: '2026-11-25T13:00:30.001Z',
    portalPath: '/servicedesk/customer/portal/17/SAFETY-1',
  });
  assert.doesNotMatch(JSON.stringify(result), /clinical|reporter|private|person@example|malicious|attachments|comments/);
  assert.deepEqual(paths.slice(1).map((url) => [url.searchParams.get('requestTypeId'), url.searchParams.get('start')]),
    [['301', '0'], ['301', '20'], ['302', '0']]);
});

test('CT008-02 disabled, unsigned and foreign contexts never reach Jira or JSM', async () => {
  const unreachable = async () => assert.fail('No read is authorized');
  const api = createJsmReader({ ...options, request: unreachable, getProjectAccess: unreachable, verifyBrowse: unreachable });
  for (const invalid of [undefined, { ...binding, enabled: false }, { ...binding, serviceDeskId: '12/13' },
    { ...binding, requestTypeIds: ['301', '301'] }, { ...binding, requestTypeIds: [] }]) {
    const unavailable = await api.readJsmIncidentSummaries(context, invalid);
    assert.equal(unavailable.state, 'DISABLED');
    assert.equal(unavailable.data, null);
  }
  for (const rejected of [undefined, { ...context, accountType: 'anonymous' }, { ...context, installContext: 'foreign' },
    { ...context, extension: { project: { id: '10203' } } }, { ...context, accountId: undefined, payload: context }]) {
    assert.equal((await api.readJsmIncidentSummaries(rejected, binding)).state, 'NOT_AVAILABLE');
  }
  const mismatchedRuntime = createJsmReader({ ...options, request: unreachable, verifyBrowse: unreachable,
    runtime: () => ({ installation: { contexts: [{ cloudId, toString: () => `ari:cloud:confluence::site/${cloudId}` }] } }),
  });
  assert.equal((await mismatchedRuntime.readJsmIncidentSummaries(context, binding)).state, 'NOT_AVAILABLE');
});

test('CT008-02 Jira denial and insufficient application HSE roles are indistinguishable', async () => {
  const unreachable = async () => assert.fail('JSM must not be queried without both permissions');
  const deniedJira = createJsmReader({ ...options, request: unreachable, getProjectAccess: unreachable,
    verifyBrowse: async () => { throw new JiraBoundaryError('FORBIDDEN', 'private reference'); },
  });
  const denied = await deniedJira.readJsmIncidentSummaries(context, binding);
  assert.deepEqual(denied, { source: 'JSM', visibility: 'CURRENT_ACTOR', state: 'NOT_AVAILABLE', observedAt: null, data: null });
  for (const roles of [['VIEWER'], ['HSE_READER']] as const) {
    const noClearance = createJsmReader({ ...options, request: unreachable,
      getProjectAccess: async () => ({ projectId: 'other', roles }) });
    assert.deepEqual(await noClearance.readJsmIncidentSummaries(context, binding), denied);
  }
});

test('CT008-02 verifies the remote desk project and drops previously collected data after authority loss', async () => {
  const denied = mockRequests((url) => {
    if (url.pathname === '/rest/servicedeskapi/servicedesk/12') return response(desk);
    const start = Number(url.searchParams.get('start'));
    return start === 0 ? response(payloadPage(start, [incident(1)], false)) : response({ secret: 'private' }, 403);
  });
  const absent = mockRequests(() => response({ secret: 'private' }, 404));
  const foreign = mockRequests(() => response({ ...desk, projectId: '10666' }));
  const badRow = mockRequests((url) => url.pathname.includes('/servicedesk/')
    ? response(desk) : response(payloadPage(0, [{ ...incident(1), serviceDeskId: '99' }])));
  for (const mocked of [denied, absent, foreign, badRow]) {
    const api = createJsmReader({ ...options, request: mocked.request });
    assert.deepEqual(await api.readJsmIncidentSummaries(context, binding), {
      source: 'JSM', visibility: 'CURRENT_ACTOR', state: 'NOT_AVAILABLE', observedAt: null, data: null,
    });
  }
  assert.equal(foreign.paths.length, 1);
});

test('CT008-02 distinguishes an authorized empty scope, bounded partial results and a rate limit', async () => {
  const single = { ...binding, requestTypeIds: ['301'] };
  const empty = mockRequests((url) => url.pathname.endsWith('/12') ? response(desk) : response(payloadPage(0, [])));
  const limited = mockRequests((url) => {
    if (url.pathname.endsWith('/12')) return response(desk);
    const start = Number(url.searchParams.get('start'));
    return start ? response({}, 429, { 'Retry-After': '59' }) : response(payloadPage(start, [incident(1)], false));
  });
  const continuous = mockRequests((url) => {
    if (url.pathname.endsWith('/12')) return response(desk);
    const start = Number(url.searchParams.get('start'));
    return response(payloadPage(start, [incident(start / 20 + 1)], false));
  });
  const emptyReader = createJsmReader({ ...options, request: empty.request });
  assert.deepEqual(await emptyReader.readJsmIncidentSummaries(context, single),
    { source: 'JSM', visibility: 'CURRENT_ACTOR', state: 'READY', observedAt: timestamp, data: [] });
  const partial = await createJsmReader({ ...options, request: limited.request }).readJsmIncidentSummaries(context, single);
  assert.equal(partial.state, 'PARTIAL');
  assert.equal(partial.data?.length, 1);
  assert.equal(partial.retryAfterSeconds, 59);
  const bounded = await createJsmReader({ ...options, request: continuous.request }).readJsmIncidentSummaries(context, single);
  assert.equal(bounded.state, 'PARTIAL');
  assert.equal(bounded.data?.length, 8);
  assert.equal(continuous.paths.length, 9);
});

test('CT008-02 detail verifies the requested identity and ignores unverified status labels and dates', async () => {
  const mock = mockRequests((url) => {
    if (url.pathname.endsWith('/12')) return response(desk);
    return response({ ...incident(1), createdDate: { iso8601: '2026-02-30T06:00:00Z' },
      currentStatus: { status: 'arbitrary clinical status', statusCategory: 'malicious', statusDate: {} } });
  });
  const api = createJsmReader({ ...options, request: mock.request });
  const result = await api.readJsmIncidentDetail(context, binding, '1201');
  assert.equal(result.state, 'READY');
  assert.equal(result.data?.status, 'UNKNOWN');
  assert.equal(result.data?.createdAt, null);
  assert.equal(result.data?.statusChangedAt, null);
  assert.doesNotMatch(JSON.stringify(result), /arbitrary|clinical/);
  const mismatch = await api.readJsmIncidentDetail(context, binding, '1202');
  assert.equal(mismatch.state, 'NOT_AVAILABLE');
  assert.equal(mismatch.data, null);
  const before = mock.paths.length;
  assert.equal((await api.readJsmIncidentDetail(context, binding, 'FOREIGN-1')).state, 'NOT_AVAILABLE');
  assert.equal(mock.paths.length, before);
});
