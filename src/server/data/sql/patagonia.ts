import { createHash } from 'node:crypto';
import { hashPatagoniaFixture, type PatagoniaFixture } from '../../../domain/fixtures/patagonia';
import { executeSql, type SqlParameter } from './client';

type FixtureIssue = { taskCode: string; issueId: string; issueKey: string };

type MaterializationInput = {
  fixture: PatagoniaFixture;
  jiraProjectId: string;
  ownerAccountId: string;
  issues: readonly FixtureIssue[];
};

type Ticket = { task_code: string; issue_id: string; issue_key: string; marker: string };
type Row = readonly SqlParameter[];
type TableRows = {
  table: string;
  columns: readonly string[];
  scope: 'project_id' | 'snapshot_id' | 'scenario_id';
  key: readonly string[];
  rows: readonly Row[];
};

const batchSize = 50;
const snapshotLifetimeMs = 180 * 86_400_000;
const snapshotChunkLimit = 128 * 1024;

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      return entry;
    }
    return Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left < right ? -1 : Number(left > right)));
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sqlDateTime(iso: string) {
  return iso.slice(0, 23).replace('T', ' ');
}

function questionMarks(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

async function insertRows({ table, columns, scope, key, rows }: TableRows, query: typeof executeSql) {
  // Identifiers are fixed by the tables below. All source values are bound parameters.
  const valueTuple = `(${questionMarks(columns.length)})`;
  const scopeIndex = columns.indexOf(scope);
  const keyIndexes = key.map((column) => columns.indexOf(column));
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const scopeValue = batch[0]?.[scopeIndex];
    if (scopeValue === undefined || batch.some((row) => row[scopeIndex] !== scopeValue)) {
      throw new Error('Fixture rows have an inconsistent scope');
    }

    await query(
      `INSERT INTO ${table} (${columns.join(', ')})
       VALUES ${batch.map(() => valueTuple).join(', ')}
       ON DUPLICATE KEY UPDATE ${scope} = ${table}.${scope}`,
      batch.flat(),
    );

    // A no-op duplicate is safe only if every expected logical key is present in this scope.
    const keyExpression = key.length === 1 ? key[0] : `(${key.join(', ')})`;
    const keyTuple = key.length === 1 ? '?' : `(${questionMarks(key.length)})`;
    const keys = batch.flatMap((row) => keyIndexes.map((index) => row[index]!));
    const counts = await query<{ row_count: string }>(
      `SELECT COUNT(*) AS row_count FROM ${table}
       WHERE ${scope} = ? AND ${keyExpression} IN (${batch.map(() => keyTuple).join(', ')})`,
      [scopeValue, ...keys],
    );
    if (Number(counts[0]?.row_count) !== batch.length) {
      throw new Error(`Fixture identity conflicts while loading ${table}`);
    }
  }
}

async function checkImport(
  { fixture, jiraProjectId, ownerAccountId, issues }: MaterializationInput,
  fixtureHash: string,
  query: typeof executeSql,
) {
  const scopes = await query<{ id: string }>(
    `SELECT p.id FROM ctx_project p INNER JOIN ctx_fixture_import i ON i.project_id = p.id
     WHERE p.id = ? AND p.jira_project_id = ? AND p.data_mode = 'DEMO'
       AND p.status IN ('IMPORTING', 'ACTIVE') AND i.state = 'IMPORTING'
       AND i.fixture_hash = ? AND i.fixture_version = ? AND i.owner_account_id = ?`,
    [fixture.project.id, jiraProjectId, fixtureHash, fixture.manifest.fixtureVersion, ownerAccountId],
  );
  if (scopes[0]?.id !== fixture.project.id) {
    throw new Error('Fixture import is outside the reserved project scope');
  }

  const tickets = await query<Ticket>(
    `SELECT task_code, issue_id, issue_key, marker FROM ctx_fixture_ticket
     WHERE project_id = ? AND state = 'DONE' ORDER BY task_code`,
    [fixture.project.id],
  );
  const byTaskCode = new Map(tickets.map((ticket) => [ticket.task_code, ticket]));
  const submitted = new Map(issues.map((issue) => [issue.taskCode, issue]));
  const taskCount = fixture.workPackages.length;
  if (tickets.length !== taskCount || byTaskCode.size !== taskCount ||
      new Set(tickets.map((ticket) => ticket.issue_id)).size !== taskCount ||
      issues.length !== taskCount || submitted.size !== taskCount) {
    throw new Error('Fixture must have one confirmed Jira issue per work package');
  }
  for (const task of fixture.workPackages) {
    const stored = byTaskCode.get(task.code);
    const supplied = submitted.get(task.code);
    if (!stored?.issue_id || !stored.issue_key || !stored.marker ||
        stored.issue_id !== supplied?.issueId || stored.issue_key !== supplied.issueKey) {
      throw new Error('Fixture Jira identity does not match the import journal');
    }
  }
  return byTaskCode;
}

