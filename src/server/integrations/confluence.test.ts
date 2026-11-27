import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JiraBoundaryError } from '../data/jira';
import { createConfluenceKnowledge, readConfluenceFilters } from './confluence';

const cloudId = '11111111-2222-3333-4444-555555555555';
const jiraProjectId = '10202';
const spaceId = '501';
const observedAt = '2026-11-26T12:00:00.000Z';
const context = { accountId: 'reader', installContext: `ari:cloud:jira:${cloudId}:site/${cloudId}`, extension: { project: { id: jiraProjectId } } };
const defaultIndex = [{ pageId: '601', phaseCode: 'PH-04', subjectCode: 'A17-FICHA' }, { pageId: '602', phaseCode: 'PH-05' }];

function site(product: string, id = cloudId) {
  return { cloudId: id, toString: () => `ari:cloud:${product}:${id}:site/${id}` };
}

function page(id: string, overrides: Record<string, unknown> = {}) {
  return { id, spaceId, status: 'current', title: `Ficha de recepción ${id}`, authorId: 'private-person-id',
    version: { number: 3, createdAt: '2026-11-25T15:00:00-03:00', message: 'private-version-message' },
    body: { atlas_doc_format: { value: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Estado del kit A-17.\u202E' },
      { type: 'inlineCard', attrs: { url: 'https://hostile.invalid' } },
      { type: 'extension', attrs: { extensionKey: 'hidden-macro' }, content: [{ type: 'text', text: 'hidden-macro-text' }] },
    ] }] }) }, storage: { value: '<script>raw-html</script>' } },
    _links: { base: 'https://hostile.invalid', webui: '//hostile.invalid' }, ...overrides };
}

function response(status: number, body: unknown = {}, retry?: string) {
  return { status, headers: { get: (name: string) => name.toLowerCase() === 'retry-after' ? retry ?? null : null },
    text: async () => JSON.stringify(body) };
}

type Dependencies = Parameters<typeof createConfluenceKnowledge>[0];

function harness(overrides: Partial<Dependencies> = {}) {
  const requests: string[] = [];
  const checks: string[] = [];
  const dependencies: Dependencies = {
    settings: () => ({ enabled: 'true', cloudId, jiraProjectId, spaceId, pageIndex: JSON.stringify(defaultIndex) }),
    runtime: () => ({ installation: { contexts: [site('jira'), site('confluence')] } }),
    jira: (trusted) => {
      assert.equal(trusted, context);
      return { projectId: jiraProjectId, assertBrowsePermission: async () => { checks.push('browse'); } };
    },
    access: async (project, actor) => {
      assert.equal(project, jiraProjectId);
      assert.equal(actor, 'reader');
      checks.push('role');
      return { projectId: 'internal-id', roles: ['VIEWER'] };
    },
    requestPage: async (id) => response(200, page(id)),
    now: () => new Date(observedAt),
    ...overrides,
  };
  const reader = createConfluenceKnowledge({ ...dependencies, requestPage: (id, signal) => {
    requests.push(id);
    assert.equal(signal.aborted, false);
    return dependencies.requestPage(id, signal);
  } });
  return { reader, requests, checks };
}

test('CT008-02 checks current Jira Browse and project role before exposing connector state', async () => {
  const disabled = harness({ settings: () => ({}) });
  assert.deepEqual(await disabled.reader.probe(context), { source: 'CONFLUENCE', state: 'DISABLED',
    reason: 'NOT_CONFIGURED', observedAt: null });
  assert.deepEqual(disabled.checks, ['browse', 'role']);
  assert.deepEqual(disabled.requests, []);
  const denied = harness({ access: async () => undefined, settings: () => assert.fail('permission before configuration') });
  const hidden = await denied.reader.probe(context);
  assert.equal(hidden.reason, 'NOT_AVAILABLE');
  assert.deepEqual(denied.requests, []);
  const noBrowse = harness({ jira: () => ({ projectId: jiraProjectId,
    assertBrowsePermission: async () => { throw new JiraBoundaryError('FORBIDDEN', 'private provider reason'); } }),
  access: async () => assert.fail('browse before SQL role') });
  assert.deepEqual(await noBrowse.reader.probe(context), hidden);
  assert.equal((await noBrowse.reader.probe({ ...context, accountType: 'anonymous' })).reason, 'AUTH_REQUIRED');
  assert.deepEqual(noBrowse.requests, []);
});

