import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import type { Result } from '@forge/sql';
import { fixture, fixtureHash } from '../data/bootstrap/fixture';
import { fixtureMigrations } from '../data/bootstrap/schema';
import type { JiraWorkItem } from '../data/jira';
import type { executeSql, SqlParameter } from '../data/sql/client';
import { persistPatagoniaFixture } from '../data/sql/patagonia';
import type { ProjectRole } from '../data/sql/projects';
import { modelMigrations } from '../data/sql/schema';
import type { OperationsScope } from './scope';
import { listSummary, readSummaryDetail } from './summaries';

const jiraProjectId = '10001';
const ownerAccountId = 'fixture-admin';
const asOf = fixture.snapshot.asOfDate;
const observedAt = '2026-11-25T00:00:00.000Z';
const clock = '2026-11-25 00:00:00.000';

function makeScope(roles: readonly ProjectRole[], jiraIssues: ReadonlyMap<string, JiraWorkItem> = new Map()): OperationsScope {
  return {
    projectId: fixture.project.id, jiraProjectId, roles,
    snapshot: { asOf, collectedAt: fixture.snapshot.collectedAt }, observedAt, jiraIssues, jiraState: 'READY',
  };
}

async function withPublishedFixture(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  for (const [, ddl] of [...modelMigrations, ...fixtureMigrations]) {
    const table = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(ddl)?.[1];
    assert.ok(table);
    const indexes = [...ddl.matchAll(/^\s+(UNIQUE )?KEY (\w+) \(([^)]+)\),?$/gm)];
    db.exec(ddl.replace(/^\s+(?:UNIQUE )?KEY .+$/gm, '')
      .replace(/,\s*\)(?: DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin)?\s*$/, ')')
      .replace(/ DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin\s*$/, ''));
    for (const [, unique = '', name, columns] of indexes) {
      db.exec(`CREATE ${unique}INDEX ${name} ON ${table} (${columns})`);
    }
  }

  const query: typeof executeSql = async <Row>(statement: string, parameters: readonly SqlParameter[]): Promise<Result<Row>['rows']> => {
    const prepared = db.prepare(statement.replace(/ON DUPLICATE KEY UPDATE \w+ = \w+\.\w+/g, 'ON CONFLICT DO NOTHING')
      .replaceAll('UTC_TIMESTAMP(3)', `'${clock}'`));
    const values = parameters.map((value) => typeof value === 'boolean' ? Number(value) : value);
    return statement.trimStart().startsWith('SELECT')
      ? prepared.all(...values) as Result<Row>['rows']
      : { affectedRows: prepared.run(...values).changes } as Result<Row>['rows'];
  };

  const { id: projectId, code, name, timeZone, currency } = fixture.project;
  db.prepare(`INSERT INTO ctx_project (id, code, name, jira_project_id, jira_project_key, time_zone, currency, data_mode, status, version, updated_at)
    VALUES (?, ?, ?, ?, 'PED', ?, ?, 'DEMO', 'IMPORTING', 1, ?)`)
    .run(projectId, code, name, jiraProjectId, timeZone, currency, clock);
  db.prepare(`INSERT INTO ctx_fixture_import (project_id, fixture_hash, fixture_version, owner_account_id, state, updated_at)
    VALUES (?, ?, ?, ?, 'IMPORTING', ?)`)
    .run(projectId, fixtureHash, fixture.manifest.fixtureVersion, ownerAccountId, clock);
  const ticket = db.prepare(`INSERT INTO ctx_fixture_ticket
      (project_id, task_code, marker, state, attempt_id, issue_id, issue_key, updated_at)
      VALUES (?, ?, ?, 'DONE', ?, ?, ?, ?)`);
  const jiraIssues = new Map<string, JiraWorkItem>();
  const workIssues = new Map<string, JiraWorkItem>();
  const issues = fixture.workPackages.map((work, index) => {
    const issue = {
      id: String(30_001 + index), key: `PED-${1001 + index}`, projectId: jiraProjectId, issueTypeId: '10012',
      summary: `Título Jira ${work.code}`, status: { id: '1', name: 'Pendiente', categoryKey: 'new' },
      assigneeAccountId: 'private-person-behind-jira', dueDate: null, updatedAt: observedAt, labels: [],
    } satisfies JiraWorkItem;
    jiraIssues.set(issue.id, issue);
    workIssues.set(work.code, issue);
    ticket.run(projectId, work.code, work.code.toLowerCase(), work.id, issue.id, issue.key, clock);
    return { taskCode: work.code, issueId: issue.id, issueKey: issue.key };
  });
  await persistPatagoniaFixture({ fixture, jiraProjectId, ownerAccountId, issues }, query);
  db.prepare("UPDATE ctx_project SET status = 'ACTIVE' WHERE id = ?").run(projectId);
  db.prepare("UPDATE ctx_fixture_import SET state = 'COMPLETE' WHERE project_id = ?").run(projectId);
  return { db, query, scope: makeScope(['VIEWER', 'HSE_READER'], jiraIssues), workIssues };
}

