export function readDemoActor(context: unknown): string | undefined {
  if (typeof context !== 'object' || context === null || !('accountId' in context) ||
      typeof context.accountId !== 'string' || !/^[^\s\p{Cc}]{1,128}$/u.test(context.accountId) ||
      ('accountType' in context && context.accountType === 'anonymous')) {
    return undefined;
  }
  return context.accountId;
}

type RuntimeContext = {
  environmentType: string;
  installation?: { contexts: ReadonlyArray<{ toString(): string; cloudId?: string }> };
};

type DemoTarget = {
  cloudId?: string;
  jiraProjectId?: string;
};

function matchesDemoTarget(runtime: RuntimeContext, jiraProjectId: string, config: DemoTarget): boolean {
  return typeof config.cloudId === 'string' && config.cloudId.length > 0 &&
    typeof config.jiraProjectId === 'string' && config.jiraProjectId === jiraProjectId &&
    runtime.installation?.contexts.some((site) =>
      site.cloudId === config.cloudId && site.toString().startsWith('ari:cloud:jira:')) === true;
}

export function isConfiguredDemoProject(runtime: RuntimeContext, jiraProjectId: string, config: DemoTarget): boolean {
  return runtime.environmentType === 'DEVELOPMENT' && matchesDemoTarget(runtime, jiraProjectId, config);
}

export function isConfiguredEvaluationProject(
  runtime: RuntimeContext, jiraProjectId: string, config: DemoTarget & { enabled?: string },
): boolean {
  return (runtime.environmentType === 'STAGING' || runtime.environmentType === 'PRODUCTION') &&
    config.enabled === 'true' && matchesDemoTarget(runtime, jiraProjectId, config);
}

export function isConfiguredStagingAdoption(
  runtime: RuntimeContext, jiraProjectId: string, config: DemoTarget & { enabled?: string },
): boolean {
  return runtime.environmentType === 'STAGING' && config.enabled === 'true' && matchesDemoTarget(runtime, jiraProjectId, config);
}