function catalogRows(fixture: PatagoniaFixture, jiraProjectId: string, tickets: ReadonlyMap<string, Ticket>): TableRows[] {
  const projectId = fixture.project.id;
  const projectRows = (table: string, columns: string[], rows: readonly Row[], key: string[] = ['id']): TableRows =>
    ({ table, columns, scope: 'project_id', key, rows });

  return [
    projectRows('ctx_phase', ['id', 'project_id', 'code', 'name', 'ordinal', 'planned_start', 'planned_end'],
      fixture.phases.map((f) => [f.id, projectId, f.code, f.name, f.ordinal, f.plannedStart, f.plannedEnd])),
    projectRows('ctx_facility', ['id', 'project_id', 'code', 'facility_type', 'name', 'status', 'map_x', 'map_y', 'version'],
      fixture.facilities.map((f) => [f.id, projectId, f.code, f.facilityType, f.name, f.status, f.mapX, f.mapY, f.version])),
    projectRows('ctx_contractor', ['id', 'project_id', 'code', 'name', 'trade', 'status', 'source_updated_at', 'version'],
      fixture.contractors.map((f) => [f.id, projectId, f.code, f.name, f.trade, f.status, sqlDateTime(f.sourceUpdatedAt), f.version])),
    projectRows('ctx_asset', [
      'id', 'project_id', 'code', 'name', 'asset_type', 'status', 'facility_id', 'contractor_id',
      'next_available_date', 'source_updated_at', 'version',
    ], fixture.assets.map((f) => [f.id, projectId, f.code, f.name, f.assetType, f.status, f.facilityId, f.contractorId,
      f.nextAvailableDate, sqlDateTime(f.sourceUpdatedAt), f.version])),
    projectRows('ctx_crew_pool', ['id', 'project_id', 'contractor_id', 'code', 'skill', 'default_capacity', 'version'],
      fixture.crewPools.map((f) => [f.id, projectId, f.contractorId, f.code, f.skill, f.defaultCapacity, f.version])),
    projectRows('ctx_work_package', [
      'id', 'project_id', 'phase_id', 'facility_id', 'contractor_id', 'code', 'jira_issue_id', 'jira_issue_key', 'title',
      'status', 'planned_start', 'planned_finish', 'actual_start', 'actual_finish', 'duration_a', 'duration_m', 'duration_b',
      'earliest_start', 'remaining_days', 'milestone', 'priority_rank', 'source_updated_at', 'version',
    ], fixture.workPackages.map((f) => {
      const ticket = tickets.get(f.code)!;
      return [f.id, projectId, f.phaseId, f.facilityId, f.contractorId, f.code, ticket.issue_id, ticket.issue_key,
        f.title, f.status, f.plannedStart, f.plannedFinish, f.actualStart, f.actualFinish, f.durationA, f.durationM,
        f.durationB, f.earliestStart, f.remainingDays, Number(f.milestone), f.priorityRank, sqlDateTime(f.sourceUpdatedAt), f.version];
    })),
    projectRows('ctx_dependency', ['id', 'project_id', 'predecessor_id', 'successor_id', 'relation_type', 'lag_days', 'version'],
      fixture.dependencies.map((f) => [f.id, projectId, f.predecessorId, f.successorId, f.relationType, f.lagDays, f.version])),
    projectRows('ctx_shipment', [
      'id', 'project_id', 'gate_work_package_id', 'contractor_id', 'asset_id', 'code', 'status',
      'baseline_eta', 'latest_eta', 'arrived_date', 'shipment_qty', 'shipment_unit', 'updated_at', 'version',
    ], fixture.shipments.map((f) => [f.id, projectId, f.gateWorkPackageId, f.contractorId, f.assetId, f.code, f.status,
      f.baselineEta, f.latestEta, f.arrivedDate, f.shipmentQty, f.shipmentUnit, sqlDateTime(f.updatedAt), f.version])),
    projectRows('ctx_work_resource', ['project_id', 'work_package_id', 'resource_kind', 'resource_id', 'quantity'],
      fixture.workResources.map((f) => [projectId, f.workPackageId, f.resourceKind, f.resourceId, f.quantity]),
      ['work_package_id', 'resource_kind', 'resource_id']),
    projectRows('ctx_resource_window', [
      'id', 'project_id', 'resource_kind', 'resource_id', 'window_start', 'window_end', 'capacity', 'reason_code', 'source_ref_jcs',
    ], fixture.resourceWindows.map((f) => [f.id, projectId, f.resourceKind, f.resourceId, f.windowStart, f.windowEnd,
      f.capacity, f.reasonCode, canonicalJson(f.sourceRef)])),
    projectRows('ctx_incident', [
      'id', 'project_id', 'facility_id', 'work_package_id', 'category', 'severity', 'status', 'access_class', 'occurred_at', 'updated_at',
    ], fixture.incidents.map((f) => [f.id, projectId, f.facilityId, f.workPackageId, f.category, f.severity, f.status,
      f.accessClass, sqlDateTime(f.occurredAt), sqlDateTime(f.updatedAt)])),
    projectRows('ctx_cost_record', [
      'id', 'project_id', 'work_package_id', 'contractor_id', 'asset_id', 'record_code', 'kind', 'cost_bucket',
      'amount_cents', 'currency', 'unit_code', 'effective_date', 'valid_until', 'actuality', 'source_ref_jcs',
    ], fixture.costRecords.map((f) => [f.id, projectId, f.workPackageId, f.contractorId, f.assetId, f.recordCode,
      f.kind, f.costBucket, f.amountCents, f.currency, f.unitCode, f.effectiveDate, f.validUntil, f.actuality, canonicalJson(f.sourceRef)])),
    projectRows('ctx_historical_metric', [
      'id', 'project_id', 'metric_code', 'dimension_kind', 'dimension_id', 'unit_code',
      'period_start', 'period_end', 'metric_value', 'quality_code', 'source_ref_jcs',
    ], fixture.historicalMetrics.map((f) => [f.id, projectId, f.metricCode, f.dimensionKind, f.dimensionId, f.unitCode,
      f.periodStart, f.periodEnd, f.metricValue, f.qualityCode, canonicalJson(f.sourceRef)])),
    projectRows('ctx_source_mapping', [
      'project_id', 'source_system', 'source_scope', 'source_id', 'entity_kind', 'entity_id', 'fixture_key', 'last_seen_at',
    ], fixture.workPackages.map((f) => {
      const ticket = tickets.get(f.code)!;
      return [projectId, 'JIRA', jiraProjectId, ticket.issue_id, 'WORK_PACKAGE', f.id, ticket.marker, sqlDateTime(f.sourceUpdatedAt)];
    }), ['source_system', 'source_scope', 'source_id']),
  ];
}