test('CT004-03: HSE denies list and detail before querying unless a project role and HSE clearance are both present', async () => {
  const noQuery: typeof executeSql = async () => assert.fail('A denied HSE request queried SQL');
  for (const roles of [[], ['VIEWER'], ['ADMIN'], ['HSE_READER']] satisfies ProjectRole[][]) {
    const scope = makeScope(roles);
    assert.equal(await listSummary('hse', scope, {}, noQuery), undefined);
    assert.equal(await readSummaryDetail('hse', scope, 'HSE-16', noQuery), undefined);
  }
});

test('HSE returns authorized sanitized synthetic categories, omitting live and unknown-severity incidents', async (t) => {
  const { db, query, scope } = await withPublishedFixture(t);
  const incident = fixture.incidents.find(({ code }) => code === 'HSE-18');
  const external = fixture.incidents.find(({ code }) => code === 'HSE-17');
  const unknown = fixture.incidents.find(({ code }) => code === 'HSE-16');
  assert.ok(incident && external && unknown);
  db.prepare("UPDATE ctx_incident SET jira_issue_key = 'PED-PRIVATE', jsm_request_type_id = 'secret-jsm-type' WHERE id = ?").run(external.id);
  db.prepare("UPDATE ctx_incident SET severity = 'UNKNOWN' WHERE id = ?").run(unknown.id);

  const result = await listSummary('hse', scope, { status: 'OPEN' }, query);
  assert.equal(result?.total, 1);
  assert.deepEqual(result?.rows.map(({ code }) => code), ['HSE-18']);
  assert.deepEqual(result?.highlights, [{ label: 'Abiertos visibles', value: '1' }]);
  assert.deepEqual(result?.sources.find(({ source }) => source === 'JSM'), {
    source: 'JSM', state: 'DISABLED', quality: null, observedAt: null,
    detail: 'Las solicitudes reales de JSM requieren una conexión y autorización verificadas.',
  });
  const detail = await readSummaryDetail('hse', scope, incident.code, query);
  assert.deepEqual(detail?.fields.map(({ label }) => label), ['Categoría', 'Severidad', 'Estado', 'Área', 'Fecha']);
  assert.deepEqual(detail?.links, []);
  assert.doesNotMatch(JSON.stringify({ result, detail }), /PED-PRIVATE|secret-jsm-type|private-person|UNKNOWN/);
  assert.equal(await readSummaryDetail('hse', scope, external.code, query), undefined);
  assert.equal(await readSummaryDetail('hse', scope, unknown.code, query), undefined);
});

