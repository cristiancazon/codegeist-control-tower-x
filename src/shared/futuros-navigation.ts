export type ProjectView = 'overview' | 'operations' | 'futuros';

export type ProjectRoute = { view: ProjectView; runId?: string };

const runPath = /^\/futuros\/([a-f0-9-]{36})\/?$/;
const runIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export function projectRoute(pathname: string): ProjectRoute {
  const runId = runPath.exec(pathname)?.[1];
  if (runId && runIdPattern.test(runId)) return { view: 'futuros', runId };
  if (pathname === '/futuros' || pathname === '/futuros/') return { view: 'futuros' };
  if (pathname === '/operaciones' || pathname === '/operaciones/') return { view: 'operations' };
  return { view: 'overview' };
}

export function projectPath(route: ProjectRoute): string {
  if (route.view === 'operations') return '/operaciones';
  if (route.view === 'futuros') {
    return route.runId && runIdPattern.test(route.runId) ? `/futuros/${route.runId}` : '/futuros';
  }
  return '/';
}
