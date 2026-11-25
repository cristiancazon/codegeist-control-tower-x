import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForgeSQLAPIError, migrationRunner, sql } from '@forge/sql';
import { isSchemaReady, runMigrations } from './migrations';

test('registers ordered idempotent DDL and writes readiness after migrations', async (t) => {
  const ddl = migrationRunner.getEnqueued();
  assert.equal(ddl.length, 31);
  assert.equal(new Set(ddl.map((entry) => entry.name)).size, ddl.length);
  assert.match(ddl.at(-1)!.statement, /CREATE TABLE IF NOT EXISTS ctx_schema_version/);
  assert.ok(ddl.every((entry) => /^\s*CREATE TABLE IF NOT EXISTS ctx_/.test(entry.statement)));

  let applied = false;
  let ready = false;
  const run = t.mock.method(migrationRunner, 'run', async () => {
    applied = true;
    return [];
  });
  t.mock.method(sql, 'prepare', (statement: string) => ({
    bindParams() { return this; },
    async execute() {
      if (statement.startsWith('SELECT version')) {
        if (!applied) {
          throw new ForgeSQLAPIError({ status: 400, statusText: 'Bad Request' }, {
            code: 'SQL_EXECUTION_ERROR', message: 'Missing table', context: { debug: { code: 'ER_NO_SUCH_TABLE' } },
          });
        }
        return { rows: ready ? [{ version: 1 }] : [] };
      }
      assert.match(statement, /^INSERT INTO ctx_schema_version/);
      assert.equal(applied, true);
      ready = true;
      return { rows: { affectedRows: 1 } };
    },
  }));

  assert.equal(await isSchemaReady(), false);
  await runMigrations();
  assert.equal(await isSchemaReady(), true);
  await runMigrations();
  assert.equal(run.mock.callCount(), 1);
});
