import type {
  OperationsDetail, OperationsFilters, OperationsLink, OperationsPageContent, OperationsRow,
} from '../../shared/operations';
import type { JiraWorkItem } from '../data/jira';
import { isDateOnly } from '../data/jira/normalize';
import { executeSql } from '../data/sql/client';
import { operationsForgeSource, operationsJiraSource, paginateOperations, type OperationsScope } from './scope';

type WorkRow = {
  id: string;
  code: string;
  phase_code: string;
  phase_name: string;
  source_id: string;
  milestone: number | string;
  planned_start: string | null;
  planned_finish: string | null;
  actual_start: string | null;
  actual_finish: string | null;
};

type DependencyRow = {
  id: string;
  predecessor_id: string;
  relation_type: string;
  lag_days: number | string;
  code: string;
  source_id: string;
};

type VisibleWork = { row: WorkRow; issue: JiraWorkItem; cutoff: string };

const columns = ['Ítem de Jira', 'Fase', 'Estado Jira', 'Vencimiento Jira', 'Fin planificado'];

function visibleIssue(scope: OperationsScope, issueId: string): JiraWorkItem | undefined {
  const issue = scope.jiraIssues.get(issueId);
  return issue?.id === issueId && issue.projectId === scope.jiraProjectId ? issue : undefined;
}

async function readVisibleWork(scope: OperationsScope, code: string | null, query: typeof executeSql): Promise<VisibleWork[]> {
  if (!scope.snapshot || scope.jiraState === 'UNAVAILABLE' || scope.jiraIssues.size === 0) {
    return [];
  }
  const captured = new Date(scope.snapshot.collectedAt);
  if (!isDateOnly(scope.snapshot.asOf) || Number.isNaN(captured.valueOf())) {
    return [];
  }
  const cutoff = captured.toISOString().slice(0, 23).replace('T', ' ');
  const rows = await query<WorkRow>(
    `SELECT w.id, w.code, ph.code AS phase_code, ph.name AS phase_name, m.source_id, w.milestone,
            CAST(w.planned_start AS CHAR) AS planned_start, CAST(w.planned_finish AS CHAR) AS planned_finish,
            CAST(w.actual_start AS CHAR) AS actual_start, CAST(w.actual_finish AS CHAR) AS actual_finish
     FROM ctx_work_package w
     INNER JOIN ctx_project p ON p.id = w.project_id AND p.status = 'ACTIVE' AND p.data_mode = 'DEMO'
     INNER JOIN ctx_phase ph ON ph.id = w.phase_id AND ph.project_id = w.project_id
     INNER JOIN ctx_source_mapping m ON m.project_id = w.project_id AND m.entity_id = w.id
       AND m.entity_kind = 'WORK_PACKAGE' AND m.source_system = 'JIRA' AND m.source_scope = p.jira_project_id
       AND m.source_id = w.jira_issue_id AND m.tombstoned_at IS NULL
     WHERE w.project_id = ? AND p.jira_project_id = ? AND w.tombstoned_at IS NULL AND (? IS NULL OR w.code = ?)
       AND w.source_updated_at <= ?
       AND EXISTS (SELECT 1 FROM ctx_data_snapshot snap
         WHERE snap.project_id = ? AND snap.state = 'SEALED' AND snap.access_class = 'SYNTHETIC_DEMO'
           AND snap.expires_at > UTC_TIMESTAMP(3) AND snap.as_of_date = ? AND snap.collected_at = ?)
     ORDER BY ph.ordinal, w.code`,
    [scope.projectId, scope.jiraProjectId, code, code, cutoff, scope.projectId, scope.snapshot.asOf, cutoff],
  );
  return rows.flatMap((row) => {
    const issue = visibleIssue(scope, row.source_id);
    return issue ? [{ row, issue, cutoff }] : [];
  });
}

function normalizedText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es-AR');
}

function civilDate(value: unknown): string | null {
  return isDateOnly(value) ? value : null;
}

