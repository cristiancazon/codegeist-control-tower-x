import api from '@forge/api';
import { createJiraProjectAdapter } from './adapter.js';
import { isJiraId, isRecord, isText } from './normalize.js';
import { JiraBoundaryError } from './types.js';

export function createForgeJiraProjectAdapter(context: unknown, budgetMs?: number) {
  if (!isRecord(context) || !isText(context.accountId, 128) || context.accountType === 'anonymous') {
    throw new JiraBoundaryError('AUTH_REQUIRED', 'Se requiere una cuenta de Jira autenticada.');
  }

  // The caller must pass the resolver context provided by Forge, separate from the request payload.
  const extension = context.extension;
  const project = isRecord(extension) ? extension.project : undefined;
  if (!isText(context.installContext, 512) || !isRecord(project) || !isJiraId(project.id)) {
    throw new JiraBoundaryError('FORBIDDEN', 'La operación requiere el contexto de un proyecto Jira.');
  }

  return createJiraProjectAdapter(project.id, (path, options) => api.asUser().requestJira(path, options), budgetMs);
}
