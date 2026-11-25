import api, { NeedsAuthenticationError, route } from '@forge/api';
import Resolver from '@forge/resolver';
import { createHealthResolver } from './server/health';
import { HEALTH_OPERATION } from './shared/health';
import { DEMO_APPLY, DEMO_PREVIEW } from './shared/demo';
import { applyDemo, previewDemo } from './server/data/bootstrap/resolvers';
import { overviewResolvers } from './server/overview/resolvers';
import { OVERVIEW_ALERT, OVERVIEW_GET } from './shared/overview';

const resolveHealth = createHealthResolver({
  requestBrowsePermission: (projectId) =>
    api.asUser().requestJira(route`/rest/api/3/mypermissions?projectId=${projectId}&permissions=BROWSE_PROJECTS`, {
      headers: { Accept: 'application/json' },
    }),
  log: (entry) => console.info(JSON.stringify(entry)),
  isForgeConsentError: (error) => error instanceof NeedsAuthenticationError,
});

const resolver = new Resolver();
resolver.define(HEALTH_OPERATION, resolveHealth);
resolver.define(DEMO_PREVIEW, previewDemo);
resolver.define(DEMO_APPLY, applyDemo);
resolver.define(OVERVIEW_GET, overviewResolvers.get);
resolver.define(OVERVIEW_ALERT, overviewResolvers.alert);

export const handler = resolver.getDefinitions();