export async function listWork(
  scope: OperationsScope, filters: OperationsFilters, query: typeof executeSql = executeSql,
): Promise<OperationsPageContent> {
  const authorized = await readVisibleWork(scope, null, query);
  const phases = new Map<string, string>();
  const statuses = new Map<string, string>();
  const queryText = normalizedText(filters.q?.trim() ?? '');
  const status = filters.status?.trim();
  const asOf = scope.snapshot?.asOf;
  const eligible: OperationsRow[] = [];

  for (const { row, issue } of authorized) {
    phases.set(row.phase_code, row.phase_name);
    statuses.set(issue.status.id, issue.status.name);
    const dueDate = civilDate(issue.dueDate);
    const open = issue.status.categoryKey === 'new' || issue.status.categoryKey === 'indeterminate';
    if ((filters.phaseCode && row.phase_code !== filters.phaseCode) ||
        (status && issue.status.id !== status && issue.status.categoryKey !== status.toLowerCase()) ||
        (queryText && ![row.code, row.phase_code, row.phase_name, issue.key, issue.summary].some((text) => normalizedText(text).includes(queryText))) ||
        (filters.overdueOnly && (!open || !asOf || !dueDate || dueDate >= asOf)) ||
        (filters.from && (!dueDate || dueDate < filters.from)) ||
        (filters.to && (!dueDate || dueDate > filters.to))) {
      continue;
    }

    eligible.push({
      code: row.code, issueKey: issue.key,
      cells: [issue.summary, `${row.phase_code} · ${row.phase_name}`, issue.status.name, dueDate, civilDate(row.planned_finish)],
    });
  }

  return {
    columns,
    rows: paginateOperations(eligible, filters),
    total: eligible.length,
    sources: [operationsJiraSource(scope), operationsForgeSource(scope)],
    facets: [
      { name: 'phaseCode', label: 'Fase', options: [...phases].map(([value, label]) => ({ value, label: `${value} · ${label}` })) },
      { name: 'status', label: 'Estado Jira', options: [...statuses].map(([value, label]) => ({ value, label }))
        .sort((left, right) => left.label.localeCompare(right.label, 'es-AR') || left.value.localeCompare(right.value)) },
    ],
    notes: ['Desde y Hasta filtran el vencimiento de Jira. El fin planificado pertenece al snapshot sintético.'],
  };
}

export async function readWorkDetail(scope: OperationsScope, code: string, query: typeof executeSql = executeSql): Promise<OperationsDetail | undefined> {
  const [main] = await readVisibleWork(scope, code, query);
  if (!main) {
    return undefined;
  }
  const { row, issue, cutoff } = main;
  const dependencies = await query<DependencyRow>(
    `SELECT d.id, d.predecessor_id, d.relation_type, d.lag_days, neighbor.code, m.source_id
     FROM ctx_dependency d
     INNER JOIN ctx_work_package neighbor ON neighbor.project_id = d.project_id AND neighbor.tombstoned_at IS NULL
       AND neighbor.id = CASE WHEN d.predecessor_id = ? THEN d.successor_id ELSE d.predecessor_id END
       AND neighbor.id <> ? AND neighbor.source_updated_at <= ?
     INNER JOIN ctx_source_mapping m ON m.project_id = neighbor.project_id AND m.entity_id = neighbor.id
       AND m.entity_kind = 'WORK_PACKAGE' AND m.source_system = 'JIRA' AND m.source_scope = ?
       AND m.source_id = neighbor.jira_issue_id AND m.tombstoned_at IS NULL
     WHERE d.project_id = ? AND d.tombstoned_at IS NULL AND (d.predecessor_id = ? OR d.successor_id = ?)
     ORDER BY neighbor.code, d.relation_type, d.id`,
    [row.id, row.id, cutoff, scope.jiraProjectId, scope.projectId, row.id, row.id],
  );

  const links: OperationsLink[] = [{ kind: 'jira', label: `Abrir ${issue.key} en Jira`, issueKey: issue.key }];
  const predecessors: OperationsDetail['fields'] = [];
  const successors: OperationsDetail['fields'] = [];
  const linked = new Set<string>();
  for (const dependency of dependencies) {
    const neighbor = visibleIssue(scope, dependency.source_id);
    const lagDays = Number(dependency.lag_days);
    if (!neighbor || !Number.isSafeInteger(lagDays)) {
      continue;
    }
    const outgoing = dependency.predecessor_id === row.id;
    const fields = outgoing ? successors : predecessors;
    fields.push({ label: `${dependency.code} · ${neighbor.key}`, value: `${neighbor.summary} · ${dependency.relation_type} · ${lagDays} d` });
    if (!linked.has(dependency.code)) {
      links.push({ kind: 'record', section: 'work', code: dependency.code, label: `Ver ${dependency.code} · ${neighbor.key}` });
      linked.add(dependency.code);
    }
  }

  return {
    code: row.code,
    title: issue.summary,
    fields: [
      { label: 'Ítem de Jira', value: issue.key },
      { label: 'Estado Jira', value: issue.status.name },
      { label: 'Vencimiento Jira', value: civilDate(issue.dueDate) },
      { label: 'Fase', value: `${row.phase_code} · ${row.phase_name}` },
      { label: 'Hito del plan sintético', value: Number(row.milestone) === 1 ? 'Sí' : 'No' },
      { label: 'Inicio planificado', value: civilDate(row.planned_start) },
      { label: 'Fin planificado', value: civilDate(row.planned_finish) },
      { label: 'Inicio registrado en el fixture', value: civilDate(row.actual_start) },
      { label: 'Fin registrado en el fixture', value: civilDate(row.actual_finish) },
    ],
    links,
    sources: [operationsJiraSource(scope), operationsForgeSource(scope)],
    groups: [
      { label: 'Predecesores', fields: predecessors },
      { label: 'Sucesores', fields: successors },
    ].filter(({ fields }) => fields.length > 0),
  };
}
