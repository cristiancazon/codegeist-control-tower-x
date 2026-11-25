import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import type { Result } from '@forge/sql';
import { generatePatagoniaFixture, hashPatagoniaFixture } from '../../domain/fixtures/patagonia';
import { fixtureMigrations } from '../data/bootstrap/schema';
import type { JiraWorkItem } from '../data/jira/types';
import type { executeSql, SqlParameter } from '../data/sql/client';
import { persistPatagoniaFixture } from '../data/sql/patagonia';
import { modelMigrations } from '../data/sql/schema';
import { readOverviewAlert, readOverviewAlertSummary } from './alert';

const fixture = generatePatagoniaFixture();
const jiraProjectId = '10001';
const ownerAccountId = 'demo-owner';
const jiraByWorkCode = new Map(fixture.workPackages.map((work, index) => [work.code, {
  id: String(30_000 + index), projectId: jiraProjectId, key: `PED-${900 + index}`, summary: `Título actual Jira para ${work.code}`,
  issueTypeId: '10329', status: { id: '10000', name: 'To Do', categoryKey: 'new' },
  assigneeAccountId: null, dueDate: null, updatedAt: fixture.snapshot.collectedAt, labels: [],
} satisfies JiraWorkItem]));

function jiraFor(code: string): JiraWorkItem {
  const issue = jiraByWorkCode.get(code);
  assert.ok(issue);
  return issue;
}

async function withFixture(t: TestContext) {
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

  const query: typeof executeSql = async <Row>(statement: string, parameters: readonly SqlParameter[]): Promise<Result<Row>['rows']> => {
    const prepared = db.prepare(statement.replace(/ON DUPLICATE KEY UPDATE \w+ = \w+\.\w+/g, 'ON CONFLICT DO NOTHING')
      .replaceAll('UTC_TIMESTAMP(3)', `'2026-11-25 02:00:00.000'`));
    const values = parameters.map((value) => typeof value === 'boolean' ? Number(value) : value);
    if (statement.trimStart().startsWith('SELECT')) {
      return prepared.all(...values) as Result<Row>['rows'];
    }
    return { affectedRows: prepared.run(...values).changes } as Result<Row>['rows'];
  };

  const { id: projectId, code, name, timeZone, currency } = fixture.project;
  db.prepare(`INSERT INTO ctx_project (id, code, name, jira_project_id, jira_project_key, time_zone, currency, data_mode, status, version, updated_at)
    VALUES (?, ?, ?, ?, 'PED', ?, ?, 'DEMO', 'IMPORTING', 1, '2026-11-25 02:00:00.000')`)
    .run(projectId, code, name, jiraProjectId, timeZone, currency);
  db.prepare(`INSERT INTO ctx_fixture_import (project_id, fixture_hash, fixture_version, owner_account_id, state, updated_at)
    VALUES (?, ?, ?, ?, 'IMPORTING', '2026-11-25 02:00:00.000')`)
    .run(projectId, hashPatagoniaFixture(fixture), fixture.manifest.fixtureVersion, ownerAccountId);
  const insert = db.prepare(`INSERT INTO ctx_fixture_ticket
      (project_id, task_code, marker, state, attempt_id, issue_id, issue_key, updated_at)
      VALUES (?, ?, ?, 'DONE', ?, ?, ?, '2026-11-25 02:00:00.000')`);
  const issues = fixture.workPackages.map((task) => {
    const issue = jiraFor(task.code);
    insert.run(projectId, task.code, task.code.toLowerCase(), task.id, issue.id, issue.key);
    return { taskCode: task.code, issueId: issue.id, issueKey: issue.key };
  });
  await persistPatagoniaFixture({ fixture, jiraProjectId, ownerAccountId, issues }, query);
  db.prepare("UPDATE ctx_project SET status = 'ACTIVE' WHERE id = ?").run(projectId);

  const jiraIssues = [jiraFor('WP-048'), jiraFor('WP-064'), jiraFor('WP-083')];
  return { db, query, request: { projectId, filters: {}, jiraIssues } };
}

