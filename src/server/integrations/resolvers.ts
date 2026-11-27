import type { HealthResponse } from '../../shared/health';
import type { IntegrationCapability, IntegrationsResult } from '../../shared/integrations';

type Request = { payload?: unknown; context?: unknown };
type ProbeResult =
  | { state: 'READY'; observedAt: string; reference?: string }
  | { state: 'DISABLED' | 'NOT_AVAILABLE' | 'UNAVAILABLE' | 'PARTIAL' | 'EMPTY' };
type Probe = (context: unknown) => Promise<ProbeResult>;
type OptionalSource = 'JSM' | 'ASSETS' | 'CONFLUENCE';

const optionalSources = {
  JSM: {
    label: 'Jira Service Management',
    operation: 'GET /rest/servicedeskapi/request/{id}',
    prerequisite: 'Requiere un proyecto de servicio vinculado, consentimiento de lectura y acceso al incidente.',
    fallback: 'Explorar proyecto conserva los indicadores HSE sintéticos según el rol.',
  },
  ASSETS: {
    label: 'Assets',
    operation: 'GET /jsm/assets/workspace/{workspaceId}/v1/object/{id}',
    prerequisite: 'Requiere un workspace y un objeto autorizados, con consentimiento de lectura.',
    fallback: 'Explorar proyecto conserva el inventario sintético de Patagonia.',
  },
  CONFLUENCE: {
    label: 'Confluence',
    operation: 'GET /wiki/api/v2/pages/{id}',
    prerequisite: 'Requiere una instalación vinculada y páginas autorizadas en un espacio del mismo sitio.',
    fallback: 'Agent X conserva el catálogo sintético de conocimiento.',
  },
} satisfies Record<OptionalSource, { label: string; operation: string; prerequisite: string; fallback: string }>;

function describeProbe(id: OptionalSource, result: PromiseSettledResult<ProbeResult>): IntegrationCapability {
  const { label, operation, prerequisite, fallback } = optionalSources[id];
  const base = { id, label, fallback };
  const probe = result.status === 'fulfilled' ? result.value : { state: 'UNAVAILABLE' } as const;
  switch (probe.state) {
    case 'READY':
      return { ...base, status: 'VERIFIED', detail: 'Lectura confirmada con la cuenta actual.', evidence: {
        operation, observedAt: probe.observedAt, reference: probe.reference,
      } };
    case 'DISABLED':
      return { ...base, status: 'DISABLED', detail: prerequisite };
    case 'NOT_AVAILABLE':
    case 'EMPTY':
      return { ...base, status: 'UNVERIFIED', detail: 'La cuenta actual no obtuvo una referencia de prueba visible.' };
    case 'PARTIAL':
    case 'UNAVAILABLE':
      return { ...base, status: 'DEGRADED', detail: 'La fuente no confirmó una lectura completa. Podés volver a verificar.' };
  }
}

export function createIntegrationsResolver(deps: {
  resolveHealth(request: Request): Promise<HealthResponse>;
  probes: Record<OptionalSource, Probe>;
  now(): Date;
}) {
  return async (request: Request): Promise<IntegrationsResult> => {
    const health = await deps.resolveHealth(request);
    if (!health.ok) return health;
    if (health.data.status !== 'READY') {
      return { ok: false, requestId: health.requestId, error: {
        code: 'SOURCE_UNAVAILABLE', message: 'Jira no pudo verificar el acceso al proyecto.', retryable: true,
      } };
    }

    const observedAt = deps.now().toISOString();
    const [jsm, assets, confluence] = await Promise.allSettled([
      deps.probes.JSM(request.context), deps.probes.ASSETS(request.context), deps.probes.CONFLUENCE(request.context),
    ]);
    return { ok: true, requestId: health.requestId, data: { projectId: health.data.projectId, observedAt, capabilities: [
      { id: 'JIRA', label: 'Jira', status: 'VERIFIED', detail: 'Jira confirmó el permiso de lectura en este proyecto.',
        evidence: { operation: 'BROWSE_PROJECTS', observedAt } },
      describeProbe('JSM', jsm), describeProbe('ASSETS', assets), describeProbe('CONFLUENCE', confluence),
      { id: 'ROVO', label: 'Rovo', status: 'UNVERIFIED', detail: 'La disponibilidad se comprueba en la sesión de Jira.',
        fallback: 'Vista general y Futuros conservan los indicadores y resultados.' },
      { id: 'MCP', label: 'Rovo MCP', status: 'DISABLED', detail: 'Preview. La instalación requiere una herramienta aprobada y un cliente con consentimiento.' },
      { id: 'TEAMWORK_GRAPH', label: 'Teamwork Graph', status: 'DISABLED', detail: 'Preview. Requiere consentimiento y una relación Jira–objetivo de prueba verificable.' },
      { id: 'ROVO_SKILL', label: 'Rovo Skills', status: 'DISABLED', detail: 'Preview. Este perfil usa las acciones de lectura de Agent X.' },
    ] } };
  };
}
