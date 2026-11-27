import type { HealthResponse } from '../../shared/health';
import { isJiraId } from '../data/jira/normalize';
import { probeAssets } from './assets';
import { probeConfluenceKnowledge } from './confluence-forge';
import { readJsmIncidentDetail } from './jsm';
import { createIntegrationsResolver } from './resolvers';

async function probeJsm(context: unknown) {
  const env = process.env;
  const { CTX_JSM_SAMPLE_ISSUE_ID: issueId } = env;
  if (env.CTX_JSM_ENABLED !== 'true' || !isJiraId(issueId)) return { state: 'DISABLED' } as const;

  const result = await readJsmIncidentDetail(context, {
    enabled: true, cloudId: env.CTX_JSM_CLOUD_ID ?? '', jiraProjectId: env.CTX_JSM_JIRA_PROJECT_ID ?? '',
    serviceDeskId: env.CTX_JSM_SERVICE_DESK_ID ?? '', serviceProjectId: env.CTX_JSM_SERVICE_PROJECT_ID ?? '',
    serviceProjectKey: env.CTX_JSM_SERVICE_PROJECT_KEY ?? '', requestTypeIds: [env.CTX_JSM_REQUEST_TYPE_ID ?? ''],
  }, issueId);
  return result.state === 'READY'
    ? { state: result.state, observedAt: result.observedAt, reference: result.data.issueKey }
    : { state: result.state };
}

export function forgeIntegrationsResolver(resolveHealth: (request: { payload?: unknown; context?: unknown }) => Promise<HealthResponse>) {
  return createIntegrationsResolver({
    resolveHealth,
    now: () => new Date(),
    probes: {
      JSM: probeJsm,
      ASSETS: probeAssets,
      CONFLUENCE: async (context) => {
        const probe = await probeConfluenceKnowledge(context);
        if (probe.state === 'READY') {
          return probe.observedAt ? { state: 'READY', observedAt: probe.observedAt } : { state: 'UNAVAILABLE' };
        }
        return { state: probe.state };
      },
    },
  });
}