test('CT008-02 requires configured project, same cloud products, and a valid bounded index before issuing a GET', async () => {
  const disconnected = harness({ runtime: () => ({ installation: { contexts: [site('jira')] } }) });
  assert.equal((await disconnected.reader.probe(context)).reason, 'PRODUCT_NOT_CONNECTED');
  const foreign = harness({ runtime: () => ({ installation: { contexts: [site('jira'), site('confluence', 'different-site')] } }) });
  assert.equal((await foreign.reader.probe(context)).reason, 'OUTSIDE_SCOPE');
  const wrongProject = harness({ settings: () => ({ enabled: 'true', cloudId, jiraProjectId: '10203', spaceId,
    pageIndex: JSON.stringify(defaultIndex) }) });
  assert.equal((await wrongProject.reader.probe(context)).reason, 'OUTSIDE_SCOPE');
  const invalid = harness({ settings: () => ({ enabled: 'true', cloudId, jiraProjectId, spaceId,
    pageIndex: JSON.stringify([{ pageId: '601' }, { pageId: '601' }]) }) });
  assert.equal((await invalid.reader.probe(context)).reason, 'INVALID_CONFIGURATION');
  for (const result of [disconnected, foreign, wrongProject, invalid]) assert.deepEqual(result.requests, []);
  assert.equal(readConfluenceFilters({ pageId: '../../private', query: 'algo' }), undefined);
  assert.equal(readConfluenceFilters({ phaseCode: 'PH-04\n', query: 'algo' }), undefined);
  assert.equal(readConfluenceFilters({ query: 'A'.repeat(161) }), undefined);
});

test('CT008-02 searches authorized titles and subject, and projects bounded metadata, dates and canonical references', async () => {
  const { reader, requests } = harness();
  const textMatch = await reader.search(context, { query: 'recepcion', phaseCode: 'PH-04' });
  assert.deepEqual(requests, ['601']);
  assert.deepEqual(textMatch, { source: 'CONFLUENCE', state: 'READY', reason: null, observedAt, documents: [{
    sourceType: 'CONFLUENCE', quality: 'LIVE', sourceId: '601', title: 'Ficha de recepción 601', excerpt: 'Estado del kit A-17.',
    contentTrust: 'UNTRUSTED_SOURCE_TEXT', phaseCode: 'PH-04', version: 3, updatedAt: '2026-11-25T18:00:00.000Z',
    observedAt, url: '/wiki/pages/viewpage.action?pageId=601',
  }] });
  const subjectMatch = await reader.search(context, { query: 'a17-ficha' });
  assert.deepEqual(subjectMatch.documents, textMatch.documents);
  assert.doesNotMatch(JSON.stringify(subjectMatch), /hostile|hidden-macro|raw-html|private-person|private-version/);
  requests.length = 0;
  const probe = await reader.probe(context);
  assert.deepEqual(requests, ['601']);
  assert.deepEqual(probe, { source: 'CONFLUENCE', state: 'READY', reason: null, observedAt });
});

test('CT008-02 ACL revocation and moved, absent, or draft pages return the same non-disclosing outcome', async () => {
  let mode: 'allowed' | 'denied' | 'absent' | 'moved' | 'draft' | 'crossed' = 'allowed';
  const { reader, requests } = harness({ requestPage: async (id) => {
    if (mode === 'denied') return response(403, page(id));
    if (mode === 'absent') return response(404, page(id));
    return response(200, page(id, mode === 'moved' ? { spaceId: '502' } : mode === 'draft' ? { status: 'draft' }
      : mode === 'crossed' ? { id: '602' } : {}));
  } });
  const first = await reader.search(context, { pageId: '601' });
  assert.equal(first.state, 'READY');
  const unknown = await reader.search(context, { pageId: '900' });
  assert.deepEqual(unknown, { source: 'CONFLUENCE', state: 'EMPTY', reason: null, observedAt: null, documents: [] });
  assert.deepEqual(requests, ['601']);
  for (const next of ['denied', 'absent', 'moved', 'draft', 'crossed'] as const) {
    mode = next;
    assert.deepEqual(await reader.search(context, { pageId: '601' }), unknown);
  }
  mode = 'denied';
  assert.equal((await reader.probe(context)).state, 'EMPTY');
});

test('CT008-02 reports source outages and a rate limit without leaking rejected items or continuing fan-out', async () => {
  const rate = harness({
    settings: () => ({ enabled: 'true', cloudId, jiraProjectId, spaceId,
      pageIndex: JSON.stringify(Array.from({ length: 6 }, (_, index) => ({ pageId: String(601 + index) }))) }),
    requestPage: async (id) => id === '601' ? response(200, page(id)) : id === '602' ? response(429, {}, '13') : response(403, page(id)),
  });
  const partial = await rate.reader.search(context);
  assert.deepEqual(rate.requests, ['601', '602', '603']);
  assert.equal(partial.state, 'PARTIAL');
  assert.equal(partial.reason, 'RATE_LIMITED');
  assert.equal(partial.retryAfterSeconds, 13);
  assert.deepEqual(partial.documents.map(({ sourceId }) => sourceId), ['601']);

  for (const [providerStatus, reason] of [[401, 'SOURCE_AUTH_REQUIRED'], [500, 'SOURCE_UNAVAILABLE']] as const) {
    const failing = harness({ requestPage: async () => response(providerStatus, { title: 'private title' }) });
    assert.deepEqual(await failing.reader.search(context), { source: 'CONFLUENCE', state: 'UNAVAILABLE', reason,
      observedAt: null, documents: [] });
  }
  const oversized = harness({ requestPage: async (id) => response(200, page(id, { body: 'x'.repeat(205_000) })) });
  assert.equal((await oversized.reader.probe(context)).reason, 'SOURCE_UNAVAILABLE');
});
