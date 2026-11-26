import { PATAGONIA_FIXTURE_VERSION } from '../../domain/fixtures/patagonia';
import type {
  OperationsDetail, OperationsField, OperationsFilter, OperationsFilters, OperationsLink, OperationsPageContent, OperationsRow,
} from '../../shared/operations';
import { isDateOnly, isRecord } from '../data/jira/normalize';
import type { JiraWorkItem } from '../data/jira/types';
import { executeSql } from '../data/sql/client';
import {
  disabledOperationsSource, operationsForgeSource, operationsJiraSource, paginateOperations, visibleOperationsIssue, type OperationsScope,
} from './scope';

type CatalogSection = 'operations' | 'assets' | 'contractors' | 'logistics';
type Snapshot = NonNullable<OperationsScope['snapshot']>;
type Facility = { id: string; code: string; name: string; facility_type: string; status: string };
type CatalogWork = {
  id: string; code: string; jira_issue_id: string | null; phase_code: string; phase_name: string;
  facility_id: string | null; facility_code: string | null; facility_name: string | null; contractor_id: string | null;
};
type VisibleWork = CatalogWork & { issue: JiraWorkItem };
type Asset = {
  id: string; code: string; name: string; asset_type: string; status: string; next_available_date: string | null;
  facility_code: string | null; facility_name: string | null; contractor_code: string | null; contractor_name: string | null;
};
type Contractor = { id: string; code: string; name: string; trade: string; status: string };
type Shipment = {
  id: string; code: string; gate_work_package_id: string; gate_issue_id: string | null; phase_code: string; phase_name: string;
  facility_id: string | null; facility_code: string | null; facility_name: string | null; contractor_id: string;
  contractor_code: string | null; contractor_name: string | null; asset_id: string | null; asset_code: string | null;
  asset_name: string | null; baseline_eta: string; latest_eta: string | null; arrived_date: string | null;
  shipment_qty: string | number; shipment_unit: string;
};
type VisibleShipment = Shipment & { issue: JiraWorkItem };
type ShipmentStatus = 'RISK' | 'OVERDUE' | 'DELIVERED_LATE' | 'DELIVERED' | 'ON_TRACK' | 'UNKNOWN';
type Assignment = { resource_id: string; work_package_id: string };
type FacetOption = { value: string; label: string };
type Tags = Partial<Record<OperationsFilter, FacetOption[]>>;
type CatalogEntry = { row: OperationsRow; tags: Tags; date?: string | null };

const columnLabels: Record<CatalogSection, string[]> = {
  operations: ['Unidad operativa', 'Categoría', 'Estado', 'Recepciones en riesgo o vencidas', 'Productividad'],
  assets: ['Activo', 'Categoría', 'Área', 'Estado', 'Disponibilidad registrada'],
  contractors: ['Contratista', 'Especialidad', 'Estado', 'Riesgos visibles', 'Incumplimientos visibles'],
  logistics: ['Proveedor', 'ETA original', 'ETA vigente', 'Estado al corte', 'Cantidad'],
};

const facetLabels: Record<CatalogSection, Partial<Record<OperationsFilter, string>>> = {
  operations: { phaseCode: 'Fase', status: 'Estado', facilityCode: 'Área', category: 'Categoría' },
  assets: { phaseCode: 'Fase', status: 'Estado', facilityCode: 'Área', category: 'Categoría', contractorCode: 'Contratista' },
  contractors: { phaseCode: 'Fase', status: 'Estado', facilityCode: 'Área', category: 'Especialidad' },
  logistics: { phaseCode: 'Fase', status: 'Estado al corte', facilityCode: 'Área', contractorCode: 'Proveedor' },
};

const catalogStatus: Record<string, string> = { ACTIVE: 'Activo', AVAILABLE: 'Disponible', MAINTENANCE: 'En mantenimiento' };
const shipmentLabels: Record<ShipmentStatus, string> = {
  RISK: 'Riesgo por cambio de ETA',
  OVERDUE: 'Sin arribo tras el compromiso',
  DELIVERED_LATE: 'Entregado fuera de plazo',
  DELIVERED: 'Entregado dentro del plazo',
  ON_TRACK: 'ETA dentro del plazo',
  UNKNOWN: 'Estado indeterminado',
};

