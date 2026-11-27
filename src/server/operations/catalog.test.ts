import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import type { Result } from '@forge/sql';
import { generatePatagoniaFixture, hashPatagoniaFixture } from '../../domain/fixtures/patagonia';
import { OPERATIONS_PAGE_SIZE, type OperationsDetail } from '../../shared/operations';
import { fixtureMarker, type JiraWorkItem } from '../data/jira';
import { fixtureMigrations } from '../data/bootstrap/schema';
import type { executeSql, SqlParameter } from '../data/sql/client';
import { persistPatagoniaFixture } from '../data/sql/patagonia';
import { modelMigrations } from '../data/sql/schema';
import { listCatalog, readCatalogDetail } from './catalog';
import type { OperationsScope } from './scope';

const fixture = generatePatagoniaFixture();
const projectId = fixture.project.id;
const jiraProjectId = '10000';
const ownerAccountId = 'demo-owner';

async function withCatalog(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  for (const [, ddl] of [...modelMigrations, ...fixtureMigrations]) {
    const table = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(ddl)?.[1];
    assert.ok(table);
    const indexes = Array.from(ddl.matchAll(/^\s+(UNIQUE )?KEY (\w+) \(([^)]+)\),?$/gm));
    db.exec(ddl.replace(/^\s+(?:UNIQUE )?KEY .+$/gm, '')
      .replace(/,\s*\)(?: DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin)?\s*$/, ')')
      .replace(/ DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin\s*$/, ''));
    for (const [, unique = '', name, columns] of indexes) {
      db.exec(`CREATE ${unique}INDEX ${name} ON ${table} (${columns})`);
    }
  }
  const now = new Date();
  const sqlNow = now.toISOString().slice(0, 23).replace('T', ' ');
  const query: typeof executeSql = async <Row>(statement: string, parameters: readonly SqlParameter[]): Promise<Result<Row>['rows']> => {
    const prepared = db.prepare(statement
      .replace(/ON DUPLICATE KEY UPDATE \w+ = \w+\.\w+/g, 'ON CONFLICT DO NOTHING')
      .replaceAll('UTC_TIMESTAMP(3)', `'${sqlNow}'`));
    const bound = parameters.map((value) => typeof value === 'boolean' ? Number(value) : value);
    if (statement.trimStart().startsWith('SELECT')) {
      return prepared.all(...bound) as Result<Row>['rows'];
    }
    return { affectedRows: prepared.run(...bound).changes } as Result<Row>['rows'];
  };

  const project = fixture.project;
  db.prepare(`INSERT INTO ctx_project (id, code, name, jira_project_id, jira_project_key, time_zone, currency,
              data_mode, status, version, updated_at) VALUES (?, ?, ?, ?, 'PED', ?, 'USD', 'DEMO', 'IMPORTING', 1, ?)`)
    .run(projectId, project.code, project.name, jiraProjectId, project.timeZone, sqlNow);
  db.prepare(`INSERT INTO ctx_fixture_import (project_id, fixture_hash, fixture_version, owner_account_id, state, updated_at)
              VALUES (?, ?, ?, ?, 'IMPORTING', ?)`)
    .run(projectId, hashPatagoniaFixture(fixture), fixture.manifest.fixtureVersion, ownerAccountId, sqlNow);
  const addTicket = db.prepare(`INSERT INTO ctx_fixture_ticket (project_id, task_code, marker, state, attempt_id, issue_id, issue_key, updated_at)
                              VALUES (?, ?, ?, 'DONE', ?, ?, ?, ?)`);
  const jiraIssues = new Map<string, JiraWorkItem>();
  const issues = fixture.workPackages.map((task, index) => {
    const issueId = String(20_000 + index);
    const issueKey = `PED-${index + 1}`;
    const marker = fixtureMarker(task.code);
    addTicket.run(projectId, task.code, marker, task.id, issueId, issueKey, sqlNow);
    jiraIssues.set(issueId, {
      id: issueId, key: issueKey, projectId: jiraProjectId, issueTypeId: '10001', summary: task.title,
      status: { id: '1', name: task.status === 'DONE' ? 'Finalizada' : 'Pendiente', categoryKey: task.status === 'DONE' ? 'done' : 'new' },
      assigneeAccountId: null, dueDate: task.plannedFinish, updatedAt: now.toISOString(), labels: [marker],
    });
    return { taskCode: task.code, issueId, issueKey };
  });
  await persistPatagoniaFixture({ fixture, jiraProjectId, ownerAccountId, issues }, query);
  db.prepare("UPDATE ctx_project SET status = 'ACTIVE' WHERE id = ?").run(projectId);

  const scope: OperationsScope = {
    projectId, jiraProjectId, roles: ['VIEWER'], snapshot: { asOf: fixture.snapshot.asOfDate, collectedAt: fixture.snapshot.collectedAt },
    observedAt: now.toISOString(), jiraIssues, jiraState: 'READY',
  };
  return { db, query, scope, issues };
}

