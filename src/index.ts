import api, { NeedsAuthenticationError, route } from '@forge/api';
import Resolver from '@forge/resolver';
import { createHealthResolver } from './server/health';
import { HEALTH_OPERATION } from './shared/health';
import { INTEGRATIONS_GET } from './shared/integrations';
import { forgeIntegrationsResolver } from './server/integrations/forge';
import { DEMO_APPLY, DEMO_PREVIEW } from './shared/demo';
import { applyDemo, previewDemo } from './server/data/bootstrap/resolvers';
import { overviewResolvers } from './server/overview/resolvers';
import { OVERVIEW_ALERT, OVERVIEW_GET } from './shared/overview';
import { operationsResolvers } from './server/operations/resolvers';
import { OPERATIONS_DETAIL, OPERATIONS_LIST } from './shared/operations';
import { cancelRun, compareRuns, createScenario, getRun, grantDemoPlanner, listScenarios, retryRun, startRun } from './server/futuros/resolvers';
import {
  FUTUROS_CANCEL, FUTUROS_COMPARE, FUTUROS_CREATE_SCENARIO, FUTUROS_GRANT, FUTUROS_RETRY, FUTUROS_RUN,
  FUTUROS_SCENARIOS, FUTUROS_START,
} from './shared/futuros';

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
resolver.define(INTEGRATIONS_GET, forgeIntegrationsResolver(resolveHealth));
resolver.define(DEMO_PREVIEW, previewDemo);
resolver.define(DEMO_APPLY, applyDemo);
resolver.define(OVERVIEW_GET, overviewResolvers.get);
resolver.define(OVERVIEW_ALERT, overviewResolvers.alert);
resolver.define(OPERATIONS_LIST, operationsResolvers.list);
resolver.define(OPERATIONS_DETAIL, operationsResolvers.detail);
resolver.define(FUTUROS_SCENARIOS, listScenarios);
resolver.define(FUTUROS_CREATE_SCENARIO, createScenario);
resolver.define(FUTUROS_START, startRun);
resolver.define(FUTUROS_RETRY, retryRun);
resolver.define(FUTUROS_RUN, getRun);
resolver.define(FUTUROS_CANCEL, cancelRun);
resolver.define(FUTUROS_COMPARE, compareRuns);
resolver.define(FUTUROS_GRANT, grantDemoPlanner);

export const handler = resolver.getDefinitions();
