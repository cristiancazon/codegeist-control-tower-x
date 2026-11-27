import { getAppContext } from '@forge/api';
import { demoProjectKey, fixture } from '../data/bootstrap/fixture';
import { isJiraId, isRecord, isText } from '../data/jira/normalize';

const accountIdPattern = /^[^\s\p{Cc}]{1,128}$/u;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

type RovoActor = { accountId: string; installContext: string };

export function actorFrom(context: unknown): RovoActor | undefined {
  if (!isRecord(context) || context.accountType === 'anonymous' || !isText(context.installContext, 512)) return;
  const direct = context.accountId;
  const principal = isRecord(context.principal) ? context.principal.accountId : undefined;
  if (direct !== undefined && principal !== undefined && direct !== principal) return;
  const accountId = direct ?? principal;
  if (typeof accountId !== 'string' || !accountIdPattern.test(accountId)) return;
  return { accountId, installContext: context.installContext };
}

export function resolveJiraProjectReference(
  value: unknown,
  configuredProjectId = process.env.CTX_DEMO_JIRA_PROJECT_ID,
): string | undefined {
  if (typeof value !== 'string' || value.length > 64) return;
  const reference = value.trim();
  if (isJiraId(reference)) return reference;
  if ((reference === demoProjectKey || reference === fixture.project.id) && isJiraId(configuredProjectId)) {
    return configuredProjectId;
  }
}

export function rovoProjectContext(actor: RovoActor, jiraProjectId: string) {
  // The action input selects a project. The called resolver checks Jira and app
  // permissions independently, using the actor from the Forge function context.
  return { ...actor, extension: { project: { id: jiraProjectId } } };
}

export function isRunReference(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

export function authorizedRunPath(jiraProjectId: string, runId: string): string | undefined {
  if (jiraProjectId !== process.env.CTX_DEMO_JIRA_PROJECT_ID || !isRunReference(runId)) return;
  try {
    const { appAri, environmentAri } = getAppContext();
    if (!uuidPattern.test(appAri.appId) || !uuidPattern.test(environmentAri.environmentId)) return;
    return '/jira/software/projects/' + demoProjectKey + '/apps/' + appAri.appId +
      '/' + environmentAri.environmentId + '/futuros/' + runId;
  } catch {
    return;
  }
}