async function verifyJiraMappings(
  fixture: PatagoniaFixture, jiraProjectId: string, tickets: ReadonlyMap<string, Ticket>, query: typeof executeSql,
) {
  const mapped = await query<{ code: string; id: string; jira_issue_id: string; jira_issue_key: string; marker: string }>(
    `SELECT w.code, w.id, w.jira_issue_id, w.jira_issue_key, s.fixture_key AS marker
     FROM ctx_work_package w INNER JOIN ctx_source_mapping s
       ON s.project_id = w.project_id AND s.entity_id = w.id AND s.source_id = w.jira_issue_id
     WHERE w.project_id = ? AND s.source_system = 'JIRA' AND s.source_scope = ? AND s.entity_kind = 'WORK_PACKAGE'`,
    [fixture.project.id, jiraProjectId],
  );
  const byCode = new Map(mapped.map((row) => [row.code, row]));
  for (const task of fixture.workPackages) {
    const row = byCode.get(task.code);
    const ticket = tickets.get(task.code)!;
    if (row?.id !== task.id || row.jira_issue_id !== ticket.issue_id ||
        row.jira_issue_key !== ticket.issue_key || row.marker !== ticket.marker) {
      throw new Error('Fixture Jira mapping conflicts with a persisted work package');
    }
  }
}