function sources(section: CatalogSection, scope: OperationsScope) {
  const result = [operationsForgeSource(scope), operationsJiraSource(scope)];
  if (section === 'assets' || section === 'contractors') {
    result.push(disabledOperationsSource('ASSETS', 'El conector Atlassian Assets está deshabilitado. El catálogo de Forge es sintético.'));
  }
  return result;
}

function snapshotTime(snapshot: Snapshot): string {
  return snapshot.collectedAt.slice(0, 23).replace('T', ' ');
}

async function readWork(scope: OperationsScope, query: typeof executeSql): Promise<VisibleWork[]> {
  if (!scope.snapshot || scope.jiraState === 'UNAVAILABLE' || scope.jiraIssues.size === 0) {
    return [];
  }
  const rows = await query<CatalogWork>(
    `SELECT w.id, w.code, w.jira_issue_id, w.facility_id, w.contractor_id,
            ph.code AS phase_code, ph.name AS phase_name, f.code AS facility_code, f.name AS facility_name
     FROM ctx_work_package w INNER JOIN ctx_phase ph ON ph.id = w.phase_id AND ph.project_id = w.project_id
     LEFT JOIN ctx_facility f ON f.id = w.facility_id AND f.project_id = w.project_id
     WHERE w.project_id = ? AND w.tombstoned_at IS NULL ORDER BY w.code`,
    [scope.projectId],
  );
  return rows.flatMap((row) => {
    const issue = visibleOperationsIssue(scope, row.jira_issue_id);
    return issue ? [{ ...row, issue }] : [];
  });
}

async function readShipments(scope: OperationsScope, snapshot: Snapshot, query: typeof executeSql, code: string | null = null) {
  if (scope.jiraState === 'UNAVAILABLE' || scope.jiraIssues.size === 0) {
    return [];
  }
  const rows = await query<Shipment>(
    `SELECT s.id, s.code, s.gate_work_package_id, gate.jira_issue_id AS gate_issue_id,
            gate.facility_id, f.code AS facility_code, f.name AS facility_name,
            ph.code AS phase_code, ph.name AS phase_name, s.contractor_id,
            c.code AS contractor_code, c.name AS contractor_name, a.id AS asset_id, a.code AS asset_code, a.name AS asset_name,
            CAST(s.baseline_eta AS CHAR) AS baseline_eta, CAST(s.latest_eta AS CHAR) AS latest_eta,
            CAST(s.arrived_date AS CHAR) AS arrived_date, s.shipment_qty, s.shipment_unit
     FROM ctx_shipment s
     INNER JOIN ctx_work_package gate ON gate.project_id = s.project_id AND gate.id = s.gate_work_package_id
                                    AND gate.tombstoned_at IS NULL
     INNER JOIN ctx_phase ph ON ph.id = gate.phase_id AND ph.project_id = s.project_id
     LEFT JOIN ctx_facility f ON f.id = gate.facility_id AND f.project_id = s.project_id
     LEFT JOIN ctx_contractor c ON c.id = s.contractor_id AND c.project_id = s.project_id
        AND c.assets_object_id IS NULL AND c.workspace_id IS NULL AND c.source_updated_at <= ?
     LEFT JOIN ctx_asset a ON a.id = s.asset_id AND a.project_id = s.project_id
        AND a.assets_object_id IS NULL AND a.workspace_id IS NULL AND a.tombstoned_at IS NULL AND a.source_updated_at <= ?
     WHERE s.project_id = ? AND s.updated_at <= ? AND (? IS NULL OR s.code = ?) ORDER BY s.code`,
    [snapshotTime(snapshot), snapshotTime(snapshot), scope.projectId, snapshotTime(snapshot), code, code],
  );
  return rows.flatMap((row) => {
    const issue = visibleOperationsIssue(scope, row.gate_issue_id);
    return issue ? [{ ...row, issue }] : [];
  });
}

async function readFacilities(projectId: string, query: typeof executeSql, code: string | null = null) {
  return query<Facility>(
    `SELECT id, code, name, facility_type, status FROM ctx_facility
     WHERE project_id = ? AND (? IS NULL OR code = ?) ORDER BY code`,
    [projectId, code, code],
  );
}

