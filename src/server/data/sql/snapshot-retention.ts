import type { UpdateQueryResponse } from '@forge/sql';
import { executeSql } from './client';

const snapshotLimit = 8;
const chunkLimit = 50;

// References from another project indicate inconsistent data. Preserve those snapshots too.
const abandonedInProject = `
  s.project_id = ?
  AND s.access_class = 'SYNTHETIC_DEMO'
  AND s.sealed_at IS NULL
  AND s.expires_at <= UTC_TIMESTAMP(3)
  AND EXISTS (SELECT 1 FROM ctx_project p WHERE p.id = s.project_id AND p.data_mode = 'DEMO')
  AND NOT EXISTS (SELECT 1 FROM ctx_scenario sc WHERE sc.snapshot_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM ctx_simulation_run r WHERE r.snapshot_id = s.id)
`;

/**
 * Reclaim a bounded set of chunks from expired, never-sealed demonstration snapshots.
 * Project scope comes from a server-authorized maintenance caller. Forge supplies installation scope.
 * Retain the parent tombstone so a retry with the same snapshot ID cannot publish it.
 */
export async function pruneAbandonedDemoSnapshotChunks(projectId: string, query: typeof executeSql = executeSql) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(projectId)) {
    throw new Error('Invalid snapshot retention project scope');
  }

  const candidates = await query<{ id: string }>(
    `SELECT s.id FROM ctx_data_snapshot s
     WHERE ${abandonedInProject}
       AND (s.state = 'BUILDING' OR (s.state = 'EXPIRED_BUILD' AND EXISTS (
         SELECT 1 FROM ctx_snapshot_chunk c WHERE c.snapshot_id = s.id
       )))
     ORDER BY s.expires_at, s.id LIMIT ${snapshotLimit}`,
    [projectId],
  );

  let snapshotsFenced = 0;
  let chunksDeleted = 0;
  for (const { id } of candidates) {
    // The publisher only transitions BUILDING to SEALED. Whichever update wins determines eligibility.
    const fenced = await query<UpdateQueryResponse>(
      `UPDATE ctx_data_snapshot AS s SET state = 'EXPIRED_BUILD'
       WHERE s.id = ? AND s.state = 'BUILDING' AND ${abandonedInProject}`,
      [id, projectId],
    );
    snapshotsFenced += fenced.affectedRows;

    const chunks = await query<{ chunk_index: number }>(
      `SELECT chunk_index FROM ctx_snapshot_chunk
       WHERE snapshot_id = ? ORDER BY chunk_index LIMIT ${chunkLimit}`,
      [id],
    );
    if (!chunks.length) {
      continue;
    }

    // Recheck the fence and each preservation guard in the same statement that deletes data.
    const deleted = await query<UpdateQueryResponse>(
      `DELETE FROM ctx_snapshot_chunk
       WHERE snapshot_id = ? AND chunk_index IN (${chunks.map(() => '?').join(', ')})
         AND EXISTS (
           SELECT 1 FROM ctx_data_snapshot s
           WHERE s.id = ? AND s.state = 'EXPIRED_BUILD' AND ${abandonedInProject}
         )`,
      [id, ...chunks.map((chunk) => chunk.chunk_index), id, projectId],
    );
    chunksDeleted += deleted.affectedRows;
  }

  return { snapshotsFenced, chunksDeleted };
}
