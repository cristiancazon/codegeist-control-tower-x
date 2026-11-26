import { canonicalJson, sha256 } from '../../domain/futuros/digest';
import type { EngineInput, Resource, SupplyGate, Task } from '../../domain/futuros/types';
import type { PatagoniaFixture } from '../../domain/fixtures/patagonia';
import { fixture } from '../data/bootstrap/fixture';
import { isDateOnly, isRecord } from '../data/jira/normalize';
import type { JiraWorkItem } from '../data/jira/types';
import { executeSql } from '../data/sql/client';

export const futurosScenarioCodes = ['S0', 'S1', 'S2', 'S3', 'S4'] as const;
type ScenarioCode = typeof futurosScenarioCodes[number];

export class SnapshotFailure extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'INVALID_SCENARIO' | 'STALE_INPUT' | 'INSUFFICIENT_DATA') {
    super(code);
  }
}

const listSections = [
  'zones', 'phases', 'facilities', 'contractors', 'assets', 'crewPools', 'workPackages',
  'dependencies', 'shipments', 'workResources', 'resourceWindows', 'costRecords', 'historicalMetrics',
] as const;
type SnapshotSections = Pick<PatagoniaFixture, typeof listSections[number]> & { project: [PatagoniaFixture['project']] };
const sectionNames = ['project', ...listSections];
const sectionSet = new Set<string>(sectionNames);
const expectedSnapshot = {
  project: [fixture.project],
  ...Object.fromEntries(listSections.map((section) => [section, fixture[section]])),
};
const expectedContentHash = sha256(canonicalJson({ schemaVersion: fixture.snapshot.schemaVersion, sections: expectedSnapshot }));
const seededScenario = new Map<string, PatagoniaFixture['scenarios'][number]>(fixture.scenarios.map((scenario) => [scenario.id, scenario]));
const expectedScenarioHash = new Map(fixture.scenarios.map((scenario) => [scenario.id, sha256(canonicalJson(scenario))]));
const dayMilliseconds = 86_400_000;

type SnapshotRow = {
  snapshot_id: string; snapshot_hash: string; schema_version: number; scenario_version: number; chunk_count: number;
  as_of: string; scenario_hash: string; revision: number;
};
type Chunk = { chunk_index: number; chunk_hash: string; payload_jcs: string };
type Variable = {
  ordinal: number; variable_code: string; target_kind: string; target_id: string;
  unit_code: string; value_jcs: string; evidence_jcs: string; reason: string;
};

function readSections(row: SnapshotRow, chunks: Chunk[]): SnapshotSections {
  if (row.schema_version !== fixture.snapshot.schemaVersion || row.snapshot_hash !== expectedContentHash ||
      !Number.isInteger(row.chunk_count) || row.chunk_count < sectionNames.length || row.chunk_count > 160 ||
      chunks.length !== row.chunk_count) {
    throw new SnapshotFailure('STALE_INPUT');
  }
  const sections: Record<string, unknown[]> = {};
  for (const [index, chunk] of chunks.entries()) {
    if (chunk.chunk_index !== index || typeof chunk.payload_jcs !== 'string' ||
        Buffer.byteLength(chunk.payload_jcs) > 128 * 1024 || sha256(chunk.payload_jcs) !== chunk.chunk_hash) {
      throw new SnapshotFailure('STALE_INPUT');
    }
    let value: unknown;
    try {
      value = JSON.parse(chunk.payload_jcs);
    } catch {
      throw new SnapshotFailure('STALE_INPUT');
    }
    if (!isRecord(value) || typeof value.section !== 'string' || !sectionSet.has(value.section) ||
        !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 50 || canonicalJson(value) !== chunk.payload_jcs) {
      throw new SnapshotFailure('STALE_INPUT');
    }
    (sections[value.section] ??= []).push(...value.rows);
  }
  if (sha256(canonicalJson({ schemaVersion: row.schema_version, sections })) !== row.snapshot_hash) {
    throw new SnapshotFailure('STALE_INPUT');
  }
  // This V1 profile is pinned to the validated Patagonia snapshot schema and digest.
  return sections as unknown as SnapshotSections;
}

