export const fixtureMigrations: readonly (readonly [string, string])[] = [
  ['029_fixture_import', `CREATE TABLE IF NOT EXISTS ctx_fixture_import (
    project_id CHAR(36) PRIMARY KEY,
    fixture_hash CHAR(64) NOT NULL,
    fixture_version VARCHAR(32) NOT NULL,
    owner_account_id VARCHAR(128) NOT NULL,
    state VARCHAR(24) NOT NULL,
    updated_at DATETIME(3) NOT NULL
  )`],
  ['030_fixture_ticket', `CREATE TABLE IF NOT EXISTS ctx_fixture_ticket (
    project_id CHAR(36) NOT NULL,
    task_code VARCHAR(32) NOT NULL,
    marker VARCHAR(64) NOT NULL,
    state VARCHAR(24) NOT NULL,
    attempt_id CHAR(36) NOT NULL,
    issue_id VARCHAR(80),
    issue_key VARCHAR(40),
    retry_not_before DATETIME(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (project_id, task_code),
    UNIQUE KEY uq_fixture_ticket_marker (project_id, marker),
    UNIQUE KEY uq_fixture_ticket_issue (project_id, issue_id),
    KEY idx_fixture_ticket_state (project_id, state, task_code)
  )`],
];
