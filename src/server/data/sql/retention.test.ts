import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import type { Result } from '@forge/sql';
import { generatePatagoniaFixture, hashPatagoniaFixture } from '../../../domain/fixtures/patagonia';
import { fixtureMigrations } from '../bootstrap/schema';
import type { executeSql, SqlParameter } from './client';
import { persistPatagoniaFixture } from './patagonia';
import { getProjectAccess } from './projects';
import { modelMigrations } from './schema';

const fixture = generatePatagoniaFixture();
const actor = 'acct-test-viewer';
const jiraProjectId = '10001';

function openInstallation(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  for (const [, ddl] of [...modelMigrations, ...fixtureMigrations]) {
    // This local test exercises the flow, using SQLite instead of Forge's MySQL dialect.
    db.exec(ddl.replace(/^\s+(?:UNIQUE )?KEY .+$/gm, '')
      .replace(/ DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin\s*$/, '')
      .replace(/,\s*\)\s*$/, ')'));
  }
  db.function('fixture_test_utc_now', () => new Date().toISOString().slice(0, 23).replace('T', ' '));
  const query: typeof executeSql = async <Row>(statement: string, params: readonly SqlParameter[]): Promise<Result<Row>['rows']> => {
    const command = db.prepare(statement
      .replace(/ON DUPLICATE KEY UPDATE \w+ = \w+\.\w+/g, 'ON CONFLICT DO NOTHING')
      .replaceAll('UTC_TIMESTAMP(3)', 'fixture_test_utc_now()'));
    const values = params.map((param) => typeof param === 'boolean' ? Number(param) : param);
    if (statement.startsWith('SELECT')) {
      return command.all(...values) as Result<Row>['rows'];
    }
    return { affectedRows: command.run(...values).changes } as Result<Row>['rows'];
  };
  return { db, query };
}

function registerProject(
  db: DatabaseSync, id: string, code: string, remoteId: string, status: 'ACTIVE' | 'IMPORTING',
) {
  db.prepare(`INSERT INTO ctx_project (id, code, name, jira_project_id, jira_project_key,
      time_zone, currency, data_mode, status, version, updated_at)
      VALUES (?, ?, ?, ?, ?, 'America/Argentina/Buenos_Aires', 'USD', 'DEMO', ?, 1, fixture_test_utc_now())`)
    .run(id, code, code, remoteId, code, status);
}

test('CT002-05: project access excludes foreign projects, revoked roles, and another installation', async (t) => {
  const primary = openInstallation(t);
  const secondary = openInstallation(t);
  const projectId = fixture.project.id;
  const foreignProjectId = '3682aa74-6d9e-4a47-af59-21ff8992a752';

  registerProject(primary.db, projectId, 'PED', jiraProjectId, 'ACTIVE');
  registerProject(primary.db, foreignProjectId, 'OTHER', '10002', 'ACTIVE');
  registerProject(secondary.db, projectId, 'PED', jiraProjectId, 'ACTIVE');
  primary.db.prepare(`INSERT INTO ctx_project_role (project_id, account_id, role_code, granted_by, granted_at)
    VALUES (?, ?, 'VIEWER', 'test-admin', fixture_test_utc_now())`).run(projectId, actor);

  assert.deepEqual(await getProjectAccess(jiraProjectId, actor, primary.query), { projectId, roles: ['VIEWER'] });
  assert.equal(await getProjectAccess('10002', actor, primary.query), undefined);
  assert.equal(await getProjectAccess(jiraProjectId, actor, secondary.query), undefined);

  primary.db.prepare(`UPDATE ctx_project_role SET revoked_at = fixture_test_utc_now()
    WHERE project_id = ? AND account_id = ? AND role_code = 'VIEWER'`).run(projectId, actor);
  assert.equal(await getProjectAccess(jiraProjectId, actor, primary.query), undefined);
});

test('CT002-05: a snapshot expires at the 180-day boundary while retaining scenario references', async (t) => {
  const createdAt = Date.parse('2026-11-25T03:15:27.150Z');
  const expiresAt = Date.parse('2027-05-24T03:15:27.150Z');
  t.mock.timers.enable({ apis: ['Date'], now: createdAt });

  const { db, query } = openInstallation(t);
  const { id: projectId } = fixture.project;
  registerProject(db, projectId, 'PED', jiraProjectId, 'IMPORTING');
  db.prepare(`INSERT INTO ctx_fixture_import (project_id, fixture_hash, fixture_version, owner_account_id, state, updated_at)
    VALUES (?, ?, ?, ?, 'IMPORTING', fixture_test_utc_now())`)
    .run(projectId, hashPatagoniaFixture(fixture), fixture.manifest.fixtureVersion, actor);
  const insertTicket = db.prepare(`INSERT INTO ctx_fixture_ticket
    (project_id, task_code, marker, state, attempt_id, issue_id, issue_key, updated_at)
    VALUES (?, ?, ?, 'DONE', ?, ?, ?, fixture_test_utc_now())`);
  const issues = fixture.workPackages.map((task, index) => {
    const issue = { taskCode: task.code, issueId: String(20_000 + index), issueKey: `PED-${index + 1}` };
    insertTicket.run(projectId, task.code, `fixture-${task.code}`, task.id, issue.issueId, issue.issueKey);
    return issue;
  });

  const input = { fixture, jiraProjectId, ownerAccountId: actor, issues };
  await persistPatagoniaFixture(input, query);
  const readSnapshot = db.prepare('SELECT state, expires_at, content_hash, chunk_count FROM ctx_data_snapshot WHERE id = ?');
  const snapshot = readSnapshot.get(fixture.snapshot.id);
  assert.equal(snapshot?.expires_at, '2027-05-24 03:15:27.150');
  assert.equal(snapshot.state, 'SEALED');

  t.mock.timers.setTime(expiresAt - 1);
  await persistPatagoniaFixture(input, query);
  t.mock.timers.setTime(expiresAt);
  await assert.rejects(persistPatagoniaFixture(input, query), /snapshot could not be sealed/);

  assert.deepEqual(readSnapshot.get(fixture.snapshot.id), snapshot);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM ctx_snapshot_chunk WHERE snapshot_id = ?').get(fixture.snapshot.id)?.total,
    snapshot.chunk_count);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM ctx_scenario WHERE snapshot_id = ?').get(fixture.snapshot.id)?.total,
    fixture.scenarios.length);
});
