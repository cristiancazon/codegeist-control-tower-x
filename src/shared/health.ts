export const HEALTH_OPERATION = 'system.health';

export type HealthStatus = 'READY' | 'DEGRADED' | 'UNAVAILABLE';

export type HealthErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'SOURCE_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export type HealthResponse =
  | {
      ok: true;
      data: { status: HealthStatus; projectId: string };
      requestId: string;
    }
  | {
      ok: false;
      error: { code: HealthErrorCode; message: string; retryable: boolean };
      requestId: string;
    };
