import api, { getAppContext, route } from '@forge/api';
import { actorFrom, resolveJiraProjectReference, rovoProjectContext } from '../agent-x/context';
import { createForgeJiraProjectAdapter } from '../data/jira';
import { isRecord } from '../data/jira/normalize';
import { getProjectAccess } from '../data/sql/projects';
import { createConfluenceKnowledge, readConfluenceFilters, type ConfluenceKnowledgeResult } from './confluence';

const confluence = createConfluenceKnowledge({
  settings: () => ({ enabled: process.env.CTX_CONFLUENCE_ENABLED, cloudId: process.env.CTX_CONFLUENCE_CLOUD_ID,
    jiraProjectId: process.env.CTX_CONFLUENCE_JIRA_PROJECT_ID, spaceId: process.env.CTX_CONFLUENCE_SPACE_ID,
    pageIndex: process.env.CTX_CONFLUENCE_PAGE_INDEX }),
  runtime: getAppContext,
  jira: createForgeJiraProjectAdapter,
  access: getProjectAccess,
  requestPage: (id, signal) => api.asUser().requestConfluence(route`/wiki/api/v2/pages/${id}?body-format=atlas_doc_format`, {
    method: 'GET', headers: { Accept: 'application/json' }, signal, redirect: 'error',
  }),
  now: () => new Date(),
});

export const probeConfluenceKnowledge = confluence.probe;

export async function searchConfluenceKnowledge(payload: unknown, context: unknown): Promise<ConfluenceKnowledgeResult> {
  const failure = (reason: 'AUTH_REQUIRED' | 'INVALID_REFERENCE'): ConfluenceKnowledgeResult =>
    ({ source: 'CONFLUENCE', state: 'UNAVAILABLE', observedAt: null, reason, documents: [] });
  const actor = actorFrom(context);
  if (!actor) return failure('AUTH_REQUIRED');
  if (!isRecord(payload) || !Object.hasOwn(payload, 'jiraProjectId') || Reflect.ownKeys(payload).some((key) =>
    key !== 'jiraProjectId' && key !== 'query' && key !== 'phaseCode' && key !== 'pageId' && key !== 'context')) {
    return failure('INVALID_REFERENCE');
  }
  const jiraProjectId = resolveJiraProjectReference(payload.jiraProjectId, process.env.CTX_CONFLUENCE_JIRA_PROJECT_ID);
  const filters = readConfluenceFilters(payload);
  if (!jiraProjectId || !filters) return failure('INVALID_REFERENCE');
  return confluence.search(rovoProjectContext(actor, jiraProjectId), filters);
}
