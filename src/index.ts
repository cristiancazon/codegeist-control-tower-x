import api, { NeedsAuthenticationError, route } from '@forge/api';
import Resolver from '@forge/resolver';
import { createHealthResolver } from './server/health';
import { HEALTH_OPERATION } from './shared/health';
import { DEMO_APPLY, DEMO_PREVIEW } from './shared/demo';
import { applyDemo, previewDemo } from './server/data/bootstrap/resolvers';

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

export const handler = resolver.getDefinitions();
