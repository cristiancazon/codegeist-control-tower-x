import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { Result } from '@forge/sql';
import { generatePatagoniaFixture, hashPatagoniaFixture } from '../../../domain/fixtures/patagonia';
import { fixtureMigrations } from '../bootstrap/schema';
import { activateProject, claimTicket, pauseTicket, recordTicketIdentity } from '../bootstrap/store';
import type { executeSql, SqlParameter } from './client';
import { persistPatagoniaFixture } from './patagonia';
import { modelMigrations } from './schema';

function initializeDatabase() {
  const db = new DatabaseSync(':memory:');
  for (const [, ddl] of [...modelMigrations, ...fixtureMigrations]) {
    // Translate only dialect-specific index and collation declarations for the local persistence test.
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
  return db;
}

const fixture = generatePatagoniaFixture();
const ownerAccountId = 'demo-owner';
const jiraProjectId = '10000';
const issues = fixture.workPackages.map((task, index) => ({
  taskCode: task.code, issueId: String(20_000 + index), issueKey: `PED-${index + 1}`,
}));

function reserveImport(db: DatabaseSync) {
  const project = fixture.project;
  db.prepare(`INSERT INTO ctx_project
      (id, code, name, jira_project_id, jira_project_key, time_zone, currency, data_mode, status, version, updated_at)
      VALUES (?, ?, ?, ?, 'PED', ?, ?, 'DEMO', 'IMPORTING', 1, '2026-11-25 00:00:00.000')`)
    .run(project.id, project.code, project.name, jiraProjectId, project.timeZone, project.currency);
  db.prepare(`INSERT INTO ctx_fixture_import
      (project_id, fixture_hash, fixture_version, owner_account_id, state, updated_at)
      VALUES (?, ?, ?, ?, 'IMPORTING', '2026-11-25 00:00:00.000')`)
    .run(project.id, hashPatagoniaFixture(fixture), fixture.manifest.fixtureVersion, ownerAccountId);
  const insertTicket = db.prepare(`INSERT INTO ctx_fixture_ticket
      (project_id, task_code, marker, state, attempt_id, issue_id, issue_key, updated_at)
      VALUES (?, ?, ?, 'DONE', ?, ?, ?, '2026-11-25 00:00:00.000')`);
  for (const [index, issue] of issues.entries()) {
    insertTicket.run(project.id, issue.taskCode, issue.taskCode.toLowerCase(),
      fixture.workPackages[index]!.id, issue.issueId, issue.issueKey);
  }
}

function localExecute(
  db: DatabaseSync, intercept: (statement: string) => void = () => {}, now = '2026-11-25 00:00:00.000',
): typeof executeSql {
  return async <Row>(statement: string, parameters: readonly SqlParameter[]): Promise<Result<Row>['rows']> => {
    intercept(statement);
    const prepared = db.prepare(statement
      .replace(/ON DUPLICATE KEY UPDATE \w+ = \w+\.\w+/g, 'ON CONFLICT DO NOTHING')
      .replaceAll('TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))', "strftime('%Y-%m-%d %H:%M:%f', UTC_TIMESTAMP(3), ? || ' seconds')")
      .replaceAll('UTC_TIMESTAMP(3)', `'${now}'`));
    const values = parameters.map((value) => typeof value === 'boolean' ? Number(value) : value);
    if (statement.trimStart().startsWith('SELECT')) {
      return prepared.all(...values) as Result<Row>['rows'];
    }
    return { affectedRows: prepared.run(...values).changes } as Result<Row>['rows'];
  };
}

test('materializes the confirmed fixture after an interrupted attempt and replays idempotently', async () => {
  const db = initializeDatabase();
  try {
    reserveImport(db);
    const input = { fixture, ownerAccountId, jiraProjectId, issues };
    const interrupted = localExecute(db, (statement) => {
      if (statement.includes('INSERT INTO ctx_historical_metric')) {
        throw new Error('simulated interruption');
      }
    });
    await assert.rejects(persistPatagoniaFixture(input, interrupted), /simulated interruption/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ctx_work_package').get()?.count, 120);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ctx_data_snapshot').get()?.count, 0);

    const execute = localExecute(db);
    await persistPatagoniaFixture(input, execute);
    await persistPatagoniaFixture(input, execute);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ctx_work_package').get()?.count, 120);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ctx_asset').get()?.count, 80);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ctx_source_mapping').get()?.count, 120);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ctx_historical_metric').get()?.count, 144);
    const snapshot = db.prepare('SELECT state, chunk_count FROM ctx_data_snapshot').get();
    assert.equal(snapshot?.state, 'SEALED');
    const chunks = db.prepare('SELECT payload_jcs FROM ctx_snapshot_chunk ORDER BY chunk_index').all();
    assert.equal(chunks.length, snapshot.chunk_count);
    assert.ok(chunks.every(({ payload_jcs: payload }) => typeof payload === 'string' &&
      Buffer.byteLength(payload) <= 128 * 1024 && !['incidents', 'knowledge'].includes(JSON.parse(payload).section)));
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ctx_scenario WHERE state = 'PUBLISHED'`).get()?.count, 5);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ctx_scenario_variable').get()?.count, 5);
    assert.equal(db.prepare('SELECT status FROM ctx_project').get()?.status, 'IMPORTING');
  } finally {
    db.close();
  }
});

test('rejects a different project and a conflicting Jira mapping before writing rows', async () => {
  const db = initializeDatabase();
  try {
    reserveImport(db);
    const execute = localExecute(db, (statement) => assert.match(statement, /^SELECT/));
    const input = { fixture, ownerAccountId, jiraProjectId, issues };
    await assert.rejects(persistPatagoniaFixture({ ...input, jiraProjectId: '10001' }, execute), /reserved project scope/);
    await assert.rejects(persistPatagoniaFixture({ ...input,
      issues: [{ ...issues[0]!, issueId: '90000' }, ...issues.slice(1)],
    }, execute), /does not match the import journal/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ctx_work_package').get()?.count, 0);
  } finally {
    db.close();
  }
});

test('activation requires the bound Jira project, owner and hash, and finishes an interrupted activation', async () => {
  const db = initializeDatabase();
  try {
    reserveImport(db);
    const projectId = fixture.project.id;
    const hash = hashPatagoniaFixture(fixture);
    const execute = localExecute(db);
    const states = () => ({
      project: db.prepare('SELECT status FROM ctx_project').get()?.status,
      import: db.prepare('SELECT state FROM ctx_fixture_import').get()?.state,
    });

    for (const [project, actor, fixtureHash] of [
      ['90000', ownerAccountId, hash],
      [jiraProjectId, 'wrong-owner', hash],
      [jiraProjectId, ownerAccountId, 'wrong-hash'],
    ] as const) {
      await assert.rejects(activateProject(projectId, project, actor, fixtureHash, execute), /verified final states/);
      assert.deepEqual(states(), { project: 'IMPORTING', import: 'IMPORTING' });
    }

    const interrupted = localExecute(db, (statement) => {
      if (statement.startsWith('UPDATE ctx_fixture_import')) {
        throw new Error('simulated interruption before import completion');
      }
    });
    await assert.rejects(activateProject(projectId, jiraProjectId, ownerAccountId, hash, interrupted), /simulated interruption/);
    assert.deepEqual(states(), { project: 'ACTIVE', import: 'IMPORTING' });
    await activateProject(projectId, jiraProjectId, ownerAccountId, hash, execute);
    await activateProject(projectId, jiraProjectId, ownerAccountId, hash, execute);
    assert.deepEqual(states(), { project: 'ACTIVE', import: 'COMPLETE' });
  } finally {
    db.close();
  }
});

test('a Jira identity can complete only its owned ticket and cannot be mapped to another ticket', async () => {
  const db = initializeDatabase();
  try {
    reserveImport(db);
    const projectId = fixture.project.id;
    const firstTask = fixture.workPackages[0]!;
    const secondTask = fixture.workPackages[1]!;
    const firstIssue = issues[0]!;
    const secondIssue = issues[1]!;
    const execute = localExecute(db);
    db.prepare(`UPDATE ctx_fixture_ticket SET state = 'CREATING', issue_id = NULL, issue_key = NULL
                WHERE project_id = ? AND task_code IN (?, ?)`).run(projectId, firstTask.code, secondTask.code);

    const identity = { id: firstIssue.issueId, key: firstIssue.issueKey };
    await assert.rejects(recordTicketIdentity(projectId, firstTask.code, 'wrong-attempt', identity, execute), /reserved ticket/);
    await recordTicketIdentity(projectId, firstTask.code, firstTask.id, identity, execute);
    await recordTicketIdentity(projectId, firstTask.code, firstTask.id, identity, execute);
    await assert.rejects(recordTicketIdentity(projectId, secondTask.code, secondTask.id, identity, execute), /UNIQUE constraint failed/);
    const waiting = db.prepare('SELECT state, issue_id FROM ctx_fixture_ticket WHERE project_id = ? AND task_code = ?')
      .get(projectId, secondTask.code);
    assert.equal(waiting?.state, 'CREATING');
    assert.equal(waiting?.issue_id, null);
    await recordTicketIdentity(projectId, secondTask.code, secondTask.id, { id: secondIssue.issueId, key: secondIssue.issueKey }, execute);
    const mapped = db.prepare('SELECT COUNT(DISTINCT issue_id) AS count FROM ctx_fixture_ticket WHERE project_id = ?').get(projectId);
    assert.equal(mapped?.count, issues.length);
  } finally {
    db.close();
  }
});

test('a retry waits for the durable UTC deadline and claims atomically at expiry', async () => {
  const db = initializeDatabase();
  try {
    reserveImport(db);
    const projectId = fixture.project.id;
    const task = fixture.workPackages[0]!;
    const ticket = () => db.prepare('SELECT state, attempt_id, retry_not_before FROM ctx_fixture_ticket WHERE project_id = ? AND task_code = ?')
      .get(projectId, task.code);
    const marker = task.code.toLowerCase();
    const executeAt = (now: string) => localExecute(db, undefined, now);
    db.prepare(`UPDATE ctx_fixture_ticket SET state = 'CREATING', issue_id = NULL, issue_key = NULL
                WHERE project_id = ? AND task_code = ?`).run(projectId, task.code);

    await pauseTicket(projectId, task.code, task.id, 'RETRY', 75, executeAt('2026-11-25 23:59:20.456'));
    assert.equal(ticket()?.retry_not_before, '2026-11-26 00:00:35.456');
    assert.equal(await claimTicket(projectId, task.code, marker, 'early', executeAt('2026-11-26 00:00:35.455')), false);
    assert.equal(ticket()?.attempt_id, task.id);
    assert.equal(ticket()?.state, 'RETRY');

    const atDeadline = executeAt('2026-11-26 00:00:35.456');
    assert.equal(await claimTicket(projectId, task.code, marker, 'next-attempt', atDeadline), true);
    assert.equal(ticket()?.state, 'CREATING');
    assert.equal(ticket()?.retry_not_before, null);
    assert.equal(await claimTicket(projectId, task.code, marker, 'another-attempt', atDeadline), false);

    await pauseTicket(projectId, task.code, 'next-attempt', 'RETRY', undefined, atDeadline);
    assert.equal(ticket()?.retry_not_before, null);
    assert.equal(await claimTicket(projectId, task.code, marker, 'no-delay', atDeadline), true);

    await pauseTicket(projectId, task.code, 'no-delay', 'REVIEW', 75, atDeadline);
    assert.equal(ticket()?.retry_not_before, null);
    assert.equal(await claimTicket(projectId, task.code, marker, 'uncertain', atDeadline), false);
  } finally {
    db.close();
  }
});
