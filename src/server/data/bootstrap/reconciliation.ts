import { createHash, randomInt } from 'node:crypto';
import type { UpdateQueryResponse } from '@forge/sql';
import {
  reconcileFixtureTask,
  type FixtureReconciliation,
  type FixtureReconciliationState,
  type JiraProjectAdapter,
} from '../jira/index';
import { isFixtureMarker, isJiraId, isRecord, isText, readIssueIdentity } from '../jira/normalize';
import { JiraBoundaryError } from '../jira/types';
import { executeSql } from '../sql/client';

const source = 'JIRA_RECONCILE';
const schemaVersion = 1;
const maxCursorBytes = 48 * 1024;
const localProjectIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

type Input = {
  projectId: string;
  actorAccountId: string;
  jira: Pick<JiraProjectAdapter, 'projectId' | 'searchWorkItems' | 'getWorkItem'>;
  marker: string;
};

type Row = {
  state: string;
  cursor_value: string | null;
  source_schema_version: number;
  fence: string;
  is_fresh: number | string;
};

export type DurableFixtureReconciliation =
  | Exclude<FixtureReconciliation, { status: 'PENDING' }>
  | { status: 'PENDING' };

function readCheckpoint(cursor: unknown, actorHash: string, jiraProjectId: string, marker: string): FixtureReconciliationState | undefined {
  if (typeof cursor !== 'string' || Buffer.byteLength(cursor) > maxCursorBytes) {
    return undefined;
  }

  let stored: unknown;
  try {
    stored = JSON.parse(cursor);
  } catch {
    return undefined;
  }

  if (!isRecord(stored) || stored.actorHash !== actorHash || !isRecord(stored.checkpoint)) {
    return undefined;
  }
  const { projectId, marker: savedMarker, candidate, nextPageToken, usedPageTokens } = stored.checkpoint;
  if (projectId !== jiraProjectId || savedMarker !== marker || !isText(nextPageToken, 4096) ||
      !Array.isArray(usedPageTokens) || usedPageTokens.length >= 20 ||
      !usedPageTokens.every((token): token is string => isText(token, 4096)) ||
      new Set(usedPageTokens).size !== usedPageTokens.length || usedPageTokens.includes(nextPageToken)) {
    return undefined;
  }

  const identity = candidate === null ? null : readIssueIdentity(candidate);
  if (identity === undefined) {
    return undefined;
  }
  return { projectId, marker: savedMarker, candidate: identity, nextPageToken, usedPageTokens };
}

/**
 * Advance one read-only Jira page and persist its continuation before returning.
 * NOT_VISIBLE describes only what the current account saw. An uncertain write
 * stays fenced by the separate fixture-ticket reservation until a positive match.
 */
export async function advanceFixtureReconciliation(
  { projectId, actorAccountId, jira, marker }: Input,
  query: typeof executeSql = executeSql,
): Promise<DurableFixtureReconciliation> {
  if (!localProjectIdPattern.test(projectId) || !isJiraId(jira.projectId) ||
      !isText(actorAccountId, 128) || !isFixtureMarker(marker)) {
    throw new JiraBoundaryError('VALIDATION_ERROR', 'La conciliación requiere un proyecto y una identidad válidos.');
  }

  const key = [projectId, source, marker];
  const readRow = async () => {
    const rows = await query<Row>(
      `SELECT s.state, s.cursor_value, s.source_schema_version, CAST(s.fence AS CHAR) AS fence,
              CASE WHEN s.watermark_at >= UTC_TIMESTAMP(3) - INTERVAL 15 MINUTE THEN 1 ELSE 0 END AS is_fresh
       FROM ctx_sync_state s INNER JOIN ctx_project p ON p.id = s.project_id
       WHERE s.project_id = ? AND s.source_system = ? AND s.scope_id = ?
         AND p.jira_project_id = ? AND p.data_mode = 'DEMO'`,
      [...key, jira.projectId],
    );
    return rows[0];
  };

  let row = await readRow();
  if (!row) {
    // A new nonzero fence keeps an in-flight update from matching a recreated row.
    const initialFence = randomInt(2 ** 46, 2 ** 47);
    await query<UpdateQueryResponse>(
      `INSERT INTO ctx_sync_state (project_id, source_system, scope_id, state, source_schema_version, fence)
       SELECT id, ?, ?, 'IDLE', ?, ? FROM ctx_project
       WHERE id = ? AND jira_project_id = ? AND data_mode = 'DEMO'
       ON DUPLICATE KEY UPDATE project_id = ctx_sync_state.project_id`,
      [source, marker, schemaVersion, initialFence, projectId, jira.projectId],
    );
    row = await readRow();
  }
  if (!row) {
    throw new JiraBoundaryError('FORBIDDEN', 'La conciliación no pertenece al proyecto actual.');
  }
  if (row.source_schema_version !== schemaVersion || !/^[0-9]{1,19}$/.test(row.fence) ||
      ![0, 1, '0', '1'].includes(row.is_fresh) ||
      (row.state !== 'IDLE' && row.state !== 'PENDING') || (row.state === 'IDLE' && row.cursor_value !== null)) {
    return { status: 'CONFLICT' };
  }

  const actorHash = createHash('sha256').update(actorAccountId).digest('hex');
  const fresh = row.is_fresh === 1 || row.is_fresh === '1';
  let checkpoint: FixtureReconciliationState | undefined;
  if (row.state === 'PENDING' && fresh) {
    checkpoint = readCheckpoint(row.cursor_value, actorHash, jira.projectId, marker);
    if (!checkpoint) {
      return { status: 'CONFLICT' };
    }
  }

  // A denied, timed-out or unauthorized Jira read propagates through this helper
  // without advancing the durable cursor.
  const result = await reconcileFixtureTask(jira, marker, checkpoint);
  const cursor = result.status === 'PENDING' ? JSON.stringify({ actorHash, checkpoint: result.state }) : null;
  if (cursor !== null && !readCheckpoint(cursor, actorHash, jira.projectId, marker)) {
    return { status: 'CONFLICT' };
  }

  const update = await query<UpdateQueryResponse>(
    `UPDATE ctx_sync_state
     SET cursor_value = ?, state = ?, watermark_at = UTC_TIMESTAMP(3),
         last_success_at = UTC_TIMESTAMP(3), fence = fence + 1
     WHERE project_id = ? AND source_system = ? AND scope_id = ?
       AND source_schema_version = ? AND fence = ?
       AND EXISTS (SELECT 1 FROM ctx_project WHERE id = ? AND jira_project_id = ? AND data_mode = 'DEMO')`,
    [cursor, cursor === null ? 'IDLE' : 'PENDING', ...key, schemaVersion, row.fence, projectId, jira.projectId],
  );

  if (update.affectedRows !== 0 && update.affectedRows !== 1) {
    throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Forge no confirmó el avance de la conciliación.');
  }
  if (update.affectedRows === 0 || result.status === 'PENDING') {
    return { status: 'PENDING' };
  }
  return result;
}