async function readAssets(scope: OperationsScope, snapshot: Snapshot, query: typeof executeSql, code: string | null = null) {
  return query<Asset>(
    `SELECT a.id, a.code, a.name, a.asset_type, a.status, CAST(a.next_available_date AS CHAR) AS next_available_date,
            f.code AS facility_code, f.name AS facility_name, c.code AS contractor_code, c.name AS contractor_name
     FROM ctx_asset a LEFT JOIN ctx_facility f ON f.id = a.facility_id AND f.project_id = a.project_id
     LEFT JOIN ctx_contractor c ON c.id = a.contractor_id AND c.project_id = a.project_id
        AND c.assets_object_id IS NULL AND c.workspace_id IS NULL AND c.source_updated_at <= ?
     WHERE a.project_id = ? AND a.assets_object_id IS NULL AND a.workspace_id IS NULL AND a.tombstoned_at IS NULL
       AND a.source_updated_at <= ? AND (? IS NULL OR a.code = ?) ORDER BY a.code`,
    [snapshotTime(snapshot), scope.projectId, snapshotTime(snapshot), code, code],
  );
}

async function readContractors(scope: OperationsScope, snapshot: Snapshot, query: typeof executeSql, code: string | null = null) {
  return query<Contractor>(
    `SELECT id, code, name, trade, status FROM ctx_contractor
     WHERE project_id = ? AND assets_object_id IS NULL AND workspace_id IS NULL AND source_updated_at <= ?
       AND (? IS NULL OR code = ?) ORDER BY code`,
    [scope.projectId, snapshotTime(snapshot), code, code],
  );
}

async function readAssignments(projectId: string, query: typeof executeSql) {
  return query<Assignment>(
    `SELECT resource_id, work_package_id FROM ctx_work_resource WHERE project_id = ? AND resource_kind = 'ASSET'`,
    [projectId],
  );
}

function observedArrival(shipment: Shipment, snapshot: Snapshot) {
  return isDateOnly(shipment.arrived_date) && shipment.arrived_date <= snapshot.asOf ? shipment.arrived_date : null;
}

function condition(shipment: Shipment, snapshot: Snapshot): ShipmentStatus {
  const arrival = observedArrival(shipment, snapshot);
  if (!isDateOnly(shipment.baseline_eta)) {
    return 'UNKNOWN';
  }
  if (arrival) {
    return arrival > shipment.baseline_eta ? 'DELIVERED_LATE' : 'DELIVERED';
  }
  if (shipment.baseline_eta < snapshot.asOf) {
    return 'OVERDUE';
  }
  if (!isDateOnly(shipment.latest_eta)) {
    return 'UNKNOWN';
  }
  return shipment.latest_eta > shipment.baseline_eta ? 'RISK' : 'ON_TRACK';
}

function shipmentQuantity(shipment: Shipment): string | null {
  const quantity = Number(shipment.shipment_qty);
  return Number.isFinite(quantity) && quantity > 0
    ? `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(quantity)} ${shipment.shipment_unit}`
    : null;
}

function tag(value: string | null, label: string | null = value): FacetOption[] {
  return value && label ? [{ value, label }] : [];
}

function linkedTags(rows: ReadonlyArray<Pick<CatalogWork, 'phase_code' | 'phase_name' | 'facility_code' | 'facility_name'>>): Tags {
  return {
    phaseCode: rows.flatMap((row) => tag(row.phase_code, row.phase_name)),
    facilityCode: rows.flatMap((row) => tag(row.facility_code, row.facility_name)),
  };
}

function workForAsset(assetId: string, work: VisibleWork[], assignments: Assignment[]) {
  const workIds = new Set(assignments.filter((assignment) => assignment.resource_id === assetId).map((assignment) => assignment.work_package_id));
  return work.filter((item) => workIds.has(item.id));
}