function validateVariables(scenario: PatagoniaFixture['scenarios'][number], row: SnapshotRow, variables: Variable[]) {
  if (row.scenario_hash !== expectedScenarioHash.get(scenario.id) || row.revision !== scenario.revision ||
      row.scenario_version !== row.schema_version || variables.length !== scenario.variables.length ||
      variables.some((record, index) => {
        const variable = scenario.variables[index];
        return !variable || record.ordinal !== variable.ordinal || record.variable_code !== variable.variableCode ||
          record.target_kind !== variable.targetKind || record.target_id !== variable.targetId ||
          record.unit_code !== variable.unitCode || record.reason !== variable.reason ||
          record.value_jcs !== canonicalJson(variable.value) || record.evidence_jcs !== canonicalJson(variable.sourceRefs);
      })) {
    throw new SnapshotFailure('INVALID_SCENARIO');
  }
}

function day(iso: string, cut: string) {
  return (Date.parse(iso) - Date.parse(cut)) / dayMilliseconds;
}

function addCrewOverride(resource: Resource, value: { capacity: number; fromDay: number; untilDay: number }) {
  resource.windows = resource.windows.flatMap((window) => {
    const from = Math.max(window.fromDay, value.fromDay);
    const until = Math.min(window.untilDay, value.untilDay);
    if (until <= from) return [window];
    return [
      { ...window, untilDay: from },
      { fromDay: from, untilDay: until, capacity: Math.min(window.capacity, value.capacity) },
      { ...window, fromDay: until },
    ].filter(({ fromDay, untilDay }) => untilDay > fromDay);
  });
}