function fieldValue(detail: OperationsDetail, label: string) {
  return detail.fields.find((field) => field.label === label)?.value;
}

function linkedCodes(detail: OperationsDetail, section: 'work' | 'assets' | 'logistics' | 'contractors') {
  return detail.links.flatMap((link) => link.kind === 'record' && link.section === section ? [link.code] : []);
}

test('CT004-02: pagina los 80 activos y conserva la separación del conector Assets', async (t) => {
  const { db, query, scope } = await withCatalog(t);
  const addAsset = db.prepare(`INSERT INTO ctx_asset
    (id, project_id, code, name, asset_type, status, source_updated_at, version, workspace_id, assets_object_id)
    VALUES (?, ?, ?, ?, 'Izaje', 'AVAILABLE', '2026-11-24 14:00:00.000', 1, ?, ?)`);
  addAsset.run('external', projectId, 'EQ-801', 'Activo externo restringido', 'external-workspace', 'external-id');
  addAsset.run('foreign', 'foreign-project', 'EQ-802', 'Activo de otro proyecto', null, null);

  const pages = await Promise.all([1, 2, 3, 4, 5].map((page) => listCatalog('assets', scope, { page }, query)));
  assert.deepEqual(pages.map(({ total }) => total), [80, 80, 80, 80, 80]);
  assert.deepEqual(pages.map(({ rows }) => rows.length), [OPERATIONS_PAGE_SIZE, OPERATIONS_PAGE_SIZE, OPERATIONS_PAGE_SIZE, OPERATIONS_PAGE_SIZE, 0]);
  const ids = pages.flatMap(({ rows }) => rows.map(({ code }) => code));
  assert.equal(new Set(ids).size, 80);
  assert.equal(ids[0], 'EQ-001');
  assert.equal(ids.at(-1), 'EQ-080');
  assert.deepEqual(pages[0]?.sources.map(({ source, state, quality }) => [source, state, quality]),
    [['FORGE', 'READY', 'SYNTHETIC'], ['JIRA', 'READY', 'LIVE'], ['ASSETS', 'DISABLED', null]]);

  const filtered = await listCatalog('assets', scope, { q: ' EQ-017 ', facilityCode: 'FAC-05', status: 'MAINTENANCE', category: 'Izaje' }, query);
  assert.deepEqual(filtered.rows.map(({ code }) => code), ['EQ-017']);
  assert.equal(await readCatalogDetail('assets', scope, 'EQ-801', query), undefined);
  assert.equal(await readCatalogDetail('assets', scope, 'EQ-802', query), undefined);
});

