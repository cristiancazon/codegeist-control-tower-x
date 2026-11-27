import type { JiraProjectAdapter } from './adapter';
import { isFixtureMarker, isText, readIssueIdentity } from './normalize';
import { JiraBoundaryError, type JiraIssueIdentity } from './types';

const MAX_RECONCILIATION_PAGES = 20;

export type FixtureReconciliationState = {
  projectId: string;
  marker: string;
  nextPageToken: string;
  candidate: JiraIssueIdentity | null;
  usedPageTokens: string[];
};

export type FixtureReconciliation =
  | { status: 'FOUND'; issue: JiraIssueIdentity }
  | { status: 'PENDING'; state: FixtureReconciliationState }
  | { status: 'NOT_VISIBLE' }
  | { status: 'CONFLICT' };

/**
 * Advance one bounded, read-only page from a server-owned checkpoint. A negative
 * result can mean delayed indexing or restricted visibility, so callers must keep
 * an uncertain Jira POST fenced until a positive, unique match is confirmed.
 */
export async function reconcileFixtureTask(
  jira: Pick<JiraProjectAdapter, 'projectId' | 'searchWorkItems' | 'getWorkItem'>,
  marker: string,
  state?: FixtureReconciliationState,
): Promise<FixtureReconciliation> {
  if (!isFixtureMarker(marker) || (state && (state.marker !== marker || state.projectId !== jira.projectId ||
      !isText(state.nextPageToken, 4096) || !Array.isArray(state.usedPageTokens) ||
      state.usedPageTokens.length >= MAX_RECONCILIATION_PAGES ||
      !state.usedPageTokens.every((token) => isText(token, 4096)) ||
      (state.candidate !== null && !readIssueIdentity(state.candidate))))) {
    throw new JiraBoundaryError('VALIDATION_ERROR', 'La conciliación del fixture no pertenece a este proyecto o marcador.');
  }

  const usedPageTokens = new Set(state?.usedPageTokens ?? []);
  if (state) {
    if (usedPageTokens.has(state.nextPageToken)) {
      return { status: 'CONFLICT' };
    }
    usedPageTokens.add(state.nextPageToken);
  }

  const page = await jira.searchWorkItems({ marker, nextPageToken: state?.nextPageToken, pageSize: 10 });
  let candidate = state?.candidate ?? null;
  for (const item of page.items) {
    const fixtureLabels = item.labels.filter(isFixtureMarker);
    if (item.projectId !== jira.projectId || fixtureLabels.length !== 1 || fixtureLabels[0] !== marker ||
        (candidate && (candidate.id !== item.id || candidate.key !== item.key))) {
      return { status: 'CONFLICT' };
    }
    candidate = { id: item.id, key: item.key };
  }

  if (page.nextPageToken !== null) {
    if (usedPageTokens.has(page.nextPageToken) || usedPageTokens.size + 1 >= MAX_RECONCILIATION_PAGES) {
      return { status: 'CONFLICT' };
    }
    return {
      status: 'PENDING',
      state: {
        projectId: jira.projectId,
        marker,
        nextPageToken: page.nextPageToken,
        candidate,
        usedPageTokens: [...usedPageTokens],
      },
    };
  }

  if (!candidate) {
    return { status: 'NOT_VISIBLE' };
  }

  // Confirm through the canonical issue read because the JQL index can be stale.
  const issue = await jira.getWorkItem(candidate.id);
  const markerLabels = issue.labels.filter(isFixtureMarker);
  if (issue.id !== candidate.id || issue.projectId !== jira.projectId || markerLabels.length !== 1 || markerLabels[0] !== marker) {
    return { status: 'CONFLICT' };
  }
  return { status: 'FOUND', issue: { id: issue.id, key: issue.key } };
}
