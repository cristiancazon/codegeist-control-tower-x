import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import type { Result } from '@forge/sql';
import type { JiraWorkItem } from '../data/jira';
import type { executeSql, SqlParameter } from '../data/sql/client';
import { modelMigrations } from '../data/sql/schema';
import type { OperationsScope } from './scope';
import { listWork, readWorkDetail } from './work';

const projectId = 'project-own';
const jiraProjectId = '12000';
const asOf = '2026-11-24';
const sqlCutoff = '2026-11-24 14:00:00.000';

function withWork(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const tables = ['ctx_project', 'ctx_phase', 'ctx_work_package', 'ctx_dependency', 'ctx_source_mapping', 'ctx_data_snapshot'];
  for (const [, ddl] of modelMigrations) {
    const table = /CREATE TABLE IF NOT EXISTS (\w+)/.exec(ddl)?.[1];
    if (!table || !tables.includes(table)) continue;
    const indexes = Array.from(ddl.matchAll(/^\s+(UNIQUE )?KEY (\w+) \(([^)]+)\),?$/gm));
    db.exec(ddl.replace(/^\s+(?:UNIQUE )?KEY .+$/gm, '')
      .replace(/,\s*\)(?: DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin)?\s*$/, ')')
      .replace(/ DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin\s*$/, ''));
    for (const [, unique = '', name, columns] of indexes) {
      db.exec(`CREATE ${unique}INDEX ${name} ON ${table} (${columns})`);
    }
  }

  const query: typeof executeSql = async <Row>(statement: string, parameters: readonly SqlParameter[]): Promise<Result<Row>['rows']> => {
    const prepared = db.prepare(statement.replaceAll('UTC_TIMESTAMP(3)', "'2026-11-25 00:00:00.000'"));
    const bound = parameters.map((value) => typeof value === 'boolean' ? Number(value) : value);
    return prepared.all(...bound) as Result<Row>['rows'];
  };
  db.prepare(`INSERT INTO ctx_project (id, code, name, jira_project_id, jira_project_key, time_zone, currency, data_mode, status, version, updated_at)
              VALUES (?, 'PATAGONIA', 'Patagonia', ?, 'PED', 'America/Argentina/Buenos_Aires', 'USD', 'DEMO', 'ACTIVE', 1, ?)`)
    .run(projectId, jiraProjectId, sqlCutoff);
  db.prepare(`INSERT INTO ctx_data_snapshot
     (id, project_id, state, schema_version, as_of_date, collected_at, sealed_at, expires_at, created_by,
      access_class, chunk_count, content_hash, source_manifest_jcs, quality_jcs)
     VALUES ('snapshot', ?, 'SEALED', 1, ?, ?, ?, '2027-01-01 00:00:00.000', 'fixture-owner', 'SYNTHETIC_DEMO', 1, ?, '{}', '{}')`)
    .run(projectId, asOf, sqlCutoff, sqlCutoff, 'f'.repeat(64));
  const phase = db.prepare('INSERT INTO ctx_phase (id, project_id, code, name, ordinal) VALUES (?, ?, ?, ?, ?)');
  phase.run('phase-1', projectId, 'PH-01', 'Movilización', 1);
  phase.run('phase-2', projectId, 'PH-02', 'Montaje', 2);
  phase.run('phase-6', projectId, 'PH-06', 'Privado', 6);

  const jiraIssues = new Map<string, JiraWorkItem>();
  const work = db.prepare(`INSERT INTO ctx_work_package
    (id, project_id, phase_id, code, jira_issue_id, jira_issue_key, title, status, planned_start, planned_finish,
     actual_start, actual_finish, milestone, priority_rank, source_updated_at, version)
    VALUES (?, ?, ?, ?, ?, 'PED-1', 'Título obsoleto del fixture', 'DONE', '2026-11-10', '2026-12-03',
            '2026-11-11', NULL, 0, 3, ?, 1)`);
  const mapping = db.prepare(`INSERT INTO ctx_source_mapping
    (project_id, source_system, source_scope, source_id, entity_kind, entity_id, fixture_key, last_seen_at)
    VALUES (?, 'JIRA', ?, ?, 'WORK_PACKAGE', ?, ?, ?)`);
  for (const number of [...Array.from({ length: 24 }, (_, index) => index + 1), 47, 48, 64, 83, 120]) {
    const code = `WP-${String(number).padStart(3, '0')}`;
    const jiraId = String(30_000 + number);
    const phaseId = number === 120 ? 'phase-6' : number >= 23 ? 'phase-2' : 'phase-1';
    work.run(`id-${code}`, projectId, phaseId, code, jiraId, sqlCutoff);
    mapping.run(projectId, jiraProjectId, jiraId, `id-${code}`, code, sqlCutoff);
    if (number === 120) continue;
    jiraIssues.set(jiraId, {
      id: jiraId, key: `PED-${1000 + number}`, projectId: jiraProjectId, issueTypeId: '12100',
      summary: number === 1 ? 'Revisión de calibración' : `Título actual ${code}`,
      status: number === 3 ? { id: '101', name: 'Finalizado', categoryKey: 'done' }
        : number === 4 ? { id: '102', name: 'Personalizado', categoryKey: null }
        : { id: '100', name: 'Pendiente', categoryKey: 'new' },
      assigneeAccountId: null, dueDate: ['2026-11-23', '2026-11-24', '2026-11-22', '2026-11-21'][number - 1] ?? null,
      updatedAt: '2026-11-25T00:00:00.000Z', labels: [],
    });
  }
  const edge = db.prepare(`INSERT INTO ctx_dependency (id, project_id, predecessor_id, successor_id, relation_type, lag_days, version)
                           VALUES (?, ?, ?, ?, 'FS', ?, 1)`);
  for (const [from, to, lag] of [['WP-047', 'WP-048', 0], ['WP-048', 'WP-064', 3], ['WP-064', 'WP-083', 1], ['WP-083', 'WP-120', 4]] as const) {
    edge.run(`${from}:${to}`, projectId, `id-${from}`, `id-${to}`, lag);
  }

  const scope: OperationsScope = {
    projectId, jiraProjectId, roles: ['VIEWER'], snapshot: { asOf, collectedAt: '2026-11-24T14:00:00.000Z' },
    observedAt: '2026-11-25T00:00:00.000Z', jiraIssues, jiraState: 'READY',
  };
  return { db, scope, query };
}

