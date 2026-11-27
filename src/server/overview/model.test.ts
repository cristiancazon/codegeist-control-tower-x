import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Result } from '@forge/sql';
import type { Overview } from '../../shared/overview';
import type { JiraWorkItem } from '../data/jira/types';
import type { executeSql, SqlParameter } from '../data/sql/client';
import { readOverview } from './model';

const projectId = '0e2bbea1-54f9-56a7-a3da-36a803b90902';
const jiraProjectId = '10001';
const asOf = '2026-11-24';
const observedAt = '2026-11-25T15:20:00.000Z';
const phases = [{ code: 'PH-03', name: 'Suministro' }, { code: 'PH-04', name: 'Montaje' }];
const mappedWork = [
  { id: 'gate-id', code: 'WP-048', jira_issue_id: '101', facility_id: 'facility-1', milestone: 0, phase: 'PH-03' },
  { id: 'future-id', code: 'WP-065', jira_issue_id: '102', facility_id: 'facility-2', milestone: 0, phase: 'PH-04' },
  { id: 'milestone-id', code: 'WP-119', jira_issue_id: '103', facility_id: 'facility-2', milestone: '1', phase: 'PH-04' },
  { id: 'private-id', code: 'PRIVATE_WORK_CODE', jira_issue_id: '104', facility_id: 'facility-private', milestone: 1, phase: 'PH-03' },
  { id: 'unknown-id', code: 'WP-050', jira_issue_id: '105', facility_id: 'facility-1', milestone: 0, phase: 'PH-03' },
  { id: 'no-due-id', code: 'WP-051', jira_issue_id: '106', facility_id: 'facility-1', milestone: 0, phase: 'PH-03' },
] as const;

function workItem(id: string, categoryKey: string | null, dueDate: string | null, project = jiraProjectId): JiraWorkItem {
  return {
    id,
    key: `PED-${id}`,
    projectId: project,
    issueTypeId: '10000',
    summary: `Issue ${id}`,
    status: { id: '10101', name: categoryKey === 'done' ? 'Terminado' : 'Pendiente', categoryKey },
    assigneeAccountId: null,
    dueDate,
    updatedAt: observedAt,
    labels: [],
  };
}

const jiraIssues = [
  workItem('101', 'new', '2026-11-23'),
  workItem('102', 'indeterminate', '2026-11-25'),
  workItem('103', 'done', '2026-11-22'),
  workItem('104', 'done', '2026-11-22', '99999'),
  workItem('105', null, '2026-11-23'),
  workItem('106', 'new', null),
  workItem('999', 'done', '2026-11-21'),
];

