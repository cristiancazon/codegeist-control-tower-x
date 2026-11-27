import { getAppContext } from '@forge/api';
import { Queue } from '@forge/events';
import { isConfiguredDemoProject } from './bootstrap/demo-access';
import { fixture } from './bootstrap/fixture';
import { readImport } from './bootstrap/store';
import { DECISIONS_SCHEMA_VERSION, isSchemaReady, runMigrations } from './sql/migrations';
import { pruneAbandonedDemoSnapshotChunks } from './sql/snapshot-retention';

const migrationQueue = new Queue<{ kind: 'schema' }>({ key: 'ctx-schema-migrations' });

export async function enqueue() {
  if (await isSchemaReady(DECISIONS_SCHEMA_VERSION)) {
    return;
  }
  await migrationQueue.push({ body: { kind: 'schema' }, concurrency: { key: 'schema', limit: 1 } });
}

export async function run() {
  if (await isSchemaReady(DECISIONS_SCHEMA_VERSION)) {
    return;
  }
  await runMigrations();
  console.info(JSON.stringify({ operation: 'data.migrations', code: 'READY' }));
}

export async function maintain() {
  if (!await isSchemaReady(DECISIONS_SCHEMA_VERSION)) {
    await enqueue();
    return;
  }

  const jiraProjectId = process.env.CTX_DEMO_JIRA_PROJECT_ID;
  if (!jiraProjectId || !isConfiguredDemoProject(getAppContext(), jiraProjectId, {
    cloudId: process.env.CTX_DEMO_CLOUD_ID,
    jiraProjectId,
  })) {
    return;
  }

  const projectId = fixture.project.id;
  if (!await readImport(projectId, jiraProjectId)) {
    return;
  }
  const result = await pruneAbandonedDemoSnapshotChunks(projectId);
  if (result.snapshotsFenced || result.chunksDeleted) {
    console.info(JSON.stringify({ operation: 'data.retention', ...result }));
  }
}
