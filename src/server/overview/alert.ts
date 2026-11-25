import { PATAGONIA_FIXTURE_VERSION } from '../../domain/fixtures/patagonia';
import type { OverviewAlert, OverviewAlertDetail, OverviewFilters } from '../../shared/overview';
import { isDateOnly } from '../data/jira/normalize';
import type { JiraWorkItem } from '../data/jira/types';
import { executeSql } from '../data/sql/client';

type AlertRequest = { projectId: string; filters: OverviewFilters; jiraIssues: JiraWorkItem[] };

type AlertGateRow = {
  shipment_id: string;
  gate_id: string;
  jira_project_id: string | null;
  gate_issue_id: string | null;
  baseline_eta: string;
  latest_eta: string | null;
};

type AlertLinksRow = {
  asset_code: string | null;
  asset_name: string | null;
  asset_status: string | null;
  next_available_date: string | null;
  contractor_code: string | null;
  contractor_name: string | null;
  mount_issue_id: string | null;
  commission_issue_id: string | null;
};

const dayMs = 86_400_000;

async function readVisibleGate({ projectId, filters, jiraIssues }: AlertRequest, query: typeof executeSql) {
  if (!jiraIssues.length) {
    return undefined;
  }
  const phase = filters.phaseCode ?? null;
  const asOf = filters.asOf ?? null;
  const rows = await query<AlertGateRow>(
    `SELECT s.id AS shipment_id, gate.id AS gate_id, p.jira_project_id,
            gate.jira_issue_id AS gate_issue_id, CAST(s.baseline_eta AS CHAR) AS baseline_eta,
            CAST(s.latest_eta AS CHAR) AS latest_eta
     FROM ctx_shipment s
     INNER JOIN ctx_project p ON p.id = s.project_id AND p.status = 'ACTIVE' AND p.data_mode = 'DEMO'
     INNER JOIN ctx_work_package gate ON gate.id = s.gate_work_package_id AND gate.project_id = s.project_id
       AND gate.code = 'WP-048' AND gate.tombstoned_at IS NULL
     INNER JOIN ctx_phase ph ON ph.id = gate.phase_id AND ph.project_id = s.project_id
     WHERE s.project_id = ? AND s.code = 'A-17' AND s.arrived_date IS NULL
       AND (? IS NULL OR ph.code = ?)
       AND (? IS NULL OR EXISTS (
         SELECT 1 FROM ctx_data_snapshot snap
         WHERE snap.project_id = s.project_id AND snap.state = 'SEALED' AND snap.expires_at > UTC_TIMESTAMP(3)
           AND snap.access_class = 'SYNTHETIC_DEMO' AND snap.as_of_date = ? AND snap.collected_at >= s.updated_at
       ))`,
    [projectId, phase, phase, asOf, asOf],
  );
  const row = rows[0];
  if (!row || !row.jira_project_id || !row.gate_issue_id || !isDateOnly(row.baseline_eta) || !isDateOnly(row.latest_eta)) {
    return undefined;
  }

  const allowedIssues = new Map(jiraIssues.filter((issue) => issue.projectId === row.jira_project_id).map((issue) => [issue.id, issue]));
  const gate = allowedIssues.get(row.gate_issue_id);
  const delayDays = (Date.parse(row.latest_eta) - Date.parse(row.baseline_eta)) / dayMs;
  if (!gate || !Number.isInteger(delayDays) || delayDays <= 0) {
    return undefined;
  }

  const alert: OverviewAlert = {
    code: 'A-17', title: 'Demora del suministro A-17', severity: 'HIGH',
    baselineEta: row.baseline_eta, currentEta: row.latest_eta, delayDays,
  };
  return { row, alert, gate, allowedIssues };
}

export async function readOverviewAlertSummary(request: AlertRequest, query: typeof executeSql = executeSql): Promise<OverviewAlert | undefined> {
  return (await readVisibleGate(request, query))?.alert;
}