function buildInput(
  row: SnapshotRow, scenario: PatagoniaFixture['scenarios'][number], sections: SnapshotSections, seed: string, sampleCount: number,
): EngineInput {
  const [project] = sections.project;
  const asOf = row.as_of;
  const tasks: Task[] = sections.workPackages.map((work) => ({
    id: work.id, code: work.code, duration: [work.durationA, work.durationM, work.durationB],
    releaseDay: day(work.earliestStart, asOf), priority: work.priorityRank, milestone: work.milestone,
    ...(work.actualStart && work.actualFinish ? {
      actual: { startDay: day(work.actualStart, asOf), finishDay: day(work.actualFinish, asOf) },
    } : {}),
    requirements: sections.workResources.filter(({ workPackageId }) => workPackageId === work.id)
      .map(({ resourceId, quantity }) => ({ resourceId, quantity })),
  }));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const resourcesById = new Map<string, Resource>();
  for (const window of sections.resourceWindows) {
    const resource = resourcesById.get(window.resourceId) ?? { id: window.resourceId, kind: window.resourceKind, windows: [] };
    resource.windows.push({
      fromDay: day(window.windowStart, asOf), untilDay: day(window.windowEnd, asOf), capacity: window.capacity,
    });
    resourcesById.set(resource.id, resource);
  }
  for (const resource of resourcesById.values()) {
    resource.windows.sort((a, b) => a.fromDay - b.fromDay);
  }
  const shipment = sections.shipments.find(({ code }) => code === 'A-17');
  const receipt = shipment && taskById.get(shipment.gateWorkPackageId);
  if (!shipment || !receipt || receipt.actual || day(shipment.baselineEta, asOf) !== receipt.duration[1]) {
    throw new SnapshotFailure('INSUFFICIENT_DATA');
  }
  const gate: SupplyGate = { id: shipment.id, taskId: receipt.id, delivery: receipt.duration, delayDays: 0 };
  for (const { variableCode, targetId, value } of scenario.variables) {
    if (variableCode === 'SUPPLY_DELAY_DAYS' && targetId === gate.id && typeof value === 'number') {
      gate.delayDays = value;
      continue;
    }
    if (variableCode === 'ALTERNATE_SUPPLY' && targetId === gate.id && typeof value === 'object' && 'compatible' in value &&
        value.compatible && sections.contractors.some((supplier) =>
          supplier.id === value.contractorId && supplier.a17Qualification === 'QUALIFIED_ALTERNATE')) {
      gate.alternative = { offsetDays: value.etaOffsetDays, commitmentCents: value.commitmentCents };
      continue;
    }
    const resource = resourcesById.get(targetId);
    if (variableCode === 'ASSET_AVAILABLE_DAY' && resource?.kind === 'ASSET' && typeof value === 'number') {
      resource.windows = resource.windows.map((window) => window.capacity > 0
        ? { ...window, fromDay: Math.max(window.fromDay, value) } : window)
        .filter(({ fromDay, untilDay }) => untilDay > fromDay);
      continue;
    }
    if (variableCode === 'CREW_CAPACITY' && resource?.kind === 'CREW' && typeof value === 'object' && 'capacity' in value) {
      addCrewOverride(resource, value);
      continue;
    }
    throw new SnapshotFailure('INVALID_SCENARIO');
  }
  const actual = sections.costRecords.filter(({ kind }) => kind === 'ACTUAL');
  const remaining = sections.costRecords.filter(({ kind }) => kind === 'FIXED_REMAINING');
  const remainingTasks = new Set(remaining.map(({ workPackageId }) => workPackageId));
  const indirect = sections.costRecords.filter(({ kind, costBucket }) => kind === 'DAILY_RATE' && costBucket === 'PROJECT_INDIRECT');
  const rates = sections.costRecords.filter(({ kind, costBucket }) => kind === 'DAILY_RATE' && costBucket !== 'PROJECT_INDIRECT');
  if (indirect.length !== 1 || !indirect[0] || !actual.length ||
      tasks.some(({ id, actual, milestone }) => !actual && !milestone && !remainingTasks.has(id))) {
    throw new SnapshotFailure('INSUFFICIENT_DATA');
  }
  const summation = (values: Array<{ amountCents: string }>) =>
    values.reduce((sum, { amountCents }) => sum + BigInt(amountCents), 0n).toString();
  const standby = rates.map((rate) => {
    const taskId = rate.workPackageId;
    const resourceId = rate.assetId ?? rate.crewPoolId;
    if (!taskId || !resourceId) throw new SnapshotFailure('INSUFFICIENT_DATA');
    return {
      taskId, resourceId, rateCentsPerDay: rate.amountCents, mobilizedDay: day(rate.effectiveDate, asOf), quantity: 1,
    };
  });
  return {
    snapshotId: row.snapshot_id, snapshotHash: row.snapshot_hash, scenarioId: scenario.id, scenarioHash: row.scenario_hash,
    asOf, calendar: 'CONTINUOUS', currency: project.currency, seed, sampleCount, horizon: 730,
    targetDay: day(project.targetDate, asOf), budgetCents: project.budgetCents,
    tasks, dependencies: sections.dependencies.map(({ predecessorId, successorId, lagDays }) => ({ predecessorId, successorId, lagDays })),
    resources: [...resourcesById.values()], gates: [gate], risks: [],
    costs: { actualCents: summation(actual), remainingCents: summation(remaining), indirectCentsPerDay: indirect[0].amountCents, standby },
  };
}

