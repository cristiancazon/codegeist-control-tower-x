import type { PatagoniaFixture } from '../../../domain/fixtures/patagonia';
import type { JiraIssueIdentity, JiraProjectIdentity } from '../jira/types';
import { executeSql } from '../sql/client';

export type ImportRow = {
  fixture_hash: string;
  owner_account_id: string;
  state: 'LOADING' | 'IMPORTING' | 'COMPLETE';
};

export type TicketRow = {
  task_code: string;
  attempt_id: string;
  state: 'CREATING' | 'DONE' | 'REVIEW' | 'RETRY';
  issue_id: string | null;
  issue_key: string | null;
  age_seconds: number;
};

export async function readImport(projectId: string, jiraProjectId: string) {
  const rows = await executeSql<ImportRow>(
    `SELECT i.fixture_hash, i.owner_account_id, i.state
     FROM ctx_fixture_import i INNER JOIN ctx_project p ON p.id = i.project_id
     WHERE i.project_id = ? AND p.jira_project_id = ? AND p.data_mode = 'DEMO'`,
    [projectId, jiraProjectId],
  );
  return rows[0];
}

export async function reserveProject(
  fixture: PatagoniaFixture, jira: JiraProjectIdentity, actor: string, hash: string,
) {
  const project = fixture.project;
  await executeSql(
    `INSERT INTO ctx_project (id, code, name, jira_project_id, jira_project_key,
       time_zone, currency, target_date, budget_cents, data_mode, status, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DEMO', 'IMPORTING', ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE id = ctx_project.id`,
    [project.id, project.code, project.name, jira.id, jira.key, project.timeZone,
      project.currency, project.targetDate, project.budgetCents, project.version],
  );
  await executeSql(
    `INSERT INTO ctx_fixture_import (project_id, fixture_hash, fixture_version, owner_account_id, state, updated_at)
     SELECT id, ?, ?, ?, 'LOADING', UTC_TIMESTAMP(3) FROM ctx_project
     WHERE id = ? AND jira_project_id = ? AND data_mode = 'DEMO'
     ON DUPLICATE KEY UPDATE project_id = ctx_fixture_import.project_id`,
    [hash, fixture.manifest.fixtureVersion, actor, project.id, jira.id],
  );
  return readImport(project.id, jira.id);
}

export async function addProjectAdmin(projectId: string, actor: string) {
  await executeSql(
    `INSERT INTO ctx_project_role (project_id, account_id, role_code, granted_by, granted_at)
     VALUES (?, ?, 'ADMIN', ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE project_id = ctx_project_role.project_id`,
    [projectId, actor, actor],
  );
}

export async function isProjectAdmin(projectId: string, actor: string) {
  const rows = await executeSql<{ role_code: string }>(
    `SELECT role_code FROM ctx_project_role
     WHERE project_id = ? AND account_id = ? AND role_code = 'ADMIN' AND revoked_at IS NULL`,
    [projectId, actor],
  );
  return rows[0]?.role_code === 'ADMIN';
}

export async function markImportStarted(projectId: string, actor: string) {
  await executeSql(
    `UPDATE ctx_fixture_import SET state = 'IMPORTING', updated_at = UTC_TIMESTAMP(3)
     WHERE project_id = ? AND owner_account_id = ? AND state = 'LOADING'`,
    [projectId, actor],
  );
}

export async function readTickets(projectId: string) {
  return executeSql<TicketRow>(
    `SELECT task_code, attempt_id, state, issue_id, issue_key,
            TIMESTAMPDIFF(SECOND, updated_at, UTC_TIMESTAMP(3)) AS age_seconds
     FROM ctx_fixture_ticket WHERE project_id = ? ORDER BY task_code`,
    [projectId],
  );
}