function mockedSql({ active = true, sealed = true } = {}) {
  const statements: Array<{ statement: string; parameters: readonly SqlParameter[] }> = [];
  const query: typeof executeSql = async <Row>(statement: string, parameters: readonly SqlParameter[]) => {
    statements.push({ statement, parameters });
    assert.equal(parameters[0], projectId, 'Every query is scoped by the authorized local project ID');
    assert.doesNotMatch(statement, /ctx_incident/);
    const rows = sourceRows(statement, parameters);
    return rows as Result<Row>['rows'];
  };

  function sourceRows(statement: string, parameters: readonly SqlParameter[]) {
    if (statement.includes('FROM ctx_shipment s')) {
      assert.match(statement, /gate\.project_id = s\.project_id/);
      assert.match(statement, /snap\.state = 'SEALED' AND snap\.expires_at > UTC_TIMESTAMP\(3\)/);
      return parameters[1] === null || parameters[1] === 'PH-03'
        ? [{
          shipment_id: 'a17-id', gate_id: 'gate-id', jira_project_id: jiraProjectId, gate_issue_id: '101',
          baseline_eta: '2026-11-28', latest_eta: '2026-12-13',
        }]
        : [];
    }
    if (statement.includes('FROM ctx_project')) {
      assert.match(statement, /status = 'ACTIVE' AND data_mode = 'DEMO'/);
      return active ? [{ jira_project_id: jiraProjectId, jira_project_key: 'PED', name: 'Patagonia Energy Development', currency: 'USD' }] : [];
    }
    if (statement.includes('FROM ctx_phase')) {
      return phases;
    }
    if (statement.includes('FROM ctx_data_snapshot')) {
      assert.match(statement, /state = 'SEALED' AND expires_at > UTC_TIMESTAMP\(3\)/);
      assert.match(statement, /access_class = 'SYNTHETIC_DEMO'/);
      return sealed && (parameters[1] === null || String(parameters[1]) >= asOf)
        ? [{ as_of_date: asOf, collected_at: '2026-11-24 14:00:00.000' }]
        : [];
    }
    if (statement.includes('FROM ctx_work_package')) {
      assert.match(statement, /ph\.project_id = w\.project_id/);
      assert.match(statement, /w\.tombstoned_at IS NULL/);
      return mappedWork.filter(({ phase }) => parameters[1] === null || phase === parameters[1]);
    }
    if (statement.includes('FROM ctx_shipment')) {
      assert.match(statement, /updated_at <= \?/);
      assert.equal(parameters[1], '2026-11-24 14:00:00.000');
      return [
        { code: 'A-17', gate_work_package_id: 'gate-id', baseline_eta: '2026-11-28', latest_eta: '2026-12-13', arrived_date: null },
        { code: 'PRIVATE_SHIPMENT', gate_work_package_id: 'private-id', baseline_eta: '2026-11-24', latest_eta: '2026-12-30', arrived_date: null },
      ];
    }
    if (statement.includes('FROM ctx_asset')) {
      assert.match(statement, /assets_object_id IS NULL/);
      assert.match(statement, /source_updated_at <= \?/);
      assert.equal(parameters[1], '2026-11-24 14:00:00.000');
      return [
        { id: 'asset-ready', code: 'EQ-001', status: 'AVAILABLE', next_available_date: asOf },
        { id: 'asset-busy', code: 'EQ-017', status: 'MAINTENANCE', next_available_date: '2026-11-30' },
        { id: 'asset-unknown', code: 'EQ-020', status: 'UNKNOWN', next_available_date: null },
      ];
    }
    if (statement.includes('FROM ctx_work_resource')) {
      return [
        { work_package_id: 'gate-id', resource_id: 'asset-busy' },
        { work_package_id: 'future-id', resource_id: 'asset-ready' },
        { work_package_id: 'private-id', resource_id: 'asset-ready' },
      ];
    }
    if (statement.includes('FROM ctx_facility')) {
      return [
        { id: 'facility-1', code: 'F-1', name: 'Base ficticia', status: 'ACTIVE', map_x: '0.2000', map_y: '0.4000' },
        { id: 'facility-2', code: 'F-2', name: 'Planta ficticia', status: 'ACTIVE', map_x: '0.7000', map_y: 0.6 },
        { id: 'facility-private', code: 'F-3', name: 'Ubicación ficticia', status: 'ACTIVE', map_x: '1.2000', map_y: '0.9000' },
      ];
    }
    if (statement.includes('FROM ctx_cost_record')) {
      assert.deepEqual(parameters, [projectId, 'USD', asOf]);
      assert.match(statement, /work_package_id IS NULL/);
      return [{ record_code: 'ACT-2026-10', amount_cents: '2000000000' },
        { record_code: 'ACT-2026-09', amount_cents: 1000000000 }];
    }
    assert.fail(`Unexpected SQL ${statement}`);
  }
  return { query, statements };
}

function metric(overview: Overview, id: Overview['metrics'][number]['id']) {
  const value = overview.metrics.find((entry) => entry.id === id);
  assert.ok(value);
  return value;
}

test('CT003-01: computes indicators with current Jira states and authorized work only', async () => {
  const sql = mockedSql();
  const overview = await readOverview({ projectId, filters: {}, jiraIssues, jiraState: 'READY', observedAt }, sql.query);
  assert.ok(overview);
  assert.equal(overview.asOf, asOf);
  assert.deepEqual(overview.snapshot, { asOf, collectedAt: '2026-11-24T14:00:00.000Z' });
  assert.deepEqual(overview.sources.map(({ state }) => state), ['READY', 'READY']);

  const progress = metric(overview, 'progress');
  assert.deepEqual([progress.value, progress.numerator, progress.denominator, progress.coverage], [25, 1, 4, 0.8]);
  assert.deepEqual(progress.evidence.map(({ issueKey }) => issueKey), ['PED-103']);

  const overdue = metric(overview, 'overdue');
  assert.deepEqual([overdue.value, overdue.numerator, overdue.denominator], [1, 1, 2]);
  assert.deepEqual(overdue.evidence.map(({ issueKey }) => issueKey), ['PED-101']);

  const milestones = metric(overview, 'milestones');
  assert.deepEqual([milestones.value, milestones.denominator], [1, 1]);
  assert.equal(metric(overview, 'assets').value, 50);
  assert.equal(metric(overview, 'assets').coverage, 2 / 3);
  assert.equal(metric(overview, 'cost').value, 3_000_000_000);
  assert.equal(metric(overview, 'cost').source, 'FORGE');
  assert.equal(metric(overview, 'logistics').value, 1);
  assert.deepEqual(overview.alerts.map(({ code, delayDays }) => [code, delayDays]), [['A-17', 15]]);
  assert.deepEqual(overview.map.map(({ x, y }) => [x, y]), [[0.2, 0.4], [0.7, 0.6]]);
  assert.doesNotMatch(JSON.stringify(overview), /PRIVATE_WORK_CODE|PRIVATE_SHIPMENT|PED-(104|999)/);
});

