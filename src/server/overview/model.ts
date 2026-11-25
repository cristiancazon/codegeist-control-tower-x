import type { Overview, OverviewEvidence, OverviewFilters, OverviewMetric, SourceState } from '../../shared/overview';
import type { JiraWorkItem } from '../data/jira/types';
import { isDateOnly } from '../data/jira/normalize';
import { executeSql } from '../data/sql/client';
import { readOverviewAlertSummary } from './alert';

type OverviewInput = {
  projectId: string;
  filters: OverviewFilters;
  jiraIssues: JiraWorkItem[] | null;
  jiraState: SourceState;
  observedAt: string;
};

type ProjectRow = { name: string; jira_project_id: string; jira_project_key: string; currency: string };
type SnapshotRow = { as_of_date: string; collected_at: string };
type PhaseRow = { code: string; name: string };
type WorkRow = { id: string; code: string; jira_issue_id: string; facility_id: string | null; milestone: number | string };
type VisibleWork = { work: WorkRow; issue: JiraWorkItem };
type ShipmentRow = {
  code: string;
  gate_work_package_id: string;
  baseline_eta: string;
  latest_eta: string | null;
  arrived_date: string | null;
};
type AssetRow = { id: string; code: string; status: string; next_available_date: string | null };
type AssignmentRow = { work_package_id: string; resource_id: string };
type FacilityRow = { code: string; id: string; name: string; status: string; map_x: string | number | null; map_y: string | number | null };
type CostRow = { record_code: string; amount_cents: string | number };
type MetricBase = Pick<OverviewMetric, 'id' | 'title' | 'unit' | 'source' | 'detail'>;

const metricBases = {
  progress: {
    id: 'progress', title: 'Avance de trabajo', unit: 'percent', source: 'JIRA',
    detail: 'Ítems terminados sobre ítems visibles con estado evaluable. Estado actual de Jira dentro de la fase seleccionada.',
  },
  overdue: {
    id: 'overdue', title: 'Ítems vencidos', unit: 'count', source: 'JIRA',
    detail: 'Ítems abiertos con vencimiento de Jira anterior al corte, entre los ítems abiertos con vencimiento informado.',
  },
  milestones: {
    id: 'milestones', title: 'Hitos completados', unit: 'count', source: 'JIRA',
    detail: 'Hitos de planificación visibles con estado terminado actual en Jira.',
  },
  logistics: {
    id: 'logistics', title: 'Envíos con demora prevista', unit: 'count', source: 'FORGE',
    detail: 'Envíos sintéticos sin arribo cuya ETA vigente supera la original. Incluye solo envíos con un ítem de recepción visible en Jira.',
  },
  assets: {
    id: 'assets', title: 'Disponibilidad de activos', unit: 'percent', source: 'FORGE',
    detail: 'Activos sintéticos disponibles entre los activos con un estado de inventario evaluable al corte.',
  },
  cost: {
    id: 'cost', title: 'Costo devengado sintético', unit: 'cents', source: 'FORGE',
    detail: 'Devengado en USD al corte del snapshot. Falta un presupuesto acumulado comparable para calcular el desvío.',
  },
} satisfies Record<string, MetricBase>;

const evidenceLimit = 5;

function unavailable(base: MetricBase, detail: string): OverviewMetric {
  return { ...base, detail, value: null, numerator: null, denominator: null, coverage: null, evidence: [] };
}

function ratioMetric(
  base: MetricBase,
  numerator: number,
  denominator: number,
  eligible: number,
  complete: boolean,
  evidence: OverviewEvidence[] = [],
): OverviewMetric {
  return {
    ...base,
    value: denominator === 0 ? null : base.unit === 'percent' ? 100 * numerator / denominator : numerator,
    numerator,
    denominator,
    coverage: complete && eligible > 0 ? denominator / eligible : null,
    evidence: evidence.slice(0, evidenceLimit),
  };
}

function statusKnown({ issue }: VisibleWork): boolean {
  return issue.status.categoryKey === 'done' || issue.status.categoryKey === 'new' || issue.status.categoryKey === 'indeterminate';
}

function workEvidence({ work, issue }: VisibleWork, value: string): OverviewEvidence {
  return { label: `${work.code} · ${issue.summary}`, value, issueKey: issue.key };
}