export async function claimTicket(
  projectId: string, taskCode: string, marker: string, attempt: string, query: typeof executeSql = executeSql,
) {
  await query(
    `INSERT INTO ctx_fixture_ticket (project_id, task_code, marker, state, attempt_id, updated_at)
     VALUES (?, ?, ?, 'CREATING', ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE project_id = ctx_fixture_ticket.project_id`,
    [projectId, taskCode, marker, attempt],
  );
  await query(
    `UPDATE ctx_fixture_ticket
     SET state = 'CREATING', attempt_id = ?, retry_not_before = NULL, updated_at = UTC_TIMESTAMP(3)
     WHERE project_id = ? AND task_code = ? AND marker = ? AND state = 'RETRY'
       AND (retry_not_before IS NULL OR retry_not_before <= UTC_TIMESTAMP(3))`,
    [attempt, projectId, taskCode, marker],
  );
  const rows = await query<{ attempt_id: string; state: string }>(
    'SELECT attempt_id, state FROM ctx_fixture_ticket WHERE project_id = ? AND task_code = ?',
    [projectId, taskCode],
  );
  return rows[0]?.attempt_id === attempt && rows[0].state === 'CREATING';
}

export async function pauseTicket(
  projectId: string, taskCode: string, attempt: string, state: 'REVIEW' | 'RETRY',
  retryAfterSeconds?: number, query: typeof executeSql = executeSql,
) {
  const delay = state === 'RETRY' ? retryAfterSeconds ?? null : null;
  if (delay !== null && (!Number.isSafeInteger(delay) || delay < 0 || delay > 999_999_999)) {
    throw new Error('The Jira retry delay is outside the supported range');
  }
  await query(
    `UPDATE ctx_fixture_ticket
     SET state = ?, retry_not_before = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)), updated_at = UTC_TIMESTAMP(3)
     WHERE project_id = ? AND task_code = ? AND attempt_id = ? AND state = 'CREATING'`,
    [state, delay, projectId, taskCode, attempt],
  );
}

export async function recordTicketIdentity(
  projectId: string, taskCode: string, attempt: string, issue: JiraIssueIdentity,
  query: typeof executeSql = executeSql,
) {
  await query(
    `UPDATE ctx_fixture_ticket SET state = 'DONE', issue_id = ?, issue_key = ?, updated_at = UTC_TIMESTAMP(3)
     WHERE project_id = ? AND task_code = ? AND attempt_id = ? AND state IN ('CREATING', 'REVIEW')`,
    [issue.id, issue.key, projectId, taskCode, attempt],
  );
  const confirmed = await query<{ task_code: string }>(
    `SELECT task_code FROM ctx_fixture_ticket
     WHERE project_id = ? AND task_code = ? AND attempt_id = ? AND state = 'DONE' AND issue_id = ? AND issue_key = ?`,
    [projectId, taskCode, attempt, issue.id, issue.key],
  );
  if (confirmed[0]?.task_code !== taskCode) {
    throw new Error('The Jira fixture mapping did not match the reserved ticket');
  }
}

export async function activateProject(
  projectId: string, jiraProjectId: string, actor: string, fixtureHash: string,
  query: typeof executeSql = executeSql,
) {
  // Keep each guarded update restartable when an invocation stops between statements.
  await query(
    `UPDATE ctx_project SET status = 'ACTIVE', updated_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND jira_project_id = ? AND data_mode = 'DEMO' AND status = 'IMPORTING'
       AND EXISTS (SELECT 1 FROM ctx_fixture_import
                   WHERE project_id = ? AND owner_account_id = ? AND fixture_hash = ? AND state = 'IMPORTING')`,
    [projectId, jiraProjectId, projectId, actor, fixtureHash],
  );
  await query(
    `UPDATE ctx_fixture_import SET state = 'COMPLETE', updated_at = UTC_TIMESTAMP(3)
     WHERE project_id = ? AND owner_account_id = ? AND fixture_hash = ? AND state = 'IMPORTING'
       AND EXISTS (SELECT 1 FROM ctx_project
                   WHERE id = ? AND jira_project_id = ? AND data_mode = 'DEMO' AND status = 'ACTIVE')`,
    [projectId, actor, fixtureHash, projectId, jiraProjectId],
  );
  const verified = await query<{ id: string }>(
    `SELECT p.id FROM ctx_project p INNER JOIN ctx_fixture_import i ON i.project_id = p.id
     WHERE p.id = ? AND p.jira_project_id = ? AND p.data_mode = 'DEMO' AND p.status = 'ACTIVE'
       AND i.owner_account_id = ? AND i.fixture_hash = ? AND i.state = 'COMPLETE'`,
    [projectId, jiraProjectId, actor, fixtureHash],
  );
  if (verified[0]?.id !== projectId) {
    throw new Error('The project and fixture import did not reach their verified final states');
  }
}