test('CT003-01: partial pages and denied Jira confirmation keep uncertainty explicit', async () => {
  const partial = await readOverview({ projectId, filters: {}, jiraIssues: [workItem('102', 'new', '2026-11-26')],
    jiraState: 'PARTIAL', observedAt }, mockedSql().query);
  assert.ok(partial);
  assert.equal(partial.sources[0]?.state, 'PARTIAL');
  assert.equal(metric(partial, 'progress').value, 0);
  assert.equal(metric(partial, 'progress').coverage, null);
  assert.equal(metric(partial, 'logistics').value, null);
  assert.deepEqual(partial.alerts, []);

  const unavailable = await readOverview({ projectId, filters: {}, jiraIssues, jiraState: 'UNAVAILABLE', observedAt }, mockedSql().query);
  assert.ok(unavailable);
  assert.equal(unavailable.sources[0]?.observedAt, null);
  for (const id of ['progress', 'overdue', 'milestones', 'logistics'] as const) {
    assert.equal(metric(unavailable, id).value, null);
    assert.equal(metric(unavailable, id).denominator, null);
    assert.deepEqual(metric(unavailable, id).evidence, []);
  }
  assert.equal(metric(unavailable, 'assets').value, 50);
  assert.deepEqual(unavailable.alerts, []);
});

test('CT003-01: phase filters use permitted associations and unknown phases never widen scope', async () => {
  const supply = await readOverview({ projectId, filters: { phaseCode: 'PH-03' }, jiraIssues, jiraState: 'READY', observedAt }, mockedSql().query);
  assert.ok(supply);
  assert.equal(metric(supply, 'assets').value, 0);
  assert.equal(metric(supply, 'assets').denominator, 1);
  assert.equal(metric(supply, 'cost').value, null);
  assert.deepEqual(supply.map.map(({ code }) => code), ['F-1']);
  assert.deepEqual(supply.alerts.map(({ code }) => code), ['A-17']);

  const empty = await readOverview({ projectId, filters: { phaseCode: 'PH-99' }, jiraIssues, jiraState: 'READY', observedAt }, mockedSql().query);
  assert.ok(empty);
  assert.deepEqual(empty.phases, phases);
  assert.deepEqual(empty.map, []);
  assert.deepEqual(empty.alerts, []);
  assert.deepEqual(empty.metrics.map(({ value }) => value), [null, null, null, null, null, null]);
});

test('CT003-01: cutoff does not replay Jira history or present stale Forge point observations', async () => {
  const later = await readOverview({ projectId, filters: { asOf: '2026-11-26' }, jiraIssues, jiraState: 'READY', observedAt }, mockedSql().query);
  assert.ok(later);
  assert.equal(later.asOf, '2026-11-26');
  assert.equal(later.sources[1]?.state, 'PARTIAL');
  assert.equal(metric(later, 'progress').value, 25);
  assert.equal(metric(later, 'overdue').value, 2);
  assert.equal(metric(later, 'cost').value, 3_000_000_000);
  assert.equal(metric(later, 'assets').value, null);
  assert.deepEqual(later.alerts, []);
  assert.deepEqual(later.map, []);

  const earlier = await readOverview({ projectId, filters: { asOf: '2026-11-23' }, jiraIssues, jiraState: 'READY', observedAt }, mockedSql().query);
  assert.ok(earlier);
  assert.equal(metric(earlier, 'overdue').value, 0, 'A due date matching the cut is not overdue');
  assert.equal(earlier.snapshot, null);
  assert.equal(earlier.sources[1]?.state, 'UNAVAILABLE');
  assert.equal(metric(earlier, 'cost').value, null);
});

test('CT003-01: returns no DTO for an inactive project and no invented cutoff without a snapshot', async () => {
  assert.equal(await readOverview({ projectId, filters: {}, jiraIssues, jiraState: 'READY', observedAt },
    mockedSql({ active: false }).query), undefined);

  const noSnapshot = await readOverview({ projectId, filters: {}, jiraIssues, jiraState: 'READY', observedAt },
    mockedSql({ sealed: false }).query);
  assert.ok(noSnapshot);
  assert.equal(noSnapshot.asOf, null);
  assert.equal(metric(noSnapshot, 'progress').value, 25);
  assert.equal(metric(noSnapshot, 'overdue').value, null);
  assert.equal(metric(noSnapshot, 'logistics').value, null);
});