export async function loadFuturosSnapshot(profile: {
  projectId: string; scenarioId: string; seed: string; sampleCount: number; snapshotId?: string;
}, query: typeof executeSql = executeSql): Promise<EngineInput> {
  const scenario = seededScenario.get(profile.scenarioId);
  if (profile.projectId !== fixture.project.id || !scenario) throw new SnapshotFailure('FORBIDDEN');
  const rows = await query<SnapshotRow>(
    `SELECT s.id AS snapshot_id, s.content_hash AS snapshot_hash, s.schema_version, s.chunk_count,
            CAST(s.as_of_date AS CHAR) AS as_of, c.schema_version AS scenario_version, c.content_hash AS scenario_hash, c.revision
     FROM ctx_scenario c
     INNER JOIN ctx_project p ON p.id = c.project_id AND p.data_mode = 'DEMO' AND p.status = 'ACTIVE'
     INNER JOIN ctx_data_snapshot s ON s.id = c.snapshot_id AND s.project_id = c.project_id
     WHERE c.project_id = ? AND c.id = ? AND s.id = ? AND c.state = 'PUBLISHED'
       AND s.state = 'SEALED' AND s.access_class = 'SYNTHETIC_DEMO' AND s.expires_at > UTC_TIMESTAMP(3)`,
    [profile.projectId, profile.scenarioId, profile.snapshotId ?? scenario.snapshotId],
  );
  const row = rows[0];
  if (!row || row.snapshot_id !== fixture.snapshot.id || !isDateOnly(row.as_of) || row.as_of !== fixture.snapshot.asOfDate) {
    throw new SnapshotFailure('STALE_INPUT');
  }
  const [chunks, variables] = await Promise.all([
    query<Chunk>(`SELECT k.chunk_index, k.chunk_hash, k.payload_jcs FROM ctx_snapshot_chunk k
      INNER JOIN ctx_data_snapshot s ON s.id = k.snapshot_id
      WHERE k.snapshot_id = ? AND s.project_id = ? ORDER BY k.chunk_index LIMIT 161`, [row.snapshot_id, profile.projectId]),
    query<Variable>(`SELECT v.ordinal, v.variable_code, v.target_kind, v.target_id, v.unit_code, v.value_jcs,
      v.evidence_jcs, v.reason FROM ctx_scenario_variable v INNER JOIN ctx_scenario c ON c.id = v.scenario_id
      WHERE c.project_id = ? AND c.id = ? ORDER BY v.ordinal LIMIT 20`, [profile.projectId, scenario.id]),
  ]);
  validateVariables(scenario, row, variables);
  return buildInput(row, scenario, readSections(row, chunks), profile.seed, profile.sampleCount);
}

export async function confirmFuturosVisibility(projectId: string, jiraProjectId: string, jiraIssues: readonly JiraWorkItem[],
  query: typeof executeSql = executeSql): Promise<boolean> {
  if (projectId !== fixture.project.id || jiraIssues.length < fixture.workPackages.length) return false;
  const visible = new Set(jiraIssues.filter((issue) => issue.projectId === jiraProjectId).map(({ id }) => id));
  const rows = await query<{ id: string; jira_issue_id: string }>(
    `SELECT w.id, w.jira_issue_id FROM ctx_work_package w
     INNER JOIN ctx_source_mapping m ON m.project_id = w.project_id AND m.entity_id = w.id AND m.source_id = w.jira_issue_id
     WHERE w.project_id = ? AND w.tombstoned_at IS NULL AND m.source_system = 'JIRA' AND m.source_scope = ?
       AND m.entity_kind = 'WORK_PACKAGE' AND m.tombstoned_at IS NULL`,
    [projectId, jiraProjectId],
  );
  const work = new Map(rows.map(({ id, jira_issue_id }) => [id, jira_issue_id]));
  return fixture.workPackages.every(({ id }) => {
    const issueId = work.get(id);
    return issueId !== undefined && visible.has(issueId);
  });
}

export async function listFuturosScenarios(projectId: string, query: typeof executeSql = executeSql) {
  if (projectId !== fixture.project.id) return [];
  const rows = await query<{ id: string; name: string; revision: number; content_hash: string; snapshot_id: string; as_of: string }>(
    `SELECT c.id, c.name, c.revision, c.content_hash, c.snapshot_id, CAST(s.as_of_date AS CHAR) AS as_of
     FROM ctx_scenario c INNER JOIN ctx_data_snapshot s ON s.id = c.snapshot_id AND s.project_id = c.project_id
     WHERE c.project_id = ? AND s.id = ? AND c.state = 'PUBLISHED' AND s.state = 'SEALED'
       AND s.access_class = 'SYNTHETIC_DEMO' AND s.expires_at > UTC_TIMESTAMP(3) ORDER BY c.id LIMIT 30`,
    [projectId, fixture.snapshot.id],
  );
  return rows.flatMap((row) => {
    const scenario = seededScenario.get(row.id);
    if (!scenario || !isDateOnly(row.as_of) || row.content_hash !== expectedScenarioHash.get(row.id) ||
        !futurosScenarioCodes.includes(scenario.code as ScenarioCode)) return [];
    return [{ id: row.id, code: scenario.code as ScenarioCode, name: row.name, revision: row.revision,
      snapshotId: row.snapshot_id, asOf: row.as_of }];
  }).sort((a, b) => a.code.localeCompare(b.code));
}
