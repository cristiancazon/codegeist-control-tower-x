import type {
  OperationsDetail, OperationsField, OperationsFilters, OperationsLink, OperationsPageContent, OperationsSource,
} from '../../shared/operations';
import { fixture, fixtureHash } from '../data/bootstrap/fixture';
import { executeSql } from '../data/sql/client';
import {
  disabledOperationsSource, operationsForgeSource, operationsJiraSource, paginateOperations,
  visibleOperationsIssue, type OperationsScope,
} from './scope';

export type SummarySection = 'hse' | 'financial' | 'knowledge';

type Entry = {
  code: string;
  title: string;
  fields: OperationsField[];
  links: OperationsLink[];
  status?: string;
  category?: string;
  facilityCode?: string;
  phaseCode?: string;
  date: string;
  cents?: bigint;
};

const columns = {
  hse: ['Categoría', 'Severidad', 'Estado', 'Área', 'Fecha'],
  financial: ['Concepto', 'Clase', 'Importe', 'Fecha del registro'],
  knowledge: ['Título', 'Fase', 'Versión', 'Fecha verificada'],
};
const incidentCodes = new Map<string, string>(fixture.incidents.map(({ id, code }) => [id, code]));
const incidentSeverity: Record<string, string> = { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta' };
const incidentStatus: Record<string, string> = { OPEN: 'Abierto', CLOSED: 'Cerrado' };
const costKind: Record<string, string> = { ACTUAL: 'Devengado', FIXED_REMAINING: 'Base remanente', DAILY_RATE: 'Tarifa diaria' };
const costConcept: Record<string, string> = {
  ACCRUED_BASE: 'Costo devengado', WORK_BASE: 'Trabajo remanente', PROJECT_INDIRECT: 'Costos indirectos',
  ASSET_STANDBY: 'Espera de equipo', CREW_STANDBY: 'Espera de cuadrilla',
};
const costFormat = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', currencyDisplay: 'code' });

function amount(cents: bigint) {
  const converted = Number(cents);
  return Number.isSafeInteger(converted) ? costFormat.format(converted / 100) : null;
}

export function canReadHse(scope: Pick<OperationsScope, 'roles'>): boolean {
  return scope.roles.includes('HSE_READER') && scope.roles.some((role) => role !== 'HSE_READER');
}

function summarySources(section: SummarySection, scope: OperationsScope, catalogReady = true): OperationsSource[] {
  const sources = [operationsForgeSource(scope), operationsJiraSource(scope)];
  if (!catalogReady) {
    sources[0] = { ...sources[0]!, state: 'UNAVAILABLE', observedAt: null, detail: 'El catálogo sintético verificado no está disponible.' };
  }
  if (section === 'hse') {
    sources.push(disabledOperationsSource('JSM', 'Las solicitudes reales de JSM requieren una conexión y autorización verificadas.'));
  }
  if (section === 'knowledge') {
    sources.push(disabledOperationsSource('CONFLUENCE', 'Las páginas reales requieren verificar el acceso en Confluence.'));
  }
  return sources;
}

async function readHse(scope: OperationsScope, query: typeof executeSql): Promise<Entry[]> {
  if (!scope.snapshot || !canReadHse(scope)) {
    return [];
  }
  const rows = await query<{
    id: string; category: string; severity: string; status: string; facility_code: string | null;
    work_package_id: string | null; jira_issue_id: string | null; record_date: string;
  }>(`SELECT i.id, i.category, i.severity, i.status, f.code AS facility_code,
          i.work_package_id, w.jira_issue_id, CAST(DATE(i.occurred_at) AS CHAR) AS record_date
   FROM ctx_incident i
   LEFT JOIN ctx_facility f ON f.project_id = i.project_id AND f.id = i.facility_id
   LEFT JOIN ctx_work_package w ON w.project_id = i.project_id AND w.id = i.work_package_id AND w.tombstoned_at IS NULL
   WHERE i.project_id = ? AND i.access_class = 'HSE_READER' AND i.jira_issue_id IS NULL
     AND i.jira_issue_key IS NULL AND i.jsm_request_type_id IS NULL AND DATE(i.occurred_at) <= ? AND i.updated_at <= ?
   ORDER BY i.occurred_at DESC, i.id`,
  [scope.projectId, scope.snapshot.asOf, scope.snapshot.collectedAt.replace('T', ' ').replace(/Z$/, '')]);
  return rows.flatMap((row) => {
    const code = incidentCodes.get(row.id);
    const issue = visibleOperationsIssue(scope, row.jira_issue_id);
    if (!code || !Object.hasOwn(incidentStatus, row.status) || !Object.hasOwn(incidentSeverity, row.severity) ||
        (row.work_package_id !== null && !issue)) {
      return [];
    }
    const cells = [row.category, incidentSeverity[row.severity]!, incidentStatus[row.status]!, row.facility_code, row.record_date];
    return [{
      code, title: code, date: row.record_date,
      category: row.severity, status: row.status, facilityCode: row.facility_code ?? undefined,
      fields: columns.hse.map((label, index) => ({ label, value: cells[index] ?? null })),
      links: issue ? [{ kind: 'jira', label: 'Trabajo asociado', issueKey: issue.key }] : [],
    }];
  });
}

async function readCost(scope: OperationsScope, query: typeof executeSql): Promise<Entry[]> {
  if (!scope.snapshot) {
    return [];
  }
  const rows = await query<{
    record_code: string; kind: string; cost_bucket: string; amount_cents: string; record_date: string;
    unit_code: string; work_package_id: string | null; jira_issue_id: string | null; phase_code: string | null;
  }>(`SELECT c.record_code, c.kind, c.cost_bucket, CAST(c.amount_cents AS CHAR) AS amount_cents,
          CAST(c.effective_date AS CHAR) AS record_date, c.unit_code, c.work_package_id, w.jira_issue_id, p.code AS phase_code
   FROM ctx_cost_record c
   LEFT JOIN ctx_work_package w ON w.project_id = c.project_id AND w.id = c.work_package_id AND w.tombstoned_at IS NULL
   LEFT JOIN ctx_phase p ON p.project_id = c.project_id AND p.id = w.phase_id
   WHERE c.project_id = ? AND c.currency = 'USD' AND c.effective_date <= ?
     AND ((c.kind = 'ACTUAL' AND c.actuality = 'ACTUAL') OR
          (c.kind IN ('FIXED_REMAINING', 'DAILY_RATE') AND c.actuality = 'ASSUMPTION'))
   ORDER BY c.effective_date DESC, c.record_code`, [scope.projectId, scope.snapshot.asOf]);
  return rows.flatMap((row) => {
    const issue = visibleOperationsIssue(scope, row.jira_issue_id);
    if ((row.work_package_id !== null && !issue) || !Object.hasOwn(costKind, row.kind) ||
        !/^-?\d{1,16}$/.test(row.amount_cents) ||
        row.unit_code !== (row.kind === 'DAILY_RATE' ? 'USD_CENT_PER_DAY' : 'USD_CENT')) {
      return [];
    }
    const cents = BigInt(row.amount_cents);
    const formatted = amount(cents);
    const unitAmount = formatted && row.kind === 'DAILY_RATE' ? formatted + ' por día' : formatted;
    const label = Object.hasOwn(costConcept, row.cost_bucket) ? costConcept[row.cost_bucket]! : row.cost_bucket;
    const cells = [label, costKind[row.kind]!, unitAmount, row.record_date];
    return [{
      code: row.record_code, title: label, status: row.kind, cents, phaseCode: row.phase_code ?? undefined, date: row.record_date,
      fields: columns.financial.map((field, index) => ({ label: field, value: cells[index] ?? null })),
      links: issue ? [{ kind: 'jira', label: 'Paquete de trabajo', issueKey: issue.key }] : [],
    }];
  });
}

async function readKnowledge(scope: OperationsScope, query: typeof executeSql): Promise<Entry[] | undefined> {
  if (!scope.snapshot || scope.projectId !== fixture.project.id || scope.snapshot.asOf !== fixture.snapshot.asOfDate) {
    return undefined;
  }
  const seed = await query<{ project_id: string }>(
    `SELECT i.project_id
     FROM ctx_fixture_import i INNER JOIN ctx_data_snapshot s ON s.project_id = i.project_id AND s.id = ?
     WHERE i.project_id = ? AND i.fixture_hash = ? AND i.state = 'COMPLETE'
       AND s.state = 'SEALED' AND s.expires_at > UTC_TIMESTAMP(3) AND s.access_class = 'SYNTHETIC_DEMO'`,
    [fixture.snapshot.id, scope.projectId, fixtureHash],
  );
  if (!seed.length) {
    return undefined;
  }
  const work = await query<{ id: string; jira_issue_id: string | null }>(
    'SELECT id, jira_issue_id FROM ctx_work_package WHERE project_id = ? AND tombstoned_at IS NULL',
    [scope.projectId],
  );
  const issueByWork = new Map(work.flatMap((row) => {
    const issue = visibleOperationsIssue(scope, row.jira_issue_id);
    return issue ? [[row.id, issue] as const] : [];
  }));
  const workIds = new Set<string>(fixture.workPackages.map(({ id }) => id));
  const phases = new Map<string, { code: string; name: string }>(fixture.phases.map((phase) => [phase.id, phase]));
  const shipmentWork = new Map<string, string>(fixture.shipments.map((shipment) => [shipment.id, shipment.gateWorkPackageId]));
  return fixture.knowledge.flatMap((document) => {
    const relatedWork = new Set(document.relatedEntityIds.flatMap((id) => {
      const workId = workIds.has(id) ? id : shipmentWork.get(id);
      return workId ? [workId] : [];
    }));
    if ([...relatedWork].some((id) => !issueByWork.has(id))) {
      return [];
    }
    const phase = phases.get(document.phaseId);
    const date = document.checkedAt.slice(0, 10);
    return [{
      code: document.subjectCode, title: document.title, phaseCode: phase?.code, date,
      fields: [
        { label: 'Título', value: document.title },
        { label: 'Fase', value: phase?.name ?? null },
        { label: 'Versión', value: document.sourceVersion },
        { label: 'Fecha verificada', value: date },
        { label: 'Referencia sintética', value: document.body },
      ],
      links: [...relatedWork].map((id) => ({ kind: 'jira', label: 'Ítem relacionado', issueKey: issueByWork.get(id)!.key })),
    }];
  });
}

const readers = { hse: readHse, financial: readCost, knowledge: readKnowledge };
const notes: Record<SummarySection, string[]> = {
  hse: ['Se muestran categorías, severidad y fechas de incidentes sintéticos para el rol HSE_READER.'],
  financial: ['Valores sintéticos en USD. El devengado, el remanente y las tarifas se muestran por separado.',
    'El desvío requiere un presupuesto acumulado comparable al mismo corte.'],
  knowledge: ['Referencias sintéticas del fixture publicado. Cada enlace Jira se verifica para tu cuenta.'],
};

function matches({ code, fields, status, category, facilityCode, phaseCode, date }: Entry, filters: OperationsFilters) {
  const term = filters.q?.toLocaleLowerCase('es-AR');
  return (!term || [code, ...fields.slice(0, 4).map(({ value }) => value)].some((cell) => cell?.toLocaleLowerCase('es-AR').includes(term))) &&
    (!filters.status || status === filters.status) && (!filters.category || category === filters.category) &&
    (!filters.phaseCode || phaseCode === filters.phaseCode) && (!filters.facilityCode || facilityCode === filters.facilityCode) &&
    (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
}

export async function listSummary(
  section: SummarySection, scope: OperationsScope, filters: OperationsFilters, query: typeof executeSql = executeSql,
): Promise<OperationsPageContent | undefined> {
  if (section === 'hse' && !canReadHse(scope)) {
    return undefined;
  }
  const entries = await readers[section](scope, query);
  const selected = entries?.filter((entry) => matches(entry, filters)) ?? [];
  const highlights: OperationsField[] = [];
  if (section === 'hse' && scope.snapshot) {
    highlights.push({ label: 'Abiertos visibles', value: String(selected.filter(({ status }) => status === 'OPEN').length) });
  }
  if (section === 'financial') {
    for (const status of ['ACTUAL', 'FIXED_REMAINING']) {
      const values = selected.filter((entry) => entry.status === status);
      if (values.length) {
        highlights.push({
          label: status === 'ACTUAL' ? 'Devengado visible' : 'Base remanente visible',
          value: amount(values.reduce((total, row) => total + (row.cents ?? 0n), 0n)),
        });
      }
    }
  }
  const facets: NonNullable<OperationsPageContent['facets']> = section === 'hse'
    ? [
      { name: 'status', label: 'Estado', options: Object.entries(incidentStatus).map(([value, label]) => ({ value, label })) },
      { name: 'category', label: 'Severidad', options: Object.entries(incidentSeverity).map(([value, label]) => ({ value, label })) },
    ]
    : section === 'financial'
      ? [{ name: 'status', label: 'Clase', options: Object.entries(costKind).map(([value, label]) => ({ value, label })) }]
      : [];
  const phaseCodes = new Set(entries?.flatMap(({ phaseCode }) => phaseCode ? [phaseCode] : []));
  if (phaseCodes.size) {
    facets.push({ name: 'phaseCode', label: 'Fase', options: fixture.phases
      .filter(({ code }) => phaseCodes.has(code)).map(({ code, name }) => ({ value: code, label: name })) });
  }
  return {
    columns: columns[section], total: selected.length, sources: summarySources(section, scope, entries !== undefined),
    rows: paginateOperations(selected, filters).map(({ code, fields }) => ({
      code, cells: fields.slice(0, columns[section].length).map(({ value }) => value),
    })),
    facets, highlights, notes: notes[section],
  };
}

export async function readSummaryDetail(
  section: SummarySection, scope: OperationsScope, code: string, query: typeof executeSql = executeSql,
): Promise<OperationsDetail | undefined> {
  if (section === 'hse' && !canReadHse(scope)) {
    return undefined;
  }
  const record = (await readers[section](scope, query))?.find((entry) => entry.code === code);
  return record ? {
    code, title: record.title, fields: record.fields, links: record.links,
    sources: summarySources(section, scope), notes: notes[section],
  } : undefined;
}
