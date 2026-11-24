import api, { NeedsAuthenticationError, route } from '@forge/api';
import Resolver from '@forge/resolver';
import { createHealthResolver } from './server/health';
import { HEALTH_OPERATION } from './shared/health';

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

export const handler = resolver.getDefinitions();
