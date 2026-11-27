export type ProjectView = 'overview' | 'operations' | 'futuros' | 'decisions';

export type ProjectRoute = { view: ProjectView; runId?: string; decisionId?: string };

const runPath = /^\/futuros\/([a-f0-9-]{36})\/?$/;
const decisionPath = /^\/decisiones\/([a-f0-9-]{36})\/?$/;
const draftPath = /^\/decisiones\/nueva\/([a-f0-9-]{36})\/?$/;
const runIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export function projectRoute(pathname: string): ProjectRoute {
  const runId = runPath.exec(pathname)?.[1];
  if (runId && runIdPattern.test(runId)) return { view: 'futuros', runId };
  const decisionId = decisionPath.exec(pathname)?.[1];
  if (decisionId && runIdPattern.test(decisionId)) return { view: 'decisions', decisionId };
  const draftRunId = draftPath.exec(pathname)?.[1];
  if (draftRunId && runIdPattern.test(draftRunId)) return { view: 'decisions', runId: draftRunId };
  if (pathname === '/decisiones' || pathname === '/decisiones/') return { view: 'decisions' };
  if (pathname === '/futuros' || pathname === '/futuros/') return { view: 'futuros' };
  if (pathname === '/operaciones' || pathname === '/operaciones/') return { view: 'operations' };
  return { view: 'overview' };
}

export function projectPath(route: ProjectRoute): string {
  if (route.view === 'operations') return '/operaciones';
  if (route.view === 'decisions') {
    if (route.decisionId && runIdPattern.test(route.decisionId)) return `/decisiones/${route.decisionId}`;
    if (route.runId && runIdPattern.test(route.runId)) return `/decisiones/nueva/${route.runId}`;
    return '/decisiones';
  }
  if (route.view === 'futuros') {
    return route.runId && runIdPattern.test(route.runId) ? `/futuros/${route.runId}` : '/futuros';
  }
  return '/';
}