function readJiraMetrics(work: VisibleWork[], state: SourceState, asOf: string | null): OverviewMetric[] {
  const { progress, overdue, milestones } = metricBases;
  if (state === 'UNAVAILABLE') {
    return [progress, overdue, milestones].map((base) => unavailable(base, 'Jira no confirmó datos visibles para esta consulta.'));
  }

  const complete = state === 'READY';
  const known = work.filter(statusKnown);
  const done = known.filter(({ issue }) => issue.status.categoryKey === 'done');
  const progressMetric = ratioMetric(progress, done.length, known.length, work.length, complete,
    done.map((entry) => workEvidence(entry, entry.issue.status.name)));

  const open = known.filter(({ issue }) => issue.status.categoryKey !== 'done');
  const openWithDate = open.flatMap((entry) => isDateOnly(entry.issue.dueDate) ? [{ ...entry, dueDate: entry.issue.dueDate }] : []);
  const late = asOf ? openWithDate.filter(({ dueDate }) => dueDate < asOf) : [];
  const overdueMetric = asOf
    ? ratioMetric(overdue, late.length, openWithDate.length, open.length, complete,
      late.map((entry) => workEvidence(entry, entry.dueDate)))
    : unavailable(overdue, 'Elegí una fecha de corte para evaluar los vencimientos de Jira.');

  const visibleMilestones = work.filter(({ work }) => work.milestone === 1 || work.milestone === '1');
  const knownMilestones = visibleMilestones.filter(statusKnown);
  const completedMilestones = knownMilestones.filter(({ issue }) => issue.status.categoryKey === 'done');
  const milestonesMetric = ratioMetric(milestones, completedMilestones.length, knownMilestones.length,
    visibleMilestones.length, complete, knownMilestones.map((entry) => workEvidence(entry, entry.issue.status.name)));

  return [progressMetric, overdueMetric, milestonesMetric];
}

function normalizeSnapshot(row: SnapshotRow | undefined): Overview['snapshot'] {
  if (!row || !isDateOnly(row.as_of_date)) {
    return null;
  }
  const timestamp = row.collected_at.replace(' ', 'T');
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ? timestamp : `${timestamp}Z`);
  return Number.isNaN(date.getTime()) ? null : { asOf: row.as_of_date, collectedAt: date.toISOString() };
}

function logisticsMetric(shipments: ShipmentRow[], visible: ReadonlyMap<string, VisibleWork>, jiraState: SourceState): OverviewMetric {
  const base = metricBases.logistics;
  if (jiraState === 'UNAVAILABLE') {
    return unavailable(base, 'Jira no confirmó cuáles recepciones están disponibles para esta cuenta.');
  }
  const authorized = shipments.filter((shipment) => visible.has(shipment.gate_work_package_id));
  const known = authorized.filter((shipment) =>
    isDateOnly(shipment.arrived_date) || (isDateOnly(shipment.baseline_eta) && isDateOnly(shipment.latest_eta)));
  const delayed = known.filter((shipment) =>
    shipment.arrived_date === null && shipment.latest_eta !== null && shipment.latest_eta > shipment.baseline_eta);
  return ratioMetric(base, delayed.length, known.length, authorized.length, jiraState === 'READY',
    delayed.map((shipment) => ({
      label: shipment.code,
      value: `${shipment.baseline_eta} → ${shipment.latest_eta}`,
      issueKey: visible.get(shipment.gate_work_package_id)?.issue.key,
    })));
}

function availabilityMetric(assets: AssetRow[], phaseScoped: boolean, jiraState: SourceState): OverviewMetric {
  const base = metricBases.assets;
  if (phaseScoped && jiraState === 'UNAVAILABLE') {
    return unavailable(base, 'Jira no confirmó qué ítems vinculan activos con la fase seleccionada.');
  }

  const known = assets.filter((asset) => asset.status === 'AVAILABLE' || asset.status === 'MAINTENANCE');
  const ready = known.filter((asset) => asset.status === 'AVAILABLE');
  return ratioMetric(base, ready.length, known.length, assets.length, !phaseScoped || jiraState === 'READY',
    known.map((asset) => ({
      label: asset.code,
      value: asset.status === 'AVAILABLE' ? 'Disponible' : `Mantenimiento${asset.next_available_date ? ` hasta ${asset.next_available_date}` : ''}`,
    })));
}

