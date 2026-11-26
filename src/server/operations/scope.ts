import type { OperationsFilters, OperationsSource } from '../../shared/operations';
import { OPERATIONS_PAGE_SIZE } from '../../shared/operations';
import type { SourceState } from '../../shared/overview';
import type { JiraWorkItem } from '../data/jira';
import type { ProjectRole } from '../data/sql/projects';

export type OperationsScope = {
  projectId: string;
  jiraProjectId: string;
  roles: readonly ProjectRole[];
  snapshot: { asOf: string; collectedAt: string } | null;
  observedAt: string;
  jiraIssues: ReadonlyMap<string, JiraWorkItem>;
  jiraState: SourceState;
};

export function paginateOperations<T>(rows: readonly T[], filters: OperationsFilters): T[] {
  const start = ((filters.page ?? 1) - 1) * OPERATIONS_PAGE_SIZE;
  return rows.slice(start, start + OPERATIONS_PAGE_SIZE);
}

export function visibleOperationsIssue(scope: OperationsScope, id: string | null): JiraWorkItem | undefined {
  const issue = id && scope.jiraState !== 'UNAVAILABLE' ? scope.jiraIssues.get(id) : undefined;
  return issue?.projectId === scope.jiraProjectId ? issue : undefined;
}

export function operationsJiraSource(scope: OperationsScope): OperationsSource {
  return {
    source: 'JIRA', state: scope.jiraState, quality: 'LIVE',
    observedAt: scope.jiraState === 'UNAVAILABLE' ? null : scope.observedAt,
    detail: scope.jiraState === 'READY' ? 'Ítems visibles para tu cuenta en Jira.'
      : scope.jiraState === 'PARTIAL' ? 'Jira devolvió solo parte de los ítems visibles.'
      : 'Jira no confirmó los ítems visibles para esta consulta.',
  };
}

export function operationsForgeSource(scope: OperationsScope): OperationsSource {
  return {
    source: 'FORGE', state: scope.snapshot ? 'READY' : 'UNAVAILABLE', quality: 'SYNTHETIC',
    observedAt: scope.snapshot?.collectedAt ?? null,
    detail: scope.snapshot ? 'Datos sintéticos del snapshot vigente de Patagonia.'
      : 'No hay un snapshot sintético sellado y vigente para este proyecto.',
  };
}

export function disabledOperationsSource(source: 'ASSETS' | 'JSM' | 'CONFLUENCE', detail: string): OperationsSource {
  return { source, state: 'DISABLED', quality: null, observedAt: null, detail };
}