test('Financial excludes restricted linked rows from details and totals and retains independent USD entries', async (t) => {
  const { query, scope, workIssues } = await withPublishedFixture(t);
  const mount = workIssues.get('WP-064');
  assert.ok(mount);
  const visible = await readSummaryDetail('financial', scope, 'REM-WP-064', query);
  assert.deepEqual(visible?.links, [{ kind: 'jira', label: 'Paquete de trabajo', issueKey: mount.key }]);

  const restrictedIssues = new Map(scope.jiraIssues);
  restrictedIssues.delete(mount.id);
  const restricted = { ...scope, roles: ['VIEWER'], jiraIssues: restrictedIssues } satisfies OperationsScope;
  const fullRemnant = await listSummary('financial', scope, { status: 'FIXED_REMAINING' }, query);
  const visibleRemnant = await listSummary('financial', restricted, { status: 'FIXED_REMAINING' }, query);
  assert.equal(visibleRemnant?.total, (fullRemnant?.total ?? 0) - 1);
  const allowedCents = fixture.costRecords
    .filter(({ kind, effectiveDate, recordCode }) => kind === 'FIXED_REMAINING' && effectiveDate <= asOf && recordCode !== 'REM-WP-064')
    .reduce((total, cost) => total + BigInt(cost.amountCents), 0n);
  const usd = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', currencyDisplay: 'code' });
  assert.deepEqual(visibleRemnant?.highlights, [{ label: 'Base remanente visible', value: usd.format(Number(allowedCents) / 100) }]);
  assert.equal((await listSummary('financial', restricted, { q: 'REM-WP-064' }, query))?.total, 0);
  assert.equal(await readSummaryDetail('financial', restricted, 'REM-WP-064', query), undefined);

  const independent = await listSummary('financial', { ...restricted, jiraIssues: new Map(), jiraState: 'UNAVAILABLE' }, { status: 'ACTUAL' }, query);
  assert.ok(independent && independent.total > 0);
  assert.equal(independent.sources.find(({ source }) => source === 'JIRA')?.state, 'UNAVAILABLE');
  assert.equal(independent.sources.find(({ source }) => source === 'FORGE')?.quality, 'SYNTHETIC');
  assert.equal(independent.highlights?.[0]?.label, 'Devengado visible');
});

test('Knowledge marks Confluence disabled independently and withholds A-17 documents when Jira gate is hidden', async (t) => {
  const { db, query, scope, workIssues } = await withPublishedFixture(t);
  const gate = workIssues.get('WP-048');
  assert.ok(gate);
  const publicKnowledge = await listSummary('knowledge', scope, {}, query);
  assert.equal(publicKnowledge?.sources.find(({ source }) => source === 'FORGE')?.state, 'READY');
  assert.deepEqual(publicKnowledge?.sources.find(({ source }) => source === 'CONFLUENCE'), {
    source: 'CONFLUENCE', state: 'DISABLED', quality: null, observedAt: null,
    detail: 'Las páginas reales requieren verificar el acceso en Confluence.',
  });
  const full = await readSummaryDetail('knowledge', scope, 'A17-AVISO', query);
  assert.equal(full?.fields.find(({ label }) => label === 'Referencia sintética')?.value?.includes('ETA original día 4'), true);
  assert.deepEqual(full?.links, [{ kind: 'jira', label: 'Ítem relacionado', issueKey: gate.key }]);

  const withoutGate = new Map(scope.jiraIssues);
  withoutGate.delete(gate.id);
  const restricted = { ...scope, jiraIssues: withoutGate, jiraState: 'PARTIAL' } as const;
  const safe = await listSummary('knowledge', restricted, {}, query);
  assert.equal(safe?.sources.find(({ source }) => source === 'CONFLUENCE')?.state, 'DISABLED');
  assert.doesNotMatch(JSON.stringify(safe), /A17-FICHA|A17-AVISO|EQ017-COMPATIBILIDAD|Ficha del kit A-17|Actualización de A-17/);
  for (const code of ['A17-FICHA', 'A17-AVISO', 'EQ017-COMPATIBILIDAD']) {
    assert.equal(await readSummaryDetail('knowledge', restricted, code, query), undefined);
  }
  assert.equal((await readSummaryDetail('knowledge', restricted, 'PLAN-BASE', query))?.title, 'Bases del plan');
  db.prepare("UPDATE ctx_fixture_import SET state = 'IMPORTING' WHERE project_id = ?").run(scope.projectId);
  assert.equal((await listSummary('knowledge', scope, {}, query))?.total, 0);
});
