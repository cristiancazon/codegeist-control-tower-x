import { Queue } from '@forge/events';
import { isSchemaReady, runMigrations } from './sql/migrations';

const migrationQueue = new Queue<{ kind: 'schema' }>({ key: 'ctx-schema-migrations' });

export async function enqueue() {
  if (await isSchemaReady()) {
    return;
  }
  await migrationQueue.push({ body: { kind: 'schema' }, concurrency: { key: 'schema', limit: 1 } });
}

export async function run() {
  if (await isSchemaReady()) {
    return;
  }
  await runMigrations();
  console.info(JSON.stringify({ operation: 'data.migrations', code: 'READY' }));
}