test('CT004-02: recorre A-17, su activo y la alternativa persistida sin afirmar un incumplimiento', async (t) => {
  const { db, query, scope } = await withCatalog(t);
  const narrowed = await listCatalog('logistics', scope, {
    q: 'A-17', phaseCode: 'PH-03', status: 'RISK', contractorCode: 'CON-03', from: '2026-12-13', to: '2026-12-13',
  }, query);
  assert.equal(narrowed.total, 1);
  assert.deepEqual(narrowed.rows.map(({ code, issueKey }) => [code, issueKey]), [['A-17', 'PED-48']]);
  assert.deepEqual((await listCatalog('logistics', scope, { q: 'A-17', to: '2026-12-12' }, query)).rows, []);

  const shipment = await readCatalogDetail('logistics', scope, 'A-17', query);
  assert.ok(shipment);
  assert.equal(fieldValue(shipment, 'ETA original'), '2026-11-28');
  assert.equal(fieldValue(shipment, 'ETA vigente'), '2026-12-13');
  assert.equal(fieldValue(shipment, 'Arribo observado'), null);
  assert.equal(fieldValue(shipment, 'Estado al corte'), 'Riesgo por cambio de ETA');
  assert.equal(fieldValue(shipment, 'Cantidad'), '1 KIT');
  assert.deepEqual(linkedCodes(shipment, 'assets'), ['EQ-017']);
  assert.deepEqual(linkedCodes(shipment, 'work'), ['WP-048', 'WP-064', 'WP-083']);
  assert.deepEqual(linkedCodes(shipment, 'contractors'), ['CON-03', 'CON-08']);
  assert.match(JSON.stringify(shipment.groups), /Hipótesis de proveedor alternativo/);
  assert.match(JSON.stringify(shipment.groups), /\+5 días/);

  const equipment = await readCatalogDetail('assets', scope, 'EQ-017', query);
  assert.ok(equipment);
  assert.deepEqual(equipment.groups?.find(({ label }) => label === 'Mantenimiento')?.fields.map(({ value }) => value),
    ['2026-11-24', '2026-11-30', '0']);
  assert.deepEqual(linkedCodes(equipment, 'logistics'), ['A-17']);
  assert.deepEqual(linkedCodes(equipment, 'work'), ['WP-064']);

  const supplier = await readCatalogDetail('contractors', scope, 'CON-03', query);
  assert.ok(supplier);
  assert.equal(fieldValue(supplier, 'Compromisos en riesgo visibles'), '1');
  assert.equal(fieldValue(supplier, 'Incumplimientos observados visibles'), '0');
  const otherPhase = await listCatalog('contractors', scope, { q: 'CON-03', phaseCode: 'PH-04' }, query);
  assert.deepEqual(otherPhase.rows.map(({ code }) => code), ['CON-03']);
  assert.deepEqual(otherPhase.rows[0]?.cells.slice(3), [null, null]);
  const alternative = await readCatalogDetail('contractors', scope, 'CON-08', query);
  assert.ok(alternative);
  assert.ok(linkedCodes(alternative, 'logistics').includes('A-17'));
  assert.ok(alternative.groups?.some(({ label }) => label.startsWith('S2')));

  db.prepare("UPDATE ctx_scenario SET state = 'DRAFT' WHERE project_id = ? AND idempotency_key = ?")
    .run(projectId, `${fixture.manifest.fixtureVersion}:S2`);
  const withoutPublishedScenario = await readCatalogDetail('logistics', scope, 'A-17', query);
  assert.ok(withoutPublishedScenario);
  assert.deepEqual(linkedCodes(withoutPublishedScenario, 'contractors'), ['CON-03']);
  assert.deepEqual(withoutPublishedScenario.groups, []);
});

