import assert from 'node:assert/strict';
import test from 'node:test';
import type { OperationsDetail, OperationsPage, OperationsSource } from '../../shared/operations';
import { createOperationsEvidence } from './operations-evidence';

const observedAt = '2026-11-24T08:00:00.000Z';
const context = { principal: { accountId: 'verified-actor' }, installContext: 'ari:cloud:jira::site/example' };
const selector = { projectRef: 'PED' };
const resolveProject = (value: unknown) => value === 'PED' ? '10202' : undefined;
const sources: OperationsSource[] = [
  { source: 'FORGE', state: 'READY', quality: 'SYNTHETIC', observedAt, detail: 'Only the protocol metadata is shared.' },
  { source: 'JIRA', state: 'READY', quality: 'LIVE', observedAt, detail: '' },
];
const a17: OperationsDetail = {
  code: 'A-17', title: 'Envío A-17 <a href="https://evil.invalid">Abrir</a>', sources,
  fields: [{ label: 'ETA original', value: '2026-11-28' }, { label: 'ETA vigente', value: '2026-12-13' }],
  links: [
    { kind: 'record', section: 'assets', code: 'EQ-017', label: 'Equipo' },
    { kind: 'record', section: 'contractors', code: 'CON-03', label: 'Proveedor primario' },
    { kind: 'record', section: 'work', code: 'WP-064', label: 'Montaje' },
    { kind: 'record', section: 'work', code: 'WP-083', label: 'Comisionado' },
    { kind: 'jira', issueKey: 'PED-48', label: 'Recepción' },
    { kind: 'jira', issueKey: 'https://evil.invalid', label: 'Vínculo inválido' },
  ],
};

const never = async () => { throw new Error('Unexpected read'); };

test('Agent X operational A-17 evidence uses the current actor and keeps typed provenance and safe links', async () => {
  const action = createOperationsEvidence({
    resolveProject, jiraOrigin: async () => 'https://ped-demo.atlassian.net',
    read: {
      list: never,
      detail: async (request) => {
        assert.deepEqual(request, {
          context: { accountId: 'verified-actor', installContext: context.installContext, extension: { project: { id: '10202' } } },
          payload: { section: 'logistics', code: 'A-17' },
        });
        return { ok: true, data: a17, requestId: 'test-reference' };
      },
    },
  });
  const output = await action.readOperationalExposure({
    ...selector, focus: 'logistics', itemRef: 'A-17', context: { accountId: 'attacker' }, url: 'https://evil.invalid',
  }, context);
  assert.ok(output.ok && 'record' in output);
  assert.equal(output.status, 'READY');
  assert.equal(output.asOf, observedAt);
  assert.equal(output.record.registeredEtaChangeDays, 15);
  assert.deepEqual(output.evidence.map(({ sourceId }) => sourceId), ['A-17', 'EQ-017', 'CON-03', 'WP-064', 'WP-083', 'PED-48']);
  assert.ok(output.evidence.some((item) => 'url' in item && item.url === 'https://ped-demo.atlassian.net/browse/PED-48'));
  assert.doesNotMatch(JSON.stringify(output), /evil.invalid|attacker|<a|Only the protocol metadata/);
});

test('Agent X rejects selectors before data access and preserves generic denial for restricted HSE', async () => {
  let numberOfReads = 0;
  const action = createOperationsEvidence({
    resolveProject, jiraOrigin: never,
    read: {
      list: never,
      detail: async () => {
        numberOfReads += 1;
        return { ok: false, error: { code: 'FORBIDDEN', message: 'private audit' }, requestId: 'internal' };
      },
    },
  });
  const hse = { ...selector, focus: 'hse', itemRef: 'HSE-001' };
  for (const [payload, actor] of [[hse, { installContext: context.installContext }], [{ ...hse, itemRef: '../HSE-001' }, context],
    [{ ...hse, projectRef: 'RESTRICTED' }, context], [{ ...hse, focus: 'JQL' }, context]]) {
    const output = await action.readOperationalExposure(payload, actor);
    assert.equal(output.ok, false);
  }
  assert.equal(numberOfReads, 0);
  const denied = await action.readOperationalExposure(hse, context);
  assert.ok(!denied.ok);
  assert.equal(denied.error.code, 'NOT_AVAILABLE');
  assert.doesNotMatch(JSON.stringify(denied), /HSE-001|private audit|internal/);
  assert.equal(numberOfReads, 1);
});