function asSearch(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function page(section: CatalogSection, entries: CatalogEntry[], filters: OperationsFilters, scope: OperationsScope): OperationsPageContent {
  const controls = Object.entries(facetLabels[section]) as Array<[OperationsFilter, string]>;
  const search = asSearch(filters.q?.trim() ?? '');
  const matching = entries.filter(({ row, tags, date }) =>
    (!search || asSearch([row.code, ...row.cells].join(' ')).includes(search)) &&
    controls.every(([filter]) => !filters[filter] || tags[filter]?.some(({ value }) => value === filters[filter])) &&
    (!filters.from || Boolean(date && date >= filters.from)) && (!filters.to || Boolean(date && date <= filters.to)));

  return {
    columns: columnLabels[section],
    rows: paginateOperations(matching, filters).map(({ row }) => row),
    total: matching.length,
    sources: sources(section, scope),
    facets: controls.flatMap(([name, label]) => {
      const options = [...new Map(entries.flatMap(({ tags }) => tags[name] ?? []).map((item) => [item.value, item])).values()];
      return options.length ? [{ name, label, options: options.sort((left, right) => left.label.localeCompare(right.label, 'es-AR')) }] : [];
    }),
    ...(section === 'operations' ? { notes: ['La productividad disponible en el snapshot corresponde al proyecto. El catálogo todavía no registra productividad por unidad.'] } : {}),
    ...(section === 'contractors' ? { notes: ['Los compromisos corresponden a recepciones visibles en Jira. Un cambio de ETA antes del compromiso indica riesgo.'] } : {}),
    ...(section === 'logistics' ? { notes: ['La ventana filtra por ETA vigente o, si falta, por ETA original. Cada envío se muestra con su recepción visible en Jira.'] } : {}),
  };
}

function supplierCounts(shipments: VisibleShipment[], snapshot: Snapshot) {
  const conditions = shipments.map((shipment) => condition(shipment, snapshot));
  return {
    risk: shipments.length ? String(conditions.filter((state) => state === 'RISK').length) : null,
    late: shipments.length ? String(conditions.filter((state) => state === 'OVERDUE' || state === 'DELIVERED_LATE').length) : null,
  };
}

export async function listCatalog(
  section: CatalogSection, scope: OperationsScope, filters: OperationsFilters, query: typeof executeSql = executeSql,
): Promise<OperationsPageContent> {
  const snapshot = scope.snapshot;
  if (!snapshot) {
    return page(section, [], filters, scope);
  }

  switch (section) {
    case 'operations': {
      const [facilities, work, shipments] = await Promise.all([
        readFacilities(scope.projectId, query), readWork(scope, query), readShipments(scope, snapshot, query),
      ]);
      return page(section, facilities.map((facility) => {
        const linked = shipments.filter((shipment) => shipment.facility_id === facility.id &&
          (!filters.phaseCode || shipment.phase_code === filters.phaseCode));
        const exposed = linked.filter((shipment) => {
          const state = condition(shipment, snapshot);
          return state === 'RISK' || state === 'OVERDUE';
        });
        return {
          row: {
            code: facility.code,
            cells: [facility.name, facility.facility_type, catalogStatus[facility.status] ?? facility.status,
              linked.length ? String(exposed.length) : null, null],
          },
          tags: {
            phaseCode: linkedTags(work.filter((item) => item.facility_id === facility.id)).phaseCode,
            facilityCode: tag(facility.code, facility.name), status: tag(facility.status, catalogStatus[facility.status] ?? facility.status),
            category: tag(facility.facility_type),
          },
        };
      }), filters, scope);
    }
    case 'assets': {
      const [assets, work, assignments] = await Promise.all([
        readAssets(scope, snapshot, query), readWork(scope, query),
        scope.jiraState !== 'UNAVAILABLE' && scope.jiraIssues.size ? readAssignments(scope.projectId, query) : [],
      ]);
      return page(section, assets.map((asset) => ({
        row: { code: asset.code, cells: [asset.name, asset.asset_type, asset.facility_name, catalogStatus[asset.status] ?? asset.status, asset.next_available_date] },
        tags: {
          phaseCode: linkedTags(workForAsset(asset.id, work, assignments)).phaseCode,
          facilityCode: tag(asset.facility_code, asset.facility_name), status: tag(asset.status, catalogStatus[asset.status] ?? asset.status),
          category: tag(asset.asset_type), contractorCode: tag(asset.contractor_code, asset.contractor_name),
        },
      })), filters, scope);
    }
    case 'contractors': {
      const [contractors, work, shipments] = await Promise.all([
        readContractors(scope, snapshot, query), readWork(scope, query), readShipments(scope, snapshot, query),
      ]);
      return page(section, contractors.map((contractor) => {
        const visibleShipments = shipments.filter((shipment) => shipment.contractor_id === contractor.id);
        const scopedShipments = visibleShipments.filter((shipment) =>
          (!filters.phaseCode || shipment.phase_code === filters.phaseCode) &&
          (!filters.facilityCode || shipment.facility_code === filters.facilityCode));
        const counts = supplierCounts(scopedShipments, snapshot);
        return {
          row: { code: contractor.code, cells: [contractor.name, contractor.trade, catalogStatus[contractor.status] ?? contractor.status, counts.risk, counts.late] },
          tags: {
            ...linkedTags([...work.filter((item) => item.contractor_id === contractor.id), ...visibleShipments]),
            status: tag(contractor.status, catalogStatus[contractor.status] ?? contractor.status), category: tag(contractor.trade),
          },
        };
      }), filters, scope);
    }
    case 'logistics': {
      const shipments = await readShipments(scope, snapshot, query);
      return page(section, shipments.map((shipment) => {
        const status = condition(shipment, snapshot);
        return {
          row: {
            code: shipment.code, issueKey: shipment.issue.key,
            cells: [shipment.contractor_name, shipment.baseline_eta, shipment.latest_eta, shipmentLabels[status], shipmentQuantity(shipment)],
          },
          tags: {
            ...linkedTags([shipment]), status: tag(status, shipmentLabels[status]),
            contractorCode: tag(shipment.contractor_code, shipment.contractor_name),
          },
          date: shipment.latest_eta ?? shipment.baseline_eta,
        };
      }), filters, scope);
    }
  }
}

function field(label: string, value: string | null): OperationsField {
  return { label, value };
}

function recordLinks(section: CatalogSection, code: string | null, label: string | null): OperationsLink[] {
  return code && label ? [{ kind: 'record', section, code, label }] : [];
}

function workLinks(work: VisibleWork[]): OperationsLink[] {
  return work.flatMap(({ code, issue }): OperationsLink[] => [
    { kind: 'record', section: 'work', code, label: `Trabajo ${code}` },
    { kind: 'jira', issueKey: issue.key, label: `Jira ${issue.key} · ${code}` },
  ]);
}

function shipmentLinks(shipments: VisibleShipment[]): OperationsLink[] {
  return shipments.map(({ code }) => ({ kind: 'record', section: 'logistics', code, label: `Envío ${code}` }));
}

function describeShipment(shipment: VisibleShipment, snapshot: Snapshot) {
  return [
    field('ETA original', shipment.baseline_eta),
    field('ETA vigente', shipment.latest_eta),
    field('Arribo observado', observedArrival(shipment, snapshot)),
    field('Estado al corte', shipmentLabels[condition(shipment, snapshot)]),
    field('Cantidad', shipmentQuantity(shipment)),
  ];
}

async function readA17Alternative(
  shipment: VisibleShipment, scope: OperationsScope, snapshot: Snapshot, query: typeof executeSql,
) {
  if (shipment.code !== 'A-17') {
    return undefined;
  }
  const rows = await query<{ value_jcs: string }>(
    `SELECT v.value_jcs FROM ctx_scenario s
     INNER JOIN ctx_data_snapshot snap ON snap.id = s.snapshot_id AND snap.project_id = s.project_id
     INNER JOIN ctx_scenario_variable v ON v.scenario_id = s.id AND v.target_kind = 'SHIPMENT'
       AND v.variable_code = 'ALTERNATE_SUPPLY' AND v.unit_code = 'DAY'
     WHERE s.project_id = ? AND s.idempotency_key = ? AND s.state = 'PUBLISHED' AND v.target_id = ?
       AND snap.state = 'SEALED' AND snap.access_class = 'SYNTHETIC_DEMO' AND snap.expires_at > UTC_TIMESTAMP(3)
       AND snap.as_of_date = ? AND snap.collected_at = ? LIMIT 2`,
    [scope.projectId, `${PATAGONIA_FIXTURE_VERSION}:S2`, shipment.id, snapshot.asOf, snapshotTime(snapshot)],
  );
  if (rows.length !== 1 || !rows[0]) {
    return undefined;
  }

  let value: unknown;
  try {
    value = JSON.parse(rows[0].value_jcs);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.compatible !== true || typeof value.etaOffsetDays !== 'number' ||
      !Number.isSafeInteger(value.etaOffsetDays) || value.etaOffsetDays < 0 || value.etaOffsetDays > 365 ||
      typeof value.commitmentCents !== 'string' || !/^(0|[1-9]\d*)$/.test(value.commitmentCents) ||
      !Number.isSafeInteger(Number(value.commitmentCents))) {
    return undefined;
  }

  const [contractor] = await readContractors(scope, snapshot, query, 'CON-08');
  if (!contractor || contractor.id !== value.contractorId) {
    return undefined;
  }
  return {
    contractor,
    group: {
      label: 'S2 · Hipótesis de proveedor alternativo',
      fields: [
        field('Contratista compatible', `${contractor.code} · ${contractor.name}`),
        field('ETA respecto de la original', `+${value.etaOffsetDays} días`),
        field('Compromiso hipotético en USD', new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD' })
          .format(Number(value.commitmentCents) / 100)),
      ],
    },
  };
}

async function readShipmentWork(shipment: VisibleShipment, scope: OperationsScope, query: typeof executeSql): Promise<VisibleWork[]> {
  const work = await readWork(scope, query);
  const gate = work.find((item) => item.id === shipment.gate_work_package_id);
  if (!gate || shipment.code !== 'A-17' || !shipment.asset_id) {
    return gate ? [gate] : [];
  }

  const [assignments, dependencies] = await Promise.all([
    readAssignments(scope.projectId, query),
    query<{ predecessor_id: string; successor_id: string }>(
      `SELECT predecessor_id, successor_id FROM ctx_dependency
       WHERE project_id = ? AND relation_type = 'FS' AND tombstoned_at IS NULL`,
      [scope.projectId],
    ),
  ]);
  const dependent = (predecessor: string, successor: string) => dependencies.some((edge) =>
    edge.predecessor_id === predecessor && edge.successor_id === successor);
  const mount = workForAsset(shipment.asset_id, work, assignments)
    .find((item) => item.code === 'WP-064' && dependent(gate.id, item.id));
  if (!mount) {
    return [gate];
  }
  const commissioning = work.find((item) => item.code === 'WP-083' && dependent(mount.id, item.id));
  return commissioning ? [gate, mount, commissioning] : [gate, mount];
}

export async function readCatalogDetail(
  section: CatalogSection, scope: OperationsScope, code: string, query: typeof executeSql = executeSql,
): Promise<OperationsDetail | undefined> {
  const snapshot = scope.snapshot;
  if (!snapshot) {
    return undefined;
  }
  const common = { code, sources: sources(section, scope) };
  switch (section) {
    case 'operations': {
      const [facility] = await readFacilities(scope.projectId, query, code);
      if (!facility) {
        return undefined;
      }
      const [work, shipments, assets] = await Promise.all([
        readWork(scope, query), readShipments(scope, snapshot, query), readAssets(scope, snapshot, query),
      ]);
      const linkedWork = work.filter((item) => item.facility_id === facility.id);
      const linkedShipments = shipments.filter((item) => item.facility_id === facility.id);
      const linkedAssets = assets.filter((asset) => asset.facility_code === facility.code);
      return {
        ...common, title: facility.name,
        fields: [
          field('Categoría', facility.facility_type),
          field('Estado declarado', catalogStatus[facility.status] ?? facility.status),
          field('Productividad por unidad', null),
          field('Corte del snapshot', snapshot.asOf),
        ],
        links: [...shipmentLinks(linkedShipments),
          ...linkedAssets.flatMap((asset) => recordLinks('assets', asset.code, `Activo ${asset.code}`)), ...workLinks(linkedWork)],
        groups: linkedShipments.map((shipment) => ({ label: shipment.code, fields: describeShipment(shipment, snapshot) })),
        notes: ['El histórico de productividad del proyecto carece de desglose por instalación. Las condiciones logísticas se muestran para recepciones visibles en Jira.'],
      };
    }
    case 'assets': {
      const [asset] = await readAssets(scope, snapshot, query, code);
      if (!asset) {
        return undefined;
      }
      const windows = query<{ window_start: string; window_end: string; capacity: number | string; reason_code: string }>(
        `SELECT CAST(window_start AS CHAR) AS window_start, CAST(window_end AS CHAR) AS window_end, capacity, reason_code
         FROM ctx_resource_window WHERE project_id = ? AND resource_kind = 'ASSET' AND resource_id = ?
         ORDER BY window_start, id`,
        [scope.projectId, asset.id],
      );
      const [work, assignments, availability, shipments] = await Promise.all([
        readWork(scope, query),
        scope.jiraState !== 'UNAVAILABLE' && scope.jiraIssues.size ? readAssignments(scope.projectId, query) : [],
        windows,
        readShipments(scope, snapshot, query),
      ]);
      const relatedShipments = shipments.filter((shipment) => shipment.asset_id === asset.id);
      return {
        ...common, title: asset.name,
        fields: [
          field('Categoría', asset.asset_type), field('Área', asset.facility_name),
          field('Estado de inventario', catalogStatus[asset.status] ?? asset.status),
          field('Disponibilidad registrada', asset.next_available_date), field('Contratista', asset.contractor_name),
          field('Corte del snapshot', snapshot.asOf),
        ],
        links: [
          ...recordLinks('operations', asset.facility_code, asset.facility_name),
          ...recordLinks('contractors', asset.contractor_code, asset.contractor_name),
          ...shipmentLinks(relatedShipments),
          ...workLinks(workForAsset(asset.id, work, assignments)),
        ],
        groups: [
          ...availability.map((window) => ({
            label: window.reason_code === 'MAINTENANCE' ? 'Mantenimiento' : 'Ventana registrada',
            fields: [field('Desde', window.window_start), field('Hasta, sin incluir', window.window_end),
              field('Capacidad en unidades', String(window.capacity))],
          })),
          ...relatedShipments.map((shipment) => ({ label: `Condición de suministro ${shipment.code}`, fields: describeShipment(shipment, snapshot) })),
        ],
        notes: ['Las ventanas de inventario son insumos de planificación. La disponibilidad efectiva también depende de las condiciones de suministro que correspondan.'],
      };
    }
    case 'contractors': {
      const [contractor] = await readContractors(scope, snapshot, query, code);
      if (!contractor) {
        return undefined;
      }
      const [work, shipments] = await Promise.all([readWork(scope, query), readShipments(scope, snapshot, query)]);
      const primaryShipments = shipments.filter((item) => item.contractor_id === contractor.id);
      const supply = shipments.find((item) => item.code === 'A-17');
      const alternative = supply && (contractor.code === 'CON-08' || supply.contractor_id === contractor.id)
        ? await readA17Alternative(supply, scope, snapshot, query) : undefined;
      const relatesAsAlternative = Boolean(supply && alternative?.contractor.id === contractor.id &&
        supply.contractor_id !== contractor.id);
      const counts = supplierCounts(primaryShipments, snapshot);
      return {
        ...common, title: contractor.name,
        fields: [
          field('Especialidad', contractor.trade), field('Estado', catalogStatus[contractor.status] ?? contractor.status),
          field('Compromisos en riesgo visibles', counts.risk), field('Incumplimientos observados visibles', counts.late),
          field('Corte del snapshot', snapshot.asOf),
        ],
        links: [
          ...shipmentLinks(relatesAsAlternative && supply ? [...primaryShipments, supply] : primaryShipments),
          ...workLinks(work.filter((item) => item.contractor_id === contractor.id)),
          ...(alternative && !relatesAsAlternative
            ? recordLinks('contractors', alternative.contractor.code, 'Proveedor alternativo en S2') : []),
        ],
        groups: [
          ...primaryShipments.map((shipment) => ({ label: shipment.code, fields: describeShipment(shipment, snapshot) })),
          ...(alternative ? [alternative.group] : []),
        ],
        notes: ['El riesgo por una ETA posterior se distingue de un compromiso vencido o un arribo tardío observado.'],
      };
    }
    case 'logistics': {
      const [shipment] = await readShipments(scope, snapshot, query, code);
      if (!shipment) {
        return undefined;
      }
      const [work, alternative] = await Promise.all([
        readShipmentWork(shipment, scope, query),
        readA17Alternative(shipment, scope, snapshot, query),
      ]);
      return {
        ...common, title: `Envío ${shipment.code}`,
        fields: [
          ...describeShipment(shipment, snapshot),
          field('Proveedor primario', shipment.contractor_name), field('Activo asociado', shipment.asset_name),
          field('Área de recepción', shipment.facility_name), field('Fase de recepción', shipment.phase_name),
          field('Corte del snapshot', snapshot.asOf),
        ],
        links: [
          ...recordLinks('operations', shipment.facility_code, shipment.facility_name),
          ...recordLinks('assets', shipment.asset_code, shipment.asset_name),
          ...recordLinks('contractors', shipment.contractor_code, shipment.contractor_name),
          ...workLinks(work),
          ...(alternative ? recordLinks('contractors', alternative.contractor.code, 'Proveedor alternativo en S2') : []),
        ],
        groups: alternative ? [alternative.group] : [],
        notes: ['La ETA vigente es una estimación registrada. El recorrido vincula las dependencias visibles en el plan.'],
      };
    }
  }
}