test('CT004-02: una recepción realmente vencida y un arribo tardío se clasifican por separado', async (t) => {
  const { db, query, scope } = await withCatalog(t);
  db.prepare("UPDATE ctx_shipment SET arrived_date = NULL WHERE project_id = ? AND code = 'A-01'").run(projectId);
  db.prepare("UPDATE ctx_shipment SET arrived_date = '2026-11-23' WHERE project_id = ? AND code = 'A-02'").run(projectId);
  const overdue = await listCatalog('logistics', scope, { status: 'OVERDUE' }, query);
  const late = await listCatalog('logistics', scope, { status: 'DELIVERED_LATE' }, query);
  assert.deepEqual(overdue.rows.map(({ code }) => code), ['A-01']);
  assert.deepEqual(late.rows.map(({ code }) => code), ['A-02']);

  db.prepare("UPDATE ctx_shipment SET updated_at = '2026-11-24 14:00:00.001' WHERE project_id = ? AND code = 'A-17'").run(projectId);
  assert.equal(await readCatalogDetail('logistics', scope, 'A-17', query), undefined);
});

test('CT004-04: revocar Jira oculta recepciones y relaciones sin esconder el catálogo sintético', async (t) => {
  const { query, scope, issues } = await withCatalog(t);
  const gate = issues.find(({ taskCode }) => taskCode === 'WP-048');
  const mount = issues.find(({ taskCode }) => taskCode === 'WP-064');
  assert.ok(gate && mount);
  const jiraIssues = new Map(scope.jiraIssues);
  jiraIssues.delete(mount.issueId);
  const restricted: OperationsScope = { ...scope, jiraIssues, jiraState: 'PARTIAL' };

  const visibleGate = await readCatalogDetail('logistics', restricted, 'A-17', query);
  assert.ok(visibleGate);
  assert.deepEqual(linkedCodes(visibleGate, 'work'), ['WP-048']);
  assert.doesNotMatch(JSON.stringify(visibleGate), /WP-064|WP-083|PED-(64|83)/);

  jiraIssues.delete(gate.issueId);
  assert.equal(await readCatalogDetail('logistics', restricted, 'A-17', query), undefined);
  const rawCatalog = await readCatalogDetail('assets', restricted, 'EQ-017', query);
  assert.ok(rawCatalog);
  assert.doesNotMatch(JSON.stringify(rawCatalog), /A-17|WP-064|WP-083/);
  const alternative = await readCatalogDetail('contractors', restricted, 'CON-08', query);
  assert.ok(alternative);
  assert.doesNotMatch(JSON.stringify(alternative), /A-17|Hipótesis de proveedor alternativo/);

  const denied: OperationsScope = { ...scope, jiraState: 'UNAVAILABLE' };
  const logistics = await listCatalog('logistics', denied, {}, query);
  assert.equal(logistics.total, 0);
  assert.equal(logistics.sources.find(({ source }) => source === 'JIRA')?.state, 'UNAVAILABLE');
  assert.equal((await listCatalog('assets', denied, {}, query)).total, 80);
});

test('CT004-02: la lista de unidades muestra bloqueos visibles y productividad no disponible', async (t) => {
  const { query, scope } = await withCatalog(t);
  const facilities = await listCatalog('operations', scope, {}, query);
  assert.equal(facilities.total, 8);
  const main = facilities.rows.find(({ code }) => code === 'FAC-05');
  assert.equal(main?.cells[3], '1');
  assert.equal(main?.cells[4], null);
  const detail = await readCatalogDetail('operations', scope, 'FAC-05', query);
  assert.ok(detail);
  assert.equal(fieldValue(detail, 'Productividad por unidad'), null);
  assert.ok(linkedCodes(detail, 'assets').includes('EQ-017'));
  assert.ok(linkedCodes(detail, 'logistics').includes('A-17'));

  const notReady: OperationsScope = { ...scope, snapshot: null };
  const unavailableQuery: typeof executeSql = async () => assert.fail('An unavailable snapshot should not issue catalog queries');
  const unavailable = await listCatalog('operations', notReady, {}, unavailableQuery);
  assert.deepEqual(unavailable.rows, []);
  assert.equal(unavailable.sources.find(({ source }) => source === 'FORGE')?.state, 'UNAVAILABLE');
  assert.equal(await readCatalogDetail('operations', notReady, 'FAC-05', unavailableQuery), undefined);
});
