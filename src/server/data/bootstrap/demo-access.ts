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

export function isConfiguredDemoProject(runtime: RuntimeContext, jiraProjectId: string, config: {
  cloudId?: string;
  jiraProjectId?: string;
}): boolean {
  return runtime.environmentType === 'DEVELOPMENT' &&
    typeof config.cloudId === 'string' && config.cloudId.length > 0 &&
    typeof config.jiraProjectId === 'string' && config.jiraProjectId === jiraProjectId &&
    runtime.installation?.contexts.some((site) =>
      site.cloudId === config.cloudId && site.toString().startsWith('ari:cloud:jira:')) === true;
}
