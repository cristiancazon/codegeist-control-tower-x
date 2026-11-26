export type EngineErrorCode = 'INVALID_SCENARIO' | 'INSUFFICIENT_DATA' | 'RESOURCE_INFEASIBLE' | 'MODEL_UNAVAILABLE';

export class EngineValidationError extends Error {
  constructor(readonly code: EngineErrorCode, readonly field: string, message: string) {
    super(message);
    this.name = 'EngineValidationError';
  }
}

export function requireModel(
  condition: unknown, field: string, message: string, code: EngineErrorCode = 'INVALID_SCENARIO',
): asserts condition {
  if (!condition) throw new EngineValidationError(code, field, message);
}