test('CT004-01: lists 20 at a time with visible totals and canonical Jira fields', async (t) => {
  const { scope, query } = withWork(t);
  const list = await listWork(scope, {}, query);
  assert.equal(list.total, 28);
  assert.equal(list.rows.length, 20);
  assert.equal(list.rows[0]?.issueKey, 'PED-1001');
  assert.deepEqual(list.rows[0]?.cells, ['Revisión de calibración', 'PH-01 · Movilización', 'Pendiente', '2026-11-23', '2026-12-03']);
  assert.deepEqual(list.facets?.[0]?.options.map(({ value }) => value), ['PH-01', 'PH-02']);
  const second = await listWork(scope, { page: 2 }, query);
  assert.equal(second.total, 28);
  assert.equal(second.rows.length, 8);
  assert.deepEqual(second.rows.map(({ code }) => code), ['WP-021', 'WP-022', 'WP-023', 'WP-024', 'WP-047', 'WP-048', 'WP-064', 'WP-083']);
  assert.deepEqual(list.sources.map(({ source, quality }) => [source, quality]), [['JIRA', 'LIVE'], ['FORGE', 'SYNTHETIC']]);
});

test('applies phase, live status, accent-insensitive search and inclusive Jira due-date filters to visible rows', async (t) => {
  const { scope, query } = withWork(t);
  const codes = async (filters: Parameters<typeof listWork>[1]) => (await listWork(scope, filters, query)).rows.map(({ code }) => code);
  assert.deepEqual(await codes({ phaseCode: 'PH-02', q: 'ped-1064' }), ['WP-064']);
  assert.deepEqual(await codes({ phaseCode: 'PH-01', status: '100', q: 'REVISION DE CALIBRACION' }), ['WP-001']);
  assert.deepEqual(await codes({ status: 'done' }), ['WP-003']);
  assert.deepEqual(await codes({ overdueOnly: true }), ['WP-001']);
  assert.deepEqual(await codes({ from: '2026-11-22', to: '2026-11-23' }), ['WP-001', 'WP-003']);
  assert.deepEqual(await codes({ q: 'título obsoleto del fixture' }), []);
  assert.deepEqual(await codes({ phaseCode: 'PH-06' }), []);
});

test('detail exposes only visible incoming and outgoing edges, keeping their relation and lag', async (t) => {
  const { scope, query } = withWork(t);
  const detail = await readWorkDetail(scope, 'WP-048', query);
  assert.equal(detail?.title, 'Título actual WP-048');
  assert.deepEqual(detail?.groups, [
    { label: 'Predecesores', fields: [{ label: 'WP-047 · PED-1047', value: 'Título actual WP-047 · FS · 0 d' }] },
    { label: 'Sucesores', fields: [{ label: 'WP-064 · PED-1064', value: 'Título actual WP-064 · FS · 3 d' }] },
  ]);
  assert.deepEqual(detail?.links.map((link) => link.kind === 'jira' ? link.issueKey : link.code), ['PED-1048', 'WP-047', 'WP-064']);
  const end = await readWorkDetail(scope, 'WP-083', query);
  assert.doesNotMatch(JSON.stringify(end), /WP-120|PED-1120/);
  assert.equal(await readWorkDetail(scope, 'WP-120', query), undefined);
  assert.equal(await readWorkDetail(scope, 'does-not-exist', query), undefined);
});

test('project, source mapping, snapshot and Jira source restrictions remove both rows and links', async (t) => {
  const { db, scope, query } = withWork(t);
  const malformedProjectJira = new Map(scope.jiraIssues);
  const item = malformedProjectJira.get('30064');
  assert.ok(item);
  malformedProjectJira.set(item.id, { ...item, projectId: 'different-jira-project' });
  const restricted = { ...scope, jiraIssues: malformedProjectJira, jiraState: 'PARTIAL' } as const;
  assert.equal((await listWork(restricted, {}, query)).total, 27);
  assert.equal(await readWorkDetail(restricted, 'WP-064', query), undefined);
  assert.doesNotMatch(JSON.stringify(await readWorkDetail(restricted, 'WP-048', query)), /WP-064|PED-1064/);
  assert.equal((await listWork({ ...scope, projectId: 'alien-project' }, {}, query)).total, 0);
  assert.equal((await listWork({ ...scope, jiraState: 'UNAVAILABLE' }, {}, query)).total, 0);

  db.prepare("UPDATE ctx_source_mapping SET tombstoned_at = '2026-11-25 00:00:00.000' WHERE source_id = '30064'").run();
  assert.equal(await readWorkDetail(scope, 'WP-064', query), undefined);
  assert.doesNotMatch(JSON.stringify(await readWorkDetail(scope, 'WP-048', query)), /WP-064|PED-1064/);
  db.prepare("UPDATE ctx_data_snapshot SET expires_at = '2026-11-25 00:00:00.000'").run();
  assert.equal((await listWork(scope, {}, query)).total, 0);
  assert.equal(await readWorkDetail(scope, 'WP-048', query), undefined);
});
