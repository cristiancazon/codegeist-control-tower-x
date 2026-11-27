import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForgeSQLAPIError, migrationRunner, sql } from '@forge/sql';
import { DECISIONS_SCHEMA_VERSION, decisionMigrations, isSchemaReady, runMigrations } from './migrations';

test('registers ordered idempotent DDL and writes readiness after migrations', async (t) => {
  const ddl = migrationRunner.getEnqueued();
  assert.equal(ddl.length, 35);
  assert.equal(new Set(ddl.map((entry) => entry.name)).size, ddl.length);
  assert.match(ddl[30]!.statement, /CREATE TABLE IF NOT EXISTS ctx_schema_version/);
  assert.match(ddl[31]!.statement, /^ALTER TABLE ctx_scenario ADD COLUMN IF NOT EXISTS editor_definition_jcs TEXT$/);
  assert.ok(ddl.slice(0, 31).every((entry) => /^\s*CREATE TABLE IF NOT EXISTS ctx_/.test(entry.statement)));
  assert.deepEqual(ddl.slice(32).map(({ name, statement }) => [name, statement]), decisionMigrations);

  let applied = false;
  const ready = new Set<number>();
  const run = t.mock.method(migrationRunner, 'run', async () => {
    applied = true;
    return [];
  });
  t.mock.method(sql, 'prepare', (statement: string) => ({
    parameters: [] as number[],
    bindParams(...parameters: number[]) { this.parameters = parameters; return this; },
    async execute() {
      if (statement.startsWith('SELECT version')) {
        if (!applied) {
          throw new ForgeSQLAPIError({ status: 400, statusText: 'Bad Request' }, {
            code: 'SQL_EXECUTION_ERROR', message: 'Missing table', context: { debug: { code: 'ER_NO_SUCH_TABLE' } },
          });
        }
        return { rows: this.parameters.filter((version) => ready.has(version)).map((version) => ({ version })) };
      }
      assert.match(statement, /^INSERT INTO ctx_schema_version/);
      assert.equal(applied, true);
      for (const version of this.parameters) ready.add(version);
      return { rows: { affectedRows: 1 } };
    },
  }));

  assert.equal(await isSchemaReady(), false);
  await runMigrations();
  assert.equal(await isSchemaReady(), true);
  assert.equal(await isSchemaReady(DECISIONS_SCHEMA_VERSION), true);
  ready.delete(DECISIONS_SCHEMA_VERSION);
  assert.equal(await isSchemaReady(), true);
  assert.equal(await isSchemaReady(DECISIONS_SCHEMA_VERSION), false);
  await runMigrations();
  await runMigrations();
  assert.equal(run.mock.callCount(), 2);
});