function snapshotChunks(fixture: PatagoniaFixture) {
  // Each chunk is a complete JSON value. A reader assembles sections in chunk_index order.
  // HSE and Confluence contents are outside this planning snapshot.
  const sections = {
    project: [fixture.project],
    zones: fixture.zones,
    phases: fixture.phases,
    facilities: fixture.facilities,
    contractors: fixture.contractors,
    assets: fixture.assets,
    crewPools: fixture.crewPools,
    workPackages: fixture.workPackages,
    dependencies: fixture.dependencies,
    shipments: fixture.shipments,
    workResources: fixture.workResources,
    resourceWindows: fixture.resourceWindows,
    costRecords: fixture.costRecords,
    historicalMetrics: fixture.historicalMetrics,
  };

  const chunks = Object.entries(sections).flatMap(([section, rows]) => {
    const chunks = [];
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const payload = canonicalJson({ section, rows: rows.slice(offset, offset + batchSize) });
      if (Buffer.byteLength(payload, 'utf8') > snapshotChunkLimit) {
        throw new Error('Fixture snapshot chunk exceeds its storage limit');
      }
      chunks.push({ payload, hash: sha256(payload) });
    }
    return chunks;
  });
  return { chunks, contentHash: sha256(canonicalJson({ schemaVersion: fixture.snapshot.schemaVersion, sections })) };
}

async function persistSnapshot(
  fixture: PatagoniaFixture, fixtureHash: string, owner: string, query: typeof executeSql,
) {
  const snapshot = fixture.snapshot;
  const { chunks, contentHash } = snapshotChunks(fixture);
  const now = new Date();
  const expiresAt = sqlDateTime(new Date(now.getTime() + snapshotLifetimeMs).toISOString());
  await insertRows({
    table: 'ctx_data_snapshot', scope: 'project_id', key: ['id'],
    columns: [
      'id', 'project_id', 'state', 'schema_version', 'as_of_date', 'collected_at', 'expires_at', 'created_by',
      'access_class', 'chunk_count', 'content_hash', 'source_manifest_jcs', 'quality_jcs',
    ],
    rows: [[snapshot.id, fixture.project.id, 'BUILDING', snapshot.schemaVersion, snapshot.asOfDate,
      sqlDateTime(snapshot.collectedAt), expiresAt, owner, snapshot.accessClass, chunks.length, contentHash,
      canonicalJson({ ...fixture.manifest, fixtureHash, sourceSystem: 'FIXTURE', chunkLayout: 'sections-v1' }),
      canonicalJson({ synthetic: true, restrictedSources: [] })]],
  }, query);
  // Bound each payload in its own statement. A batch of several MEDIUMTEXT values can exceed Forge's request boundary.
  for (const [index, chunk] of chunks.entries()) {
    await query(
      `INSERT INTO ctx_snapshot_chunk (snapshot_id, chunk_index, chunk_hash, payload_jcs)
       VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE snapshot_id = ctx_snapshot_chunk.snapshot_id`,
      [snapshot.id, index, chunk.hash, chunk.payload],
    );
  }
  const persistedChunks = await query<{ chunk_index: number; chunk_hash: string; payload_jcs: string }>(
    `SELECT c.chunk_index, c.chunk_hash, c.payload_jcs FROM ctx_snapshot_chunk c
     INNER JOIN ctx_data_snapshot s ON s.id = c.snapshot_id
     WHERE s.project_id = ? AND s.id = ? ORDER BY c.chunk_index`,
    [fixture.project.id, snapshot.id],
  );
  if (persistedChunks.length !== chunks.length ||
      persistedChunks.some((chunk, index) => chunk.chunk_index !== index ||
        chunk.chunk_hash !== chunks[index]?.hash || sha256(chunk.payload_jcs) !== chunk.chunk_hash)) {
    throw new Error('Fixture snapshot chunks conflict with the input digest');
  }
  await query(
    `UPDATE ctx_data_snapshot SET state = 'SEALED', sealed_at = UTC_TIMESTAMP(3)
     WHERE id = ? AND project_id = ? AND content_hash = ? AND state = 'BUILDING'`,
    [snapshot.id, fixture.project.id, contentHash],
  );
  const sealed = await query<{ id: string }>(
    `SELECT id FROM ctx_data_snapshot WHERE project_id = ? AND id = ? AND content_hash = ?
     AND state = 'SEALED' AND expires_at > UTC_TIMESTAMP(3)`,
    [fixture.project.id, snapshot.id, contentHash],
  );
  if (sealed[0]?.id !== snapshot.id) {
    throw new Error('Fixture snapshot could not be sealed');
  }
}

