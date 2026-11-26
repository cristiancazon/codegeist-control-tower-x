import { randomUUID } from 'node:crypto';
import { canonicalJson, sha256 } from '../../domain/futuros/digest';
import type { FuturosScenario, FuturosScenarioEdit } from '../../shared/futuros';
import { fixture } from '../data/bootstrap/fixture';
import { isRecord } from '../data/jira/normalize';
import { executeSql } from '../data/sql/client';

const baseline = fixture.scenarios.find(({ code }) => code === 'S0')!;
const supply = fixture.shipments.find(({ code }) => code === 'A-17')!;
const baselineHash = sha256(canonicalJson(baseline));
const profileVersion = 'patagonia-a17-delay-v1';
const minimumDays = 0;
const maximumDays = 365;
const source = 'Patagonia Energy Development · A-17 · ETA base del snapshot';
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export class ScenarioEditFailure extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'INVALID_REQUEST' | 'INVALID_SCENARIO' | 'STALE_INPUT' | 'CONFLICT') {
    super(code);
  }
}

function editedName(value: unknown) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) return undefined;
  const name = value.trim().normalize('NFC');
  return name.length >= 1 && name.length <= 120 ? name : undefined;
}

function validDelay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimumDays && value <= maximumDays;
}

export function parseScenarioEdit(value: Record<string, unknown>): FuturosScenarioEdit {
  const { sourceScenarioId, expectedRevision, delayDays, idempotencyKey } = value;
  const name = editedName(value.name);
  if (typeof sourceScenarioId !== 'string' || !uuidPattern.test(sourceScenarioId) ||
      typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) ||
      expectedRevision < 1 || expectedRevision >= 2_147_483_647 || !name || !validDelay(delayDays) ||
      typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(idempotencyKey)) {
    throw new ScenarioEditFailure('INVALID_REQUEST');
  }
  return { sourceScenarioId, expectedRevision, name, delayDays, idempotencyKey };
}

function delayVariable(delayDays: number) {
  return {
    ordinal: 1, variableCode: 'SUPPLY_DELAY_DAYS' as const, targetKind: 'SHIPMENT' as const,
    targetId: supply.id, unitCode: 'DAY' as const, value: delayDays, sourceRefs: [supply.sourceRef],
    reason: 'Demora adicional de planificación sobre la ETA base de A-17.', assumption: true as const,
  };
}

type EditorIdentity = {
  id: string; project_id: string; snapshot_id: string; root_id: string; baseline_id: string | null;
  previous_id: string | null; revision: number; name: string; schema_version: number;
};
type EditorRow = EditorIdentity & {
  content_hash: string; request_hash: string; editor_definition_jcs: string | null; as_of: string;
};

const editorFields = `c.id, c.project_id, c.snapshot_id, c.root_id, c.baseline_id, c.previous_id,
  c.revision, c.name, c.schema_version, c.content_hash, c.request_hash, c.editor_definition_jcs,
  CAST(s.as_of_date AS CHAR) AS as_of`;
const activeScenario = `FROM ctx_scenario c
  INNER JOIN ctx_project p ON p.id = c.project_id AND p.data_mode = 'DEMO' AND p.status = 'ACTIVE'
  INNER JOIN ctx_data_snapshot s ON s.id = c.snapshot_id AND s.project_id = c.project_id
  WHERE c.project_id = ? AND c.snapshot_id = ? AND c.state = 'PUBLISHED'
    AND s.state = 'SEALED' AND s.access_class = 'SYNTHETIC_DEMO' AND s.expires_at > UTC_TIMESTAMP(3)`;
const plannerPermission = `EXISTS (SELECT 1 FROM ctx_project_role r
  WHERE r.project_id = c.project_id AND r.account_id = ? AND r.role_code = 'PLANNER' AND r.revoked_at IS NULL)`;

function definitionFor(delayDays: number) {
  return { profileVersion, variable: delayVariable(delayDays) };
}