test('CT003-03: A-17 resolves the seeded graph with current Jira titles and published S1 snapshot input', async (t) => {
  const { request, query } = await withFixture(t);
  const summary = await readOverviewAlertSummary(request, query);
  assert.deepEqual(summary, {
    code: 'A-17', title: 'Demora del suministro A-17', severity: 'HIGH',
    baselineEta: '2026-11-28', currentEta: '2026-12-13', delayDays: 15,
  });
  const detail = await readOverviewAlert(request, query);
  assert.ok(detail);
  assert.equal(detail.asset?.code, 'EQ-017');
  assert.equal(detail.contractor?.code, 'CON-03');
  assert.deepEqual(detail.work, ['WP-048', 'WP-064', 'WP-083'].map((code) => ({
    code, title: jiraFor(code).summary, issueKey: jiraFor(code).key,
  })));
  assert.deepEqual(detail.simulationInput, {
    scenarioCode: 'S1', variable: 'SUPPLY_DELAY_DAYS', value: 15, snapshotId: fixture.snapshot.id, snapshotAsOf: '2026-11-24',
  });
});

test('the gate must be visible to this Jira actor and hidden edges cannot reveal downstream work', async (t) => {
  const { request, query } = await withFixture(t);
  await assert.doesNotReject(async () => assert.equal(await readOverviewAlert({ ...request, jiraIssues: [] }, query), undefined));
  const foreignGate = { ...jiraFor('WP-048'), projectId: '99999' };
  assert.equal(await readOverviewAlertSummary({ ...request, jiraIssues: [foreignGate, jiraFor('WP-064')] }, query), undefined);
  assert.equal(await readOverviewAlert({ ...request, projectId: 'other-project' }, query), undefined);

  const detail = await readOverviewAlert({ ...request, jiraIssues: [jiraFor('WP-048'), jiraFor('WP-083')] }, query);
  assert.deepEqual(detail?.work.map(({ code }) => code), ['WP-048']);
  assert.doesNotMatch(JSON.stringify(detail), /WP-064|WP-083/);
});

test('alert respects scoped relationships, the selected phase, and the observation date', async (t) => {
  const { request, query, db } = await withFixture(t);
  assert.ok(await readOverviewAlert({ ...request, filters: { phaseCode: 'PH-03', asOf: '2026-11-24' } }, query));
  assert.equal(await readOverviewAlert({ ...request, filters: { phaseCode: 'PH-04' } }, query), undefined);
  assert.equal(await readOverviewAlertSummary({ ...request, filters: { asOf: '2026-11-23' } }, query), undefined);

  db.prepare("UPDATE ctx_asset SET workspace_id = 'external-workspace' WHERE code = 'EQ-017'").run();
  db.prepare("UPDATE ctx_contractor SET assets_object_id = 'external-resource' WHERE code = 'CON-03'").run();
  const withoutUnverifiedSources = await readOverviewAlert(request, query);
  assert.equal(withoutUnverifiedSources?.asset, null);
  assert.equal(withoutUnverifiedSources?.contractor, null);
  db.prepare("UPDATE ctx_asset SET workspace_id = NULL WHERE code = 'EQ-017'").run();
  db.prepare("UPDATE ctx_contractor SET assets_object_id = NULL WHERE code = 'CON-03'").run();

  db.prepare("UPDATE ctx_dependency SET project_id = 'other-project' WHERE predecessor_id = (SELECT id FROM ctx_work_package WHERE code = 'WP-048')").run();
  db.prepare("UPDATE ctx_asset SET project_id = 'other-project' WHERE code = 'EQ-017'").run();
  db.prepare("UPDATE ctx_contractor SET project_id = 'other-project' WHERE code = 'CON-03'").run();
  const scoped = await readOverviewAlert(request, query);
  assert.ok(scoped);
  assert.equal(scoped.asset, null);
  assert.equal(scoped.contractor, null);
  assert.deepEqual(scoped.work.map(({ code }) => code), ['WP-048']);

  db.prepare("UPDATE ctx_shipment SET updated_at = '2026-11-24 14:00:01.000' WHERE code = 'A-17'").run();
  assert.equal(await readOverviewAlertSummary({ ...request, filters: { asOf: '2026-11-24' } }, query), undefined);
  assert.equal((await readOverviewAlert(request, query))?.simulationInput, null);
  db.prepare("UPDATE ctx_shipment SET arrived_date = '2026-12-13' WHERE code = 'A-17'").run();
  assert.equal(await readOverviewAlert(request, query), undefined);
});

