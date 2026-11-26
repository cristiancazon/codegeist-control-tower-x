import api, { getAppContext, route, type Route } from '@forge/api';
import { createForgeJiraProjectAdapter } from '../data/jira';
import { isIssueKey, isJiraId, isRecord } from '../data/jira/normalize';
import { getProjectAccess, type ProjectAccess } from '../data/sql/projects';

type AssetsBinding = { cloudId: string; projectId: string; workspaceId: string; objectId: string; typeId: string };
type AssetsResult =
  | { state: 'DISABLED' | 'NOT_AVAILABLE' | 'UNAVAILABLE' }
  | { state: 'READY'; source: 'ASSETS'; observedAt: string; reference: string };

type AssetsDependencies = {
  authorize(context: unknown): { projectId: string; assertBrowsePermission(): Promise<void> };
  getAccess(projectId: string, accountId: string): Promise<ProjectAccess | undefined>;
  cloudIds(): readonly string[];
  getObject(path: Route): Promise<{ status: number; json(): Promise<unknown> }>;
  now(): Date;
};

const workspaceId = /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$/i;

export function createAssetsProbe(deps: AssetsDependencies) {
  return async (context: unknown, binding?: AssetsBinding): Promise<AssetsResult> => {
    if (!binding || !workspaceId.test(binding.cloudId) || !workspaceId.test(binding.workspaceId) ||
        !isJiraId(binding.projectId) || !isJiraId(binding.objectId) || !isJiraId(binding.typeId)) {
      return { state: 'DISABLED' };
    }

    try {
      const jira = deps.authorize(context);
      if (!isRecord(context) || typeof context.accountId !== 'string' || binding.projectId !== jira.projectId ||
          context.installContext !== `ari:cloud:jira::site/${binding.cloudId}` ||
          !deps.cloudIds().includes(binding.cloudId)) {
        return { state: 'DISABLED' };
      }
      await jira.assertBrowsePermission();
      const access = await deps.getAccess(jira.projectId, context.accountId);
      if (!access?.roles.length) return { state: 'NOT_AVAILABLE' };

      const response = await deps.getObject(route`/jsm/assets/workspace/${binding.workspaceId}/v1/object/${binding.objectId}`);
      if ([401, 403, 404].includes(response.status)) return { state: 'NOT_AVAILABLE' };
      if (response.status !== 200) return { state: 'UNAVAILABLE' };

      const data = await response.json();
      if (!isRecord(data) || data.workspaceId !== binding.workspaceId || data.id !== binding.objectId ||
          !isRecord(data.objectType) || data.objectType.id !== binding.typeId || !isIssueKey(data.objectKey)) {
        return { state: 'UNAVAILABLE' };
      }
      return { state: 'READY', source: 'ASSETS', observedAt: deps.now().toISOString(), reference: data.objectKey };
    } catch {
      return { state: 'UNAVAILABLE' };
    }
  };
}

export function probeAssets(context: unknown) {
  const read = createAssetsProbe({
    authorize: createForgeJiraProjectAdapter,
    getAccess: getProjectAccess,
    cloudIds: () => (getAppContext().installation?.contexts ?? [])
      .filter((site) => site.toString().startsWith('ari:cloud:jira:')).flatMap((site) => site.cloudId ? [site.cloudId] : []),
    getObject: (path) => api.asUser().requestJira(path, {
      method: 'GET', headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(5000),
    }),
    now: () => new Date(),
  });
  const env = process.env;
  return read(context, env.CTX_ASSETS_ENABLED === 'true' ? {
    cloudId: env.CTX_ASSETS_CLOUD_ID ?? '', projectId: env.CTX_ASSETS_JIRA_PROJECT_ID ?? '',
    workspaceId: env.CTX_ASSETS_WORKSPACE_ID ?? '', objectId: env.CTX_ASSETS_OBJECT_ID ?? '',
    typeId: env.CTX_ASSETS_OBJECT_TYPE_ID ?? '',
  } : undefined);
}