function contentHash(row: EditorIdentity, definition: ReturnType<typeof definitionFor>) {
  const { id, project_id, snapshot_id, root_id, baseline_id, previous_id, revision, name, schema_version } = row;
  return sha256(canonicalJson({ id, project_id, snapshot_id, root_id, baseline_id, previous_id, revision, name,
    schema_version, definition }));
}

export function baselineEditor(): NonNullable<FuturosScenario['editor']> {
  return { mode: 'clone', delayDays: 0, minimumDays, maximumDays, unit: 'DAY', baselineScenarioId: baseline.id,
    previousScenarioId: null, source };
}

function readEditorRow(row: EditorRow) {
  if (row.project_id !== fixture.project.id || row.snapshot_id !== fixture.snapshot.id ||
      row.baseline_id !== baseline.id || row.schema_version !== fixture.snapshot.schemaVersion ||
      !uuidPattern.test(row.id) || !uuidPattern.test(row.root_id) || !row.previous_id || !uuidPattern.test(row.previous_id) ||
      row.previous_id === row.id || !Number.isInteger(row.revision) || row.revision < 1 ||
      (row.revision === 1 ? row.root_id !== row.id || row.previous_id !== baseline.id
        : row.root_id === row.id || row.previous_id === baseline.id) ||
      row.name !== editedName(row.name) || row.as_of !== fixture.snapshot.asOfDate ||
      typeof row.editor_definition_jcs !== 'string' || Buffer.byteLength(row.editor_definition_jcs) > 4096) {
    throw new ScenarioEditFailure('STALE_INPUT');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.editor_definition_jcs);
  } catch {
    throw new ScenarioEditFailure('STALE_INPUT');
  }
  if (!isRecord(parsed) || !isRecord(parsed.variable) || !validDelay(parsed.variable.value)) {
    throw new ScenarioEditFailure('STALE_INPUT');
  }
  const definition = definitionFor(parsed.variable.value);
  if (canonicalJson(definition) !== row.editor_definition_jcs || contentHash(row, definition) !== row.content_hash) {
    throw new ScenarioEditFailure('STALE_INPUT');
  }
  const scenario: FuturosScenario = {
    id: row.id, name: row.name, code: `V-${row.root_id.slice(0, 8).toUpperCase()}`, revision: row.revision,
    snapshotId: row.snapshot_id, asOf: row.as_of, scenarioHash: row.content_hash,
    editor: { ...baselineEditor(), mode: 'revise', delayDays: definition.variable.value, previousScenarioId: row.previous_id },
  };
  return { scenario, variable: definition.variable };
}

export async function loadScenarioRevision(projectId: string, scenarioId: string, query = executeSql) {
  const rows = await query<EditorRow>(`SELECT ${editorFields} ${activeScenario}
    AND c.id = ? AND c.editor_definition_jcs IS NOT NULL`, [projectId, fixture.snapshot.id, scenarioId]);
  if (!rows[0]) throw new ScenarioEditFailure('FORBIDDEN');
  return readEditorRow(rows[0]);
}

export async function listScenarioRevisions(projectId: string, query = executeSql) {
  const rows = await query<EditorRow>(`SELECT ${editorFields} ${activeScenario}
    AND c.editor_definition_jcs IS NOT NULL ORDER BY c.created_at DESC, c.revision DESC, c.id LIMIT 100`,
  [projectId, fixture.snapshot.id]);
  return rows.flatMap((row) => {
    try {
      return [readEditorRow(row).scenario];
    } catch (error) {
      if (error instanceof ScenarioEditFailure) return [];
      throw error;
    }
  });
}