async function persistScenarios(fixture: PatagoniaFixture, owner: string, query: typeof executeSql) {
  const projectId = fixture.project.id;
  const scenarioHashes = new Map(fixture.scenarios.map((scenario) => [scenario.id, sha256(canonicalJson(scenario))]));
  await insertRows({
    table: 'ctx_scenario', scope: 'project_id', key: ['id'],
    columns: [
      'id', 'project_id', 'snapshot_id', 'root_id', 'baseline_id', 'revision', 'name', 'schema_version',
      'state', 'content_hash', 'request_hash', 'idempotency_key', 'created_by', 'created_at',
    ],
    rows: fixture.scenarios.map((f) => [
      f.id, projectId, f.snapshotId, f.id, f.baselineId, f.revision, f.name, fixture.snapshot.schemaVersion, 'DRAFT',
      scenarioHashes.get(f.id)!, scenarioHashes.get(f.id)!, `${fixture.manifest.fixtureVersion}:${f.code}`,
      owner, sqlDateTime(f.sourceRef.observedAt),
    ]),
  }, query);

  for (const scenario of fixture.scenarios) {
    await insertRows({
      table: 'ctx_scenario_variable', scope: 'scenario_id', key: ['ordinal'],
      columns: ['scenario_id', 'ordinal', 'variable_code', 'target_kind', 'target_id', 'unit_code', 'value_jcs', 'evidence_jcs', 'reason'],
      rows: scenario.variables.map((f) => [scenario.id, f.ordinal, f.variableCode, f.targetKind, f.targetId, f.unitCode,
        canonicalJson(f.value), canonicalJson(f.sourceRefs), f.reason]),
    }, query);
    const persisted = await query<{
      ordinal: number;
      variable_code: string;
      target_kind: string;
      target_id: string;
      unit_code: string;
      value_jcs: string;
      evidence_jcs: string;
      reason: string;
    }>(
      `SELECT v.ordinal, v.variable_code, v.target_kind, v.target_id, v.unit_code, v.value_jcs, v.evidence_jcs, v.reason
       FROM ctx_scenario_variable v INNER JOIN ctx_scenario s ON s.id = v.scenario_id
       WHERE s.project_id = ? AND s.id = ? ORDER BY v.ordinal`,
      [projectId, scenario.id],
    );
    if (persisted.length !== scenario.variables.length || persisted.some((row, index) => {
      const v = scenario.variables[index];
      return !v || row.ordinal !== v.ordinal || row.variable_code !== v.variableCode || row.target_kind !== v.targetKind ||
        row.target_id !== v.targetId || row.unit_code !== v.unitCode || row.value_jcs !== canonicalJson(v.value) ||
        row.evidence_jcs !== canonicalJson(v.sourceRefs) || row.reason !== v.reason;
    })) {
      throw new Error('Fixture scenario variables conflict with published inputs');
    }
    const hash = scenarioHashes.get(scenario.id)!;
    await query(
      `UPDATE ctx_scenario SET state = 'PUBLISHED', published_at = UTC_TIMESTAMP(3)
       WHERE project_id = ? AND id = ? AND snapshot_id = ? AND content_hash = ? AND state = 'DRAFT'`,
      [projectId, scenario.id, fixture.snapshot.id, hash],
    );
  }
  const published = await query<{ id: string; content_hash: string }>(
    `SELECT id, content_hash FROM ctx_scenario
     WHERE project_id = ? AND snapshot_id = ? AND state = 'PUBLISHED' AND id IN (${questionMarks(fixture.scenarios.length)})`,
    [projectId, fixture.snapshot.id, ...fixture.scenarios.map((f) => f.id)],
  );
  if (published.length !== fixture.scenarios.length || published.some((row) => row.content_hash !== scenarioHashes.get(row.id))) {
    throw new Error('Fixture scenario publication is incomplete');
  }
}

// Installation selection is supplied by Forge. The caller owns Jira authentication and project activation.
export async function persistPatagoniaFixture(input: MaterializationInput, query: typeof executeSql = executeSql): Promise<void> {
  const { fixture, jiraProjectId, ownerAccountId } = input;
  const hash = hashPatagoniaFixture(fixture);
  const tickets = await checkImport(input, hash, query);
  for (const rows of catalogRows(fixture, jiraProjectId, tickets)) {
    await insertRows(rows, query);
  }
  await verifyJiraMappings(fixture, jiraProjectId, tickets, query);
  await persistSnapshot(fixture, hash, ownerAccountId, query);
  await persistScenarios(fixture, ownerAccountId, query);
}