test('absent scoped edges or assignment preserve the alert and suppress only unproven work', async (t) => {
  const { request, query, db } = await withFixture(t);
  db.prepare(`UPDATE ctx_dependency SET tombstoned_at = '2026-11-25 01:00:00.000'
              WHERE project_id = ? AND successor_id = (SELECT id FROM ctx_work_package WHERE project_id = ? AND code = 'WP-083')`)
    .run(request.projectId, request.projectId);
  const withoutCommission = await readOverviewAlert(request, query);
  assert.deepEqual(withoutCommission?.work.map(({ code }) => code), ['WP-048', 'WP-064']);

  db.prepare(`DELETE FROM ctx_work_resource WHERE project_id = ? AND resource_kind = 'ASSET'
              AND work_package_id = (SELECT id FROM ctx_work_package WHERE project_id = ? AND code = 'WP-064')`)
    .run(request.projectId, request.projectId);
  const withoutAssignment = await readOverviewAlert(request, query);
  assert.equal(withoutAssignment?.asset?.code, 'EQ-017');
  assert.equal(withoutAssignment?.contractor?.code, 'CON-03');
  assert.deepEqual(withoutAssignment?.work.map(({ code }) => code), ['WP-048']);
});

test('unavailable or inconsistent S1 evidence never becomes a handoff', async (t) => {
  const { request, query, db } = await withFixture(t);
  const s1 = fixture.scenarios.find(({ code }) => code === 'S1');
  assert.ok(s1);
  const setValue = db.prepare('UPDATE ctx_scenario_variable SET value_jcs = ? WHERE scenario_id = ?');
  for (const value of ['"15"', '14', '-15', '15.5', '366', 'invalid']) {
    setValue.run(value, s1.id);
    assert.equal((await readOverviewAlert(request, query))?.simulationInput, null);
  }
  setValue.run('15', s1.id);
  db.prepare("UPDATE ctx_scenario SET state = 'DRAFT' WHERE id = ?").run(s1.id);
  assert.equal((await readOverviewAlert(request, query))?.simulationInput, null);
  db.prepare("UPDATE ctx_scenario SET state = 'PUBLISHED' WHERE id = ?").run(s1.id);

  db.prepare(`INSERT INTO ctx_data_snapshot
     (id, project_id, state, schema_version, as_of_date, collected_at, sealed_at, expires_at, created_by,
      access_class, chunk_count, content_hash, source_manifest_jcs, quality_jcs)
     SELECT ?, project_id, state, schema_version, '2026-11-25', '2026-11-25 01:00:00.000', sealed_at, expires_at, created_by,
      access_class, chunk_count, ?, source_manifest_jcs, quality_jcs
     FROM ctx_data_snapshot WHERE project_id = ? AND id = ?`)
    .run('newer-snapshot', 'a'.repeat(64), request.projectId, fixture.snapshot.id);
  assert.equal((await readOverviewAlert(request, query))?.simulationInput, null);
  const originalCut = await readOverviewAlert({ ...request, filters: { asOf: fixture.snapshot.asOfDate } }, query);
  assert.equal(originalCut?.simulationInput?.snapshotId, fixture.snapshot.id);

  db.prepare("UPDATE ctx_data_snapshot SET expires_at = '2026-11-25 01:00:00.000' WHERE id = ?").run(fixture.snapshot.id);
  assert.equal((await readOverviewAlert(request, query))?.simulationInput, null);
  assert.equal(await readOverviewAlertSummary({ ...request, filters: { asOf: fixture.snapshot.asOfDate } }, query), undefined);
});