function accruedCostMetric(rows: CostRow[], currency: string, asOf: string): OverviewMetric {
  const base = metricBases.cost;
  if (rows.length === 0) {
    return unavailable(base, 'El snapshot no registra costos devengados para este corte.');
  }

  const cents = rows.map((row) => String(row.amount_cents));
  if (cents.some((value) => !/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
    return unavailable(base, 'El snapshot contiene importes incompletos.');
  }
  const total = cents.reduce((sum, value) => sum + BigInt(value), 0n);
  const value = Number(total);
  if (!Number.isSafeInteger(value)) {
    return unavailable(base, 'El total supera el formato de importe admitido por Overview.');
  }

  const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency });
  return {
    ...base,
    detail: `${base.detail} Corte contable ${asOf}.`,
    value,
    numerator: null,
    denominator: null,
    coverage: 1,
    evidence: rows.slice(0, evidenceLimit).map((row) => ({
      label: row.record_code,
      value: money.format(Number(row.amount_cents) / 100),
    })),
  };
}

function mapPoints(facilities: FacilityRow[]): Overview['map'] {
  return facilities.flatMap(({ code, name, status, map_x, map_y }) => {
    if (map_x === null || map_y === null) {
      return [];
    }
    const x = Number(map_x);
    const y = Number(map_y);
    return Number.isFinite(x) && x >= 0 && x <= 1 && Number.isFinite(y) && y >= 0 && y <= 1
      ? [{ code, name, status, x, y }]
      : [];
  });
}

