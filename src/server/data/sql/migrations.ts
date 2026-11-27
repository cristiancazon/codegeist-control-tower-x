import { setTimeout as delay } from 'node:timers/promises';
import { errorCodes, migrationRunner, type UpdateQueryResponse } from '@forge/sql';
import { fixtureMigrations } from '../bootstrap/schema';
import { executeSql, getSqlApiError } from './client';
import { modelMigrations, type SqlMigration } from './schema';

const coreSchemaVersion = 2;
export const DECISIONS_SCHEMA_VERSION = 3;
const retryWindowMs = 60_000;
const readinessMigration: SqlMigration = [
  'v001_99_create_ctx_schema_version',
  `CREATE TABLE IF NOT EXISTS ctx_schema_version (
    version INT PRIMARY KEY
  )`,
];

const editorMigration: SqlMigration = [
  'v002_01_add_scenario_editor_definition',
  'ALTER TABLE ctx_scenario ADD COLUMN IF NOT EXISTS editor_definition_jcs TEXT',
];

export const decisionMigrations: readonly SqlMigration[] = [
  ['v003_01_add_decision_review_reason', 'ALTER TABLE ctx_decision ADD COLUMN IF NOT EXISTS review_reason VARCHAR(500)'],
  ['v003_02_add_decision_execution_finished_at', 'ALTER TABLE ctx_decision ADD COLUMN IF NOT EXISTS execution_finished_at DATETIME(3)'],
  ['v003_03_add_decision_reconciled_by', 'ALTER TABLE ctx_decision ADD COLUMN IF NOT EXISTS reconciled_by VARCHAR(128)'],
];

for (const [name, statement] of [...modelMigrations, ...fixtureMigrations, readinessMigration, editorMigration, ...decisionMigrations]) {
  migrationRunner.enqueue(name, statement);
}

export async function isSchemaReady(schemaVersion = coreSchemaVersion): Promise<boolean> {
  try {
    const rows = await executeSql<{ version: number }>(
      'SELECT version FROM ctx_schema_version WHERE version = ?',
      [schemaVersion],
    );
    return rows[0]?.version === schemaVersion;
  } catch (error) {
    const apiError = getSqlApiError(error);
    const debug = apiError?.context?.debug;
    const missingTable = typeof debug === 'object' && debug !== null &&
      'code' in debug && debug.code === 'ER_NO_SUCH_TABLE';
    if (missingTable || apiError?.code === errorCodes.APP_NOT_ENABLED || apiError?.responseDetails.status === 404) {
      return false;
    }
    throw error;
  }
}

function isRetryable(error: unknown): boolean {
  const apiError = getSqlApiError(error);
  if (!apiError) {
    return false;
  }

  switch (apiError.code) {
    case errorCodes.QUERY_TIMED_OUT:
      return true;
    case errorCodes.INVALID_SQL_QUERY:
    case errorCodes.SQL_EXECUTION_ERROR:
    case 'SQL_POLICY_VIOLATION':
      return false;
    default:
      return apiError.responseDetails.status === 429 || apiError.responseDetails.status >= 500;
  }
}

// Enqueue this consumer with a concurrency limit of 1 per installation.
export async function runMigrations(): Promise<void> {
  const deadline = performance.now() + retryWindowMs;
  let retryDelayMs = 2_000;
  let failure: unknown;

  do {
    try {
      if (!(await isSchemaReady(DECISIONS_SCHEMA_VERSION))) {
        await migrationRunner.run();
        await executeSql<UpdateQueryResponse>(
          'INSERT INTO ctx_schema_version (version) VALUES (?), (?) ON DUPLICATE KEY UPDATE version = ctx_schema_version.version',
          [coreSchemaVersion, DECISIONS_SCHEMA_VERSION],
        );
      }
      return;
    } catch (error) {
      failure = error;
      const remainingMs = deadline - performance.now();
      if (!isRetryable(error) || remainingMs <= 0) {
        break;
      }

      await delay(Math.min(retryDelayMs, remainingMs));
      retryDelayMs = Math.min(retryDelayMs * 2, 12_000);
    }
  } while (performance.now() < deadline);

  const apiError = getSqlApiError(failure);
  const operation = failure instanceof Error && 'migrationName' in failure
    ? String(failure.migrationName)
    : 'readiness';
  throw new Error(`Forge SQL migration failed: ${operation} (${apiError?.code ?? 'UNAVAILABLE'})`);
}
