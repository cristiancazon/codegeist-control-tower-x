import type { HealthErrorCode } from './health';

export const INTEGRATIONS_GET = 'integrations.get';

export type CapabilityId = 'JIRA' | 'JSM' | 'ASSETS' | 'CONFLUENCE' | 'ROVO' | 'MCP' | 'TEAMWORK_GRAPH' | 'ROVO_SKILL';

export type IntegrationCapability = {
  id: CapabilityId;
  label: string;
  status: 'VERIFIED' | 'DISABLED' | 'DEGRADED' | 'UNVERIFIED';
  detail: string;
  fallback?: string;
  evidence?: { operation: string; observedAt: string; reference?: string };
};

export type IntegrationsResult =
  | { ok: true; data: { projectId: string; observedAt: string; capabilities: IntegrationCapability[] }; requestId: string }
  | { ok: false; error: { code: HealthErrorCode; message: string; retryable: boolean }; requestId: string };