export async function readOverview(
  { projectId, filters, jiraIssues, jiraState, observedAt }: OverviewInput,
  query: typeof executeSql = executeSql,
): Promise<Overview | undefined> {
  const projects = await query<ProjectRow>(
    `SELECT name, jira_project_id, jira_project_key, currency FROM ctx_project
     WHERE id = ? AND status = 'ACTIVE' AND data_mode = 'DEMO'`,
    [projectId],
  );
  const project = projects[0];
  if (!project) {
    return undefined;
  }

  const phaseCode = filters.phaseCode ?? null;
  const requestedCut = filters.asOf ?? null;
  const [phases, snapshots, mappedWork] = await Promise.all([
    query<PhaseRow>('SELECT code, name FROM ctx_phase WHERE project_id = ? ORDER BY ordinal, code', [projectId]),
    query<SnapshotRow>(
      `SELECT CAST(as_of_date AS CHAR) AS as_of_date, CAST(collected_at AS CHAR) AS collected_at
       FROM ctx_data_snapshot WHERE project_id = ? AND state = 'SEALED' AND expires_at > UTC_TIMESTAMP(3)
         AND access_class = 'SYNTHETIC_DEMO' AND (? IS NULL OR as_of_date <= ?)
       ORDER BY as_of_date DESC, collected_at DESC, id DESC LIMIT 1`,
      [projectId, requestedCut, requestedCut],
    ),
    query<WorkRow>(
      `SELECT w.id, w.code, w.jira_issue_id, w.facility_id, w.milestone
       FROM ctx_work_package w INNER JOIN ctx_phase ph ON ph.id = w.phase_id AND ph.project_id = w.project_id
       WHERE w.project_id = ? AND w.tombstoned_at IS NULL AND (? IS NULL OR ph.code = ?) ORDER BY w.code`,
      [projectId, phaseCode, phaseCode],
    ),
  ]);
  const snapshot = normalizeSnapshot(snapshots[0]);
  const asOf = requestedCut ?? snapshot?.asOf ?? null;
  const pointDataReady = snapshot !== null && snapshot.asOf === asOf;
  const snapshotTime = snapshot?.collectedAt.slice(0, 23).replace('T', ' ') ?? null;
  const authorizedIssues = jiraIssues === null || jiraState === 'UNAVAILABLE'
    ? null
    : jiraIssues.filter((issue) => issue.projectId === project.jira_project_id);
  const sourceState = authorizedIssues === null ? 'UNAVAILABLE' : jiraState;
  const issuesById = new Map(authorizedIssues?.map((issue) => [issue.id, issue]));
  const visible = mappedWork.flatMap((work) => {
    const issue = issuesById.get(work.jira_issue_id);
    return issue ? [{ work, issue }] : [];
  });
  const visibleById = new Map(visible.map((entry) => [entry.work.id, entry]));
  const allowedFacilities = new Set(visible.flatMap(({ work }) => work.facility_id ? [work.facility_id] : []));

  // A sealed synthetic snapshot supplies point observations only at its own date.
  const [shipments, assets, assignments, facilities, costs, alert] = await Promise.all([
    pointDataReady && authorizedIssues !== null ? query<ShipmentRow>(
      `SELECT code, gate_work_package_id, CAST(baseline_eta AS CHAR) AS baseline_eta,
              CAST(latest_eta AS CHAR) AS latest_eta, CAST(arrived_date AS CHAR) AS arrived_date
       FROM ctx_shipment WHERE project_id = ? AND updated_at <= ? ORDER BY code`,
      [projectId, snapshotTime],
    ) : [],
    pointDataReady ? query<AssetRow>(
      `SELECT id, code, status, CAST(next_available_date AS CHAR) AS next_available_date FROM ctx_asset
       WHERE project_id = ? AND tombstoned_at IS NULL AND workspace_id IS NULL AND assets_object_id IS NULL
         AND source_updated_at <= ? ORDER BY code`,
      [projectId, snapshotTime],
    ) : [],
    pointDataReady && phaseCode !== null && authorizedIssues !== null ? query<AssignmentRow>(
      `SELECT work_package_id, resource_id FROM ctx_work_resource WHERE project_id = ? AND resource_kind = 'ASSET'`,
      [projectId],
    ) : [],
    pointDataReady ? query<FacilityRow>(
      `SELECT id, code, name, status, map_x, map_y FROM ctx_facility WHERE project_id = ? ORDER BY code`,
      [projectId],
    ) : [],
    snapshot && phaseCode === null ? query<CostRow>(
      `SELECT record_code, amount_cents FROM ctx_cost_record
       WHERE project_id = ? AND currency = ? AND kind = 'ACTUAL' AND actuality = 'ACTUAL' AND unit_code = 'USD_CENT'
         AND work_package_id IS NULL AND effective_date <= ?
       ORDER BY effective_date DESC, record_code`,
      [projectId, project.currency, snapshot.asOf],
    ) : [],
    pointDataReady && authorizedIssues !== null
      ? readOverviewAlertSummary({ projectId, filters: { ...filters, asOf: snapshot.asOf }, jiraIssues: authorizedIssues }, query)
      : undefined,
  ]);

  const eligibleAssetIds = new Set(assignments
    .filter((assignment) => visibleById.has(assignment.work_package_id))
    .map((assignment) => assignment.resource_id));
  const eligibleAssets = phaseCode === null ? assets : assets.filter((asset) => eligibleAssetIds.has(asset.id));

  const noPointData = 'No hay un snapshot sintético sellado y vigente para el corte seleccionado.';
  const logistics = pointDataReady
    ? logisticsMetric(shipments, visibleById, sourceState) : unavailable(metricBases.logistics, noPointData);
  const availability = pointDataReady
    ? availabilityMetric(eligibleAssets, phaseCode !== null, sourceState) : unavailable(metricBases.assets, noPointData);
  const cost = phaseCode !== null
    ? unavailable(metricBases.cost, 'El devengado mensual sintético se registra para todo el proyecto. Falta atribución por fase.')
    : snapshot ? accruedCostMetric(costs, project.currency, snapshot.asOf)
      : unavailable(metricBases.cost, 'No hay un snapshot sintético sellado y vigente para consultar el devengado.');
  const confirmedAlert = alert && shipments.some((shipment) => shipment.code === alert.code &&
    shipment.baseline_eta === alert.baselineEta && shipment.latest_eta === alert.currentEta &&
    shipment.arrived_date === null && visibleById.has(shipment.gate_work_package_id));

  return {
    project: { name: project.name, key: project.jira_project_key, currency: project.currency },
    asOf,
    snapshot,
    phases,
    sources: [
      {
        source: 'JIRA', state: sourceState, observedAt: sourceState === 'UNAVAILABLE' ? null : observedAt,
        detail: sourceState === 'READY' ? 'Estado actual de los ítems del plan visibles en Jira.'
          : sourceState === 'PARTIAL' ? 'Consulta incompleta. Los indicadores Jira usan solo los ítems visibles recuperados.'
            : 'Jira no confirmó los datos del proyecto para esta consulta.',
      },
      {
        source: 'FORGE', state: pointDataReady ? 'READY' : snapshot ? 'PARTIAL' : 'UNAVAILABLE',
        observedAt: snapshot?.collectedAt ?? null,
        detail: pointDataReady ? 'Snapshot sellado con registros y ubicaciones sintéticos de la demostración.'
          : snapshot ? `El último snapshot sintético disponible corresponde a ${snapshot.asOf}.` : noPointData,
      },
    ],
    metrics: [...readJiraMetrics(visible, sourceState, asOf), logistics, availability, cost],
    alerts: confirmedAlert ? [alert] : [],
    map: mapPoints(phaseCode === null ? facilities : facilities.filter((facility) => allowedFacilities.has(facility.id))),
  };
}