export async function publishScenarioRevision(
  projectId: string, actor: string, edit: FuturosScenarioEdit,
  validateCandidate: (delayDays: number) => Promise<void>, query = executeSql,
): Promise<FuturosScenario> {
  if (projectId !== fixture.project.id) throw new ScenarioEditFailure('FORBIDDEN');
  const { sourceScenarioId, expectedRevision, name, delayDays, idempotencyKey } = edit;
  const requestHash = sha256(canonicalJson({ sourceScenarioId, expectedRevision, name, delayDays }));
  const keyParameters = [projectId, fixture.snapshot.id, actor, idempotencyKey, actor];
  async function replay() {
    const rows = await query<EditorRow>(`SELECT ${editorFields} ${activeScenario}
      AND c.created_by = ? AND c.idempotency_key = ? AND ${plannerPermission}`, keyParameters);
    const row = rows[0];
    if (!row) return undefined;
    if (row.request_hash !== requestHash) throw new ScenarioEditFailure('CONFLICT');
    return readEditorRow(row).scenario;
  }

  const existing = await replay();
  if (existing) return existing;
  const sourceRows = await query<EditorRow>(`SELECT ${editorFields} ${activeScenario}
    AND c.id = ? AND ${plannerPermission}`, [projectId, fixture.snapshot.id, sourceScenarioId, actor]);
  const origin = sourceRows[0];
  if (!origin) throw new ScenarioEditFailure('FORBIDDEN');
  const clone = sourceScenarioId === baseline.id;
  if (clone) {
    if (origin.editor_definition_jcs !== null || origin.schema_version !== fixture.snapshot.schemaVersion ||
        origin.revision !== baseline.revision || origin.content_hash !== baselineHash) {
      throw new ScenarioEditFailure('STALE_INPUT');
    }
  } else {
    if (!origin.editor_definition_jcs) throw new ScenarioEditFailure('INVALID_SCENARIO');
    readEditorRow(origin);
  }
  if (origin.revision !== expectedRevision) throw new ScenarioEditFailure('STALE_INPUT');
  await validateCandidate(delayDays);

  const id = randomUUID();
  const rootId = clone ? id : origin.root_id;
  const revision = clone ? 1 : expectedRevision + 1;
  const definition = definitionFor(delayDays);
  const manifest = canonicalJson(definition);
  const hash = contentHash({ id, project_id: projectId, snapshot_id: fixture.snapshot.id, root_id: rootId,
    baseline_id: baseline.id, previous_id: sourceScenarioId, revision, name, schema_version: fixture.snapshot.schemaVersion },
  definition);
  // One statement publishes the complete revision. A competing edit or replay cannot overwrite it.
  await query(`INSERT INTO ctx_scenario (
      id, project_id, snapshot_id, root_id, baseline_id, previous_id, revision, name, schema_version,
      state, content_hash, request_hash, idempotency_key, created_by, created_at, published_at, editor_definition_jcs
    ) SELECT ?, c.project_id, c.snapshot_id, ?, ?, c.id, ?, ?, c.schema_version, 'PUBLISHED', ?, ?, ?, ?,
      UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ? ${activeScenario}
    AND c.id = ? AND c.revision = ? AND c.content_hash = ? AND c.schema_version = ?
    AND ${plannerPermission}
    AND (? = 1 OR NOT EXISTS (SELECT 1 FROM ctx_scenario newer
      WHERE newer.project_id = c.project_id AND newer.root_id = c.root_id AND newer.revision > c.revision))
    ON DUPLICATE KEY UPDATE id = ctx_scenario.id`,
  [id, rootId, baseline.id, revision, name, hash, requestHash, idempotencyKey, actor, manifest,
    projectId, fixture.snapshot.id, sourceScenarioId, expectedRevision, origin.content_hash, fixture.snapshot.schemaVersion,
    actor, clone ? 1 : 0]);

  const result = await replay();
  if (result) return result;
  const visible = await query<{ id: string }>(`SELECT c.id ${activeScenario} AND c.id = ? AND ${plannerPermission}`,
    [projectId, fixture.snapshot.id, sourceScenarioId, actor]);
  if (!visible.length) throw new ScenarioEditFailure('FORBIDDEN');
  throw new ScenarioEditFailure('STALE_INPUT');
}
