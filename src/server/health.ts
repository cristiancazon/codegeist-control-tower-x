import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { HEALTH_OPERATION, type HealthErrorCode, type HealthResponse } from '../shared/health';

type HealthLog = {
  requestId: string;
  operation: typeof HEALTH_OPERATION;
  durationMs: number;
  code: HealthErrorCode | 'READY';
};

export type HealthDependencies = {
  requestBrowsePermission(projectId: string): Promise<{
    status: number;
    json(): Promise<unknown>;
  }>;
  log(entry: HealthLog): void;
  isForgeConsentError?(error: unknown): boolean;
};

const errors: Record<HealthErrorCode, { message: string; retryable: boolean }> = {
  VALIDATION_ERROR: { message: 'La consulta de estado no admite datos de entrada.', retryable: false },
  AUTH_REQUIRED: { message: 'Iniciá sesión en Jira y autorizá el acceso de Control Tower X.', retryable: false },
  FORBIDDEN: { message: 'El proyecto no está disponible para esta cuenta.', retryable: false },
  SOURCE_UNAVAILABLE: { message: 'Jira no pudo verificar el acceso. Volvé a intentar.', retryable: true },
  RATE_LIMITED: { message: 'Jira está limitando las consultas. Esperá antes de volver a intentar.', retryable: true },
  INTERNAL_ERROR: { message: 'Ocurrió un error al consultar el estado.', retryable: true },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isProjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,31}$/.test(value);
}

function jiraFailure(status: number): HealthErrorCode {
  switch (status) {
    case 401:
      return 'AUTH_REQUIRED';
    case 403:
    case 404:
      return 'FORBIDDEN';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'SOURCE_UNAVAILABLE';
  }
}

function isPermissionGranted(body: unknown): boolean | undefined {
  if (!isRecord(body) || !isRecord(body.permissions)) {
    return undefined;
  }

  const browsePermission = body.permissions.BROWSE_PROJECTS;
  if (isRecord(browsePermission) && typeof browsePermission.havePermission === 'boolean') {
    return browsePermission.havePermission;
  }

  return undefined;
}

export function createHealthResolver(dependencies: HealthDependencies) {
  return async function resolveHealth(request: { payload?: unknown; context?: unknown }): Promise<HealthResponse> {
    const requestId = randomUUID();
    const started = performance.now();

    function log(code: HealthLog['code']) {
      dependencies.log({
        requestId,
        operation: HEALTH_OPERATION,
        durationMs: Math.round(performance.now() - started),
        code,
      });
    }

    function failure(code: HealthErrorCode): HealthResponse {
      log(code);
      return { ok: false, error: { code, ...errors[code] }, requestId };
    }

    const { payload, context } = request;
    if (payload !== undefined && (!isRecord(payload) || Reflect.ownKeys(payload).length !== 0)) {
      return failure('VALIDATION_ERROR');
    }

    if (!isRecord(context) || !isNonemptyString(context.accountId) || context.accountType === 'anonymous') {
      return failure('AUTH_REQUIRED');
    }

    const extension = context.extension;
    const project = isRecord(extension) ? extension.project : undefined;
    if (!isNonemptyString(context.installContext) || !isRecord(project) || !isProjectId(project.id)) {
      return failure('FORBIDDEN');
    }

    // Forge authenticates as the current user. The context project is a selector, never proof of access.
    let response: Awaited<ReturnType<HealthDependencies['requestBrowsePermission']>>;
    try {
      response = await dependencies.requestBrowsePermission(project.id);
    } catch (error) {
      if (dependencies.isForgeConsentError?.(error)) {
        // The Forge host intercepts this specific error to prompt for consent.
        log('AUTH_REQUIRED');
        throw error;
      }

      const status = isRecord(error) ? error.status ?? error.statusCode : undefined;
      return failure(typeof status === 'number' ? jiraFailure(status) : 'INTERNAL_ERROR');
    }

    if (response.status !== 200) {
      return failure(jiraFailure(response.status));
    }

    let granted: boolean | undefined;
    try {
      granted = isPermissionGranted(await response.json());
    } catch {
      return failure('SOURCE_UNAVAILABLE');
    }

    if (granted !== true) {
      return failure(granted === false ? 'FORBIDDEN' : 'SOURCE_UNAVAILABLE');
    }

    log('READY');
    return { ok: true, data: { status: 'READY', projectId: project.id }, requestId };
  };
}
