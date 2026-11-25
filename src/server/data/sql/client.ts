import { ForgeSQLAPIError, sql, type Result } from '@forge/sql';

export type SqlParameter = string | number | boolean | null;

// Repositories own the statement and bind every runtime value.
export async function executeSql<Row>(
  statement: string,
  parameters: readonly SqlParameter[],
): Promise<Result<Row>['rows']> {
  const result = await sql.prepare<Row>(statement).bindParams(...parameters).execute();
  return result.rows;
}

export function getSqlApiError(error: unknown): ForgeSQLAPIError | undefined {
  if (error instanceof ForgeSQLAPIError) {
    return error;
  }

  // The migration runner wraps errors from either the DDL or its checkpoint.
  if (error instanceof Error && error.cause instanceof ForgeSQLAPIError) {
    return error.cause;
  }
}