function knowledgePage(): OperationsPage {
  return {
    project: { key: 'PED', name: 'Patagonia' }, asOf: '2026-11-24', page: 1, pageSize: 20,
    columns: ['Título'], total: 8,
    rows: Array.from({ length: 8 }, (_, index) => ({ code: `DOC-${index}`, cells: ['Información A-17'] })),
    sources: [...sources, { source: 'CONFLUENCE', state: 'DISABLED', quality: null, observedAt: null, detail: '' }],
  };
}

test('Agent X knowledge reauthorizes matched details, limits excerpts, and treats Confluence availability independently', async () => {
  const queries: unknown[] = [];
  const action = createOperationsEvidence({
    resolveProject, jiraOrigin: async () => 'https://ped-demo.atlassian.net.evil.invalid',
    read: {
      list: async ({ payload }) => {
        assert.deepEqual(payload, { section: 'knowledge' });
        return { ok: true, data: knowledgePage(), requestId: 'safe' };
      },
      detail: async ({ payload }) => {
        queries.push(payload);
        const { code } = payload as { code: string };
        if (code === 'DOC-2') return { ok: false, error: { code: 'FORBIDDEN', message: 'private' }, requestId: 'private' };
        return {
          ok: true, requestId: 'detail', data: {
            code, title: '<script>Información</script> A-17', sources,
            fields: [
              { label: 'Referencia sintética', value: 'Referencia https://evil.invalid [ver](javascript:evil) ' + 'x'.repeat(400) },
              { label: 'Fecha verificada', value: '2026-11-24' }, { label: 'Versión', value: 'patagonia-v1' },
            ],
            links: [{ kind: 'jira', label: 'Datos Jira', issueKey: 'PED-48' }],
          },
        };
      },
    },
  });
  const disabled = await action.searchProjectKnowledge({ ...selector, query: 'A-17', source: 'confluence' }, context);
  assert.ok(disabled.ok && disabled.status === 'SOURCE_DISABLED');
  assert.equal(queries.length, 0);
  const invalid = await action.searchProjectKnowledge({ ...selector, query: 'A'.repeat(161) }, context);
  assert.ok(!invalid.ok && invalid.error.code === 'INVALID_REFERENCE');
  const output = await action.searchProjectKnowledge({ ...selector, query: ' INFORMACION A-17 ' }, context);
  assert.ok(output.ok && 'documents' in output && output.status === 'PARTIAL');
  assert.deepEqual(queries, Array.from({ length: 5 }, (_, index) => ({ section: 'knowledge', code: `DOC-${index}` })));
  assert.equal(output.documents.length, 4);
  assert.ok(output.documents.every(({ excerpt }) => excerpt?.length === 300));
  assert.doesNotMatch(JSON.stringify(output), /DOC-2|evil.invalid|javascript:|private|<script>|"url"/);
  assert.ok(output.coverage.some(({ source, state }) => source === 'CONFLUENCE' && state === 'DISABLED'));
});

test('Agent X only reports disabled Confluence after the project read boundary authorizes the actor', async () => {
  const action = createOperationsEvidence({ resolveProject, jiraOrigin: never, read: {
    detail: never,
    list: async () => ({ ok: false, error: { code: 'FORBIDDEN', message: 'restricted project' }, requestId: 'private' }),
  } });
  const output = await action.searchProjectKnowledge({ ...selector, query: 'A-17', source: 'confluence' }, context);
  assert.ok(!output.ok);
  assert.equal(output.error.code, 'NOT_AVAILABLE');
});