async function readSimulationInput(
  projectId: string, shipmentId: string, asOf: string | null, observedDelay: number, query: typeof executeSql,
): Promise<OverviewAlertDetail['simulationInput']> {
  // Select the snapshot first so an older S1 cannot be substituted if the selected cut has no compatible scenario.
  const rows = await query<{ snapshot_id: string; snapshot_as_of: string; value_jcs: string }>(
    `SELECT snap.id AS snapshot_id, CAST(snap.as_of_date AS CHAR) AS snapshot_as_of, v.value_jcs
     FROM ctx_data_snapshot snap
     INNER JOIN ctx_shipment observed ON observed.id = ? AND observed.project_id = snap.project_id
       AND observed.updated_at <= snap.collected_at
     INNER JOIN ctx_scenario s ON s.snapshot_id = snap.id AND s.project_id = snap.project_id
       AND s.state = 'PUBLISHED' AND s.idempotency_key = ?
     INNER JOIN ctx_scenario_variable v ON v.scenario_id = s.id AND v.variable_code = 'SUPPLY_DELAY_DAYS'
       AND v.target_kind = 'SHIPMENT' AND v.target_id = observed.id AND v.unit_code = 'DAY'
     WHERE snap.project_id = ? AND snap.id = (
       SELECT i.id FROM ctx_data_snapshot i
       WHERE i.project_id = ? AND i.state = 'SEALED' AND i.expires_at > UTC_TIMESTAMP(3)
         AND i.access_class = 'SYNTHETIC_DEMO' AND (? IS NULL OR i.as_of_date = ?)
       ORDER BY i.as_of_date DESC, i.collected_at DESC, i.id DESC LIMIT 1
     ) LIMIT 2`,
    [shipmentId, `${PATAGONIA_FIXTURE_VERSION}:S1`, projectId, projectId, asOf, asOf],
  );
  const row = rows[0];
  if (rows.length !== 1 || !row?.snapshot_id || !isDateOnly(row.snapshot_as_of) || typeof row.value_jcs !== 'string') {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(row.value_jcs);
  } catch {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 365 || value !== observedDelay) {
    return null;
  }
  return { scenarioCode: 'S1', variable: 'SUPPLY_DELAY_DAYS', value, snapshotId: row.snapshot_id, snapshotAsOf: row.snapshot_as_of };
}

export async function readOverviewAlert(request: AlertRequest, query: typeof executeSql = executeSql): Promise<OverviewAlertDetail | undefined> {
  const visible = await readVisibleGate(request, query);
  if (!visible) {
    return undefined;
  }

  const { row, alert, gate, allowedIssues } = visible;
  const { projectId, filters } = request;
  const links = await query<AlertLinksRow>(
    `SELECT a.code AS asset_code, a.name AS asset_name, a.status AS asset_status,
            CAST(a.next_available_date AS CHAR) AS next_available_date,
            c.code AS contractor_code, c.name AS contractor_name,
            CASE WHEN gate_edge.id IS NOT NULL AND assignment.work_package_id IS NOT NULL
                 THEN mount.jira_issue_id END AS mount_issue_id,
            CASE WHEN gate_edge.id IS NOT NULL AND assignment.work_package_id IS NOT NULL AND mount_edge.id IS NOT NULL
                 THEN commission.jira_issue_id END AS commission_issue_id
     FROM ctx_shipment s
     LEFT JOIN ctx_asset a ON a.id = s.asset_id AND a.project_id = s.project_id AND a.tombstoned_at IS NULL
       AND a.workspace_id IS NULL AND a.assets_object_id IS NULL
     LEFT JOIN ctx_contractor c ON c.id = s.contractor_id AND c.project_id = s.project_id
       AND c.workspace_id IS NULL AND c.assets_object_id IS NULL
     LEFT JOIN ctx_work_package mount ON mount.project_id = s.project_id AND mount.code = 'WP-064'
       AND mount.tombstoned_at IS NULL
     LEFT JOIN ctx_dependency gate_edge ON gate_edge.project_id = s.project_id
       AND gate_edge.predecessor_id = s.gate_work_package_id AND gate_edge.successor_id = mount.id
       AND gate_edge.relation_type = 'FS' AND gate_edge.tombstoned_at IS NULL
     LEFT JOIN ctx_work_resource assignment ON assignment.project_id = s.project_id
       AND assignment.work_package_id = mount.id AND assignment.resource_kind = 'ASSET' AND assignment.resource_id = a.id
     LEFT JOIN ctx_work_package commission ON commission.project_id = s.project_id AND commission.code = 'WP-083'
       AND commission.tombstoned_at IS NULL
     LEFT JOIN ctx_dependency mount_edge ON mount_edge.project_id = s.project_id
       AND mount_edge.predecessor_id = mount.id AND mount_edge.successor_id = commission.id
       AND mount_edge.relation_type = 'FS' AND mount_edge.tombstoned_at IS NULL
     WHERE s.project_id = ? AND s.id = ? AND s.gate_work_package_id = ?`,
    [projectId, row.shipment_id, row.gate_id],
  );
  const link = links[0];
  if (!link) {
    return undefined;
  }

  const asset = link.asset_code && link.asset_name && link.asset_status ? {
    code: link.asset_code, name: link.asset_name, status: link.asset_status,
    nextAvailableDate: isDateOnly(link.next_available_date) ? link.next_available_date : null,
  } : null;
  const contractor = link.contractor_code && link.contractor_name ? { code: link.contractor_code, name: link.contractor_name } : null;
  const mount = link.mount_issue_id ? allowedIssues.get(link.mount_issue_id) : undefined;
  const commission = mount && link.commission_issue_id ? allowedIssues.get(link.commission_issue_id) : undefined;
  const chain = [['WP-048', gate], ['WP-064', mount], ['WP-083', commission]] as const;
  const work = chain.flatMap(([code, issue]) => issue ? [{ code, title: issue.summary, issueKey: issue.key }] : []);
  const simulationInput = await readSimulationInput(projectId, row.shipment_id, filters.asOf ?? null, alert.delayDays, query);
  return { ...alert, asset, contractor, work, simulationInput };
}
