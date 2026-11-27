import { randomUUID } from 'node:crypto';
import type { UpdateQueryResponse } from '@forge/sql';
import { sha256 } from '../../domain/futuros/digest';
import { FUTUROS_BATCH_SIZE, FUTUROS_ENGINE_BUILD, FUTUROS_MODEL, FUTUROS_RNG } from '../../domain/futuros/types';
import { executeSql, type SqlParameter } from '../data/sql/client';

const leaseSeconds = 150;
const deadlineSeconds = 20 * 60;
const batchRetentionSeconds = 7 * 86_400;
const maxDispatchAttempts = 11;
const maxDispatchDelaySeconds = 120;
const sweepLimit = 20;
const batchReadSize = 8;
const maxBatchBytes = 128 * 1024;
const maxManifestBytes = 512 * 1024;

export type RunStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
export type RunRecord = {
  id: string;
  projectId: string;
  scenarioId: string;
  snapshotId: string;
  retryOfId: string | null;
  requestedBy: string;
  requestHash: string;
  seed: string;
  sampleCount: number;
  materializedCount: number;
  modelVersion: string;
  engineBuild: string;
  rngVersion: string;
  inputHash: string;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  deadlineAt: string;
  finishedAt: string | null;
  resultHash: string | null;
  resultManifestJcs: string | null;
  errorCode: string | null;
};

export type NewRun = Pick<RunRecord,
  'projectId' | 'scenarioId' | 'snapshotId' | 'requestedBy' | 'requestHash' | 'seed' | 'sampleCount' | 'inputHash'
> & { idempotencyKey: string; retryOfId?: string };
export type RunLease = { run: RunRecord; owner: string; fence: string };
export type RunBatch = { batchIndex: number; firstSample: number; sampleCount: number; hash: string; samplesJcs: string };
export type RunPrediction = { metricCode: string; subjectId: string; unitCode: string; summaryJcs: string; evidenceJcs: string };

export class RunStoreError extends Error {
  constructor(readonly code: 'CONFLICT' | 'STALE_INPUT' | 'MODEL_UNAVAILABLE' | 'INVALID_SCENARIO') {
    super(code);
    this.name = 'RunStoreError';
  }
}

type RunRow = {
  id: string; project_id: string; scenario_id: string; snapshot_id: string; retry_of_id: string | null;
  requested_by: string; request_hash: string; seed_hex: string; sample_count: number; materialized_count: number;
  model_version: string; engine_build: string; rng_version: string; input_hash: string; status: RunStatus;
  created_at: string; started_at: string | null; deadline_at: string; finished_at: string | null;
  result_hash: string | null; result_manifest_jcs: string | null; error_code: string | null; fence_text: string;
};

type BatchRow = { batch_index: number; first_sample: number; sample_count: number; batch_hash: string; samples_jcs: string };

const runColumns = `id, project_id, scenario_id, snapshot_id, retry_of_id, requested_by, request_hash, seed_hex,
  sample_count, materialized_count, model_version, engine_build, rng_version, input_hash, status,
  CAST(created_at AS CHAR) AS created_at, CAST(started_at AS CHAR) AS started_at,
  CAST(deadline_at AS CHAR) AS deadline_at, CAST(finished_at AS CHAR) AS finished_at,
  CASE WHEN status = 'SUCCEEDED' THEN result_hash END AS result_hash,
  CASE WHEN status = 'SUCCEEDED' THEN result_manifest_jcs END AS result_manifest_jcs,
  error_code, CAST(fence AS CHAR) AS fence_text`;

const activeLease = `id = ? AND project_id = ? AND lease_owner = ? AND fence = CAST(? AS UNSIGNED)
  AND status = 'RUNNING' AND lease_until > UTC_TIMESTAMP(3) AND deadline_at > UTC_TIMESTAMP(3)`;

function utc(value: string): string {
  return new Date(value.replace(' ', 'T') + (value.includes('Z') || /[+-]\d\d:\d\d$/.test(value) ? '' : 'Z')).toISOString();
}

function asRun(row: RunRow): RunRecord {
  return {
    id: row.id, projectId: row.project_id, scenarioId: row.scenario_id, snapshotId: row.snapshot_id,
    retryOfId: row.retry_of_id, requestedBy: row.requested_by, requestHash: row.request_hash, seed: row.seed_hex,
    sampleCount: row.sample_count, materializedCount: row.materialized_count, modelVersion: row.model_version,
    engineBuild: row.engine_build, rngVersion: row.rng_version, inputHash: row.input_hash, status: row.status,
    createdAt: utc(row.created_at), startedAt: row.started_at === null ? null : utc(row.started_at),
    deadlineAt: utc(row.deadline_at), finishedAt: row.finished_at === null ? null : utc(row.finished_at),
    resultHash: row.result_hash, resultManifestJcs: row.result_manifest_jcs, errorCode: row.error_code,
  };
}

function leaseParameters({ run, owner, fence }: RunLease): SqlParameter[] {
  return [run.id, run.projectId, owner, fence];
}

export function createRunStore(query: typeof executeSql = executeSql) {
  async function updateOne(statement: string, parameters: readonly SqlParameter[]): Promise<boolean> {
    const result = await query<UpdateQueryResponse>(statement, parameters);
    if (result.affectedRows !== 0 && result.affectedRows !== 1) {
      throw new RunStoreError('MODEL_UNAVAILABLE');
    }
    return result.affectedRows === 1;
  }

  async function getRun(projectId: string, runId: string): Promise<RunRecord | undefined> {
    const [row] = await query<RunRow>(`SELECT ${runColumns} FROM ctx_simulation_run WHERE id = ? AND project_id = ?`, [runId, projectId]);
    return row ? asRun(row) : undefined;
  }

  async function startRun(input: NewRun): Promise<{ run: RunRecord; created: boolean }> {
    if (!Number.isSafeInteger(input.sampleCount) || input.sampleCount < 1 || input.sampleCount > 10_000 ||
        !/^[0-9a-f]{32}$/.test(input.seed) || !/^[0-9a-f]{64}$/.test(input.inputHash) ||
        !/^[0-9a-f]{64}$/.test(input.requestHash) || input.idempotencyKey.length < 1 || input.idempotencyKey.length > 80) {
      throw new RunStoreError('INVALID_SCENARIO');
    }

    const id = randomUUID();
    const { projectId, scenarioId, snapshotId, requestedBy, requestHash, idempotencyKey } = input;
    const retryOfId = input.retryOfId ?? null;
    await query<UpdateQueryResponse>(
      `INSERT INTO ctx_simulation_run
       (id, project_id, scenario_id, snapshot_id, retry_of_id, requested_by, idempotency_key, request_hash,
        status, seed_hex, sample_count, model_version, engine_build, rng_version, input_hash,
        created_at, deadline_at, next_dispatch_at)
       SELECT ?, s.project_id, s.id, snap.id, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?, ?,
              UTC_TIMESTAMP(3), TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)), UTC_TIMESTAMP(3)
       FROM ctx_scenario s
       INNER JOIN ctx_project p ON p.id = s.project_id AND p.status = 'ACTIVE' AND p.data_mode = 'DEMO'
       INNER JOIN ctx_data_snapshot snap ON snap.id = s.snapshot_id AND snap.project_id = s.project_id
         AND snap.state = 'SEALED' AND snap.access_class = 'SYNTHETIC_DEMO' AND snap.expires_at > UTC_TIMESTAMP(3)
       WHERE s.project_id = ? AND s.id = ? AND snap.id = ? AND s.state = 'PUBLISHED'
         AND (? IS NULL OR EXISTS (SELECT 1 FROM ctx_simulation_run previous
           WHERE previous.id = ? AND previous.project_id = ? AND previous.requested_by = ?
             AND previous.status IN ('FAILED', 'CANCELED')
             AND previous.scenario_id = ? AND previous.snapshot_id = ?))
       ON DUPLICATE KEY UPDATE id = ctx_simulation_run.id`,
      [id, retryOfId, requestedBy, idempotencyKey, requestHash, input.seed, input.sampleCount,
        FUTUROS_MODEL, FUTUROS_ENGINE_BUILD, FUTUROS_RNG, input.inputHash, deadlineSeconds,
        projectId, scenarioId, snapshotId, retryOfId, retryOfId, projectId, requestedBy, scenarioId, snapshotId],
    );

    const [row] = await query<RunRow>(
      `SELECT ${runColumns} FROM ctx_simulation_run WHERE project_id = ? AND requested_by = ? AND idempotency_key = ?`,
      [projectId, requestedBy, idempotencyKey],
    );
    if (!row) throw new RunStoreError('STALE_INPUT');
    if (row.request_hash !== requestHash) throw new RunStoreError('CONFLICT');
    return { run: asRun(row), created: row.id === id };
  }

  async function cancelRun(projectId: string, runId: string, actor: string): Promise<RunRecord | undefined> {
    await updateOne(
      `UPDATE ctx_simulation_run SET status = 'CANCELED', fence = fence + 1, finished_at = UTC_TIMESTAMP(3),
              lease_owner = NULL, lease_until = NULL, next_dispatch_at = NULL
       WHERE id = ? AND project_id = ? AND requested_by = ? AND status IN ('QUEUED', 'RUNNING')`,
      [runId, projectId, actor],
    );
    const run = await getRun(projectId, runId);
    return run?.requestedBy === actor ? run : undefined;
  }

  async function reserveDispatch(runId: string, delaySeconds = 0): Promise<boolean> {
    if (!Number.isSafeInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > maxDispatchDelaySeconds) {
      throw new RunStoreError('MODEL_UNAVAILABLE');
    }
    return updateOne(
      `UPDATE ctx_simulation_run SET dispatch_count = dispatch_count + 1,
              next_dispatch_at = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))
       WHERE id = ? AND status IN ('QUEUED', 'RUNNING') AND dispatch_count < ? AND deadline_at > UTC_TIMESTAMP(3)
         AND (next_dispatch_at IS NULL OR next_dispatch_at <= UTC_TIMESTAMP(3))
         AND (lease_until IS NULL OR lease_until <= UTC_TIMESTAMP(3))`,
      [30 + delaySeconds, runId, maxDispatchAttempts],
    );
  }

  async function recoverableRuns(): Promise<string[]> {
    const rows = await query<{ id: string }>(
      `SELECT id FROM ctx_simulation_run WHERE status IN ('QUEUED', 'RUNNING') AND dispatch_count < ?
         AND deadline_at > UTC_TIMESTAMP(3) AND (lease_until IS NULL OR lease_until <= UTC_TIMESTAMP(3))
         AND (next_dispatch_at IS NULL OR next_dispatch_at <= UTC_TIMESTAMP(3))
       ORDER BY next_dispatch_at, id LIMIT ${sweepLimit}`,
      [maxDispatchAttempts],
    );
    return rows.map(({ id }) => id);
  }

  async function expireRun(projectId: string, runId: string, actor: string): Promise<boolean> {
    return updateOne(
      `UPDATE ctx_simulation_run SET status = 'FAILED', error_code = 'RUN_TIMEOUT', fence = fence + 1,
              lease_owner = NULL, lease_until = NULL, next_dispatch_at = NULL, finished_at = UTC_TIMESTAMP(3)
       WHERE id = ? AND project_id = ? AND requested_by = ?
         AND status IN ('QUEUED', 'RUNNING') AND deadline_at <= UTC_TIMESTAMP(3)`,
      [runId, projectId, actor],
    );
  }

  async function expireRuns(): Promise<void> {
    const rows = await query<{ id: string; project_id: string; requested_by: string }>(
      `SELECT id, project_id, requested_by FROM ctx_simulation_run
       WHERE status IN ('QUEUED', 'RUNNING') AND deadline_at <= UTC_TIMESTAMP(3)
       ORDER BY deadline_at, id LIMIT ${sweepLimit}`, [],
    );
    for (const row of rows) {
      await expireRun(row.project_id, row.id, row.requested_by);
    }
  }

  async function purgeStagedData(): Promise<void> {
    const expired = await query<{ run_id: string; batch_index: number }>(
      `SELECT run_id, batch_index FROM ctx_run_batch WHERE expires_at <= UTC_TIMESTAMP(3)
       ORDER BY expires_at, run_id, batch_index LIMIT ${sweepLimit}`, [],
    );
    for (const row of expired) {
      await updateOne(
        'DELETE FROM ctx_run_batch WHERE run_id = ? AND batch_index = ? AND expires_at <= UTC_TIMESTAMP(3)',
        [row.run_id, row.batch_index],
      );
    }

    const obsolete = await query<{ run_id: string; generation: string; metric_code: string; subject_id: string }>(
      `SELECT p.run_id, CAST(p.result_generation AS CHAR) AS generation, p.metric_code, p.subject_id
       FROM ctx_prediction p
       INNER JOIN ctx_simulation_run r ON r.id = p.run_id AND r.project_id = p.project_id
       WHERE r.status IN ('FAILED', 'CANCELED')
          OR (r.status = 'SUCCEEDED' AND p.result_generation <> r.result_generation)
       ORDER BY p.run_id, p.result_generation, p.metric_code, p.subject_id LIMIT ${sweepLimit}`, [],
    );
    // Terminal states are immutable. A superseded generation cannot become visible during cleanup.
    for (const row of obsolete) {
      await updateOne(
        `DELETE FROM ctx_prediction WHERE run_id = ? AND result_generation = CAST(? AS UNSIGNED)
           AND metric_code = ? AND subject_id = ?`,
        [row.run_id, row.generation, row.metric_code, row.subject_id],
      );
    }
  }

  async function claimRun(runId: string): Promise<RunLease | undefined> {
    const owner = randomUUID();
    const claimed = await updateOne(
      `UPDATE ctx_simulation_run SET status = 'RUNNING', started_at = COALESCE(started_at, UTC_TIMESTAMP(3)),
              fence = fence + 1, lease_owner = ?, lease_until = TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))
       WHERE id = ? AND status IN ('QUEUED', 'RUNNING') AND deadline_at > UTC_TIMESTAMP(3)
         AND (lease_until IS NULL OR lease_until <= UTC_TIMESTAMP(3))`,
      [owner, leaseSeconds, runId],
    );
    if (!claimed) return undefined;
    const [row] = await query<RunRow>(
      `SELECT ${runColumns} FROM ctx_simulation_run WHERE id = ? AND lease_owner = ? AND status = 'RUNNING'`, [runId, owner],
    );
    return row ? { run: asRun(row), owner, fence: row.fence_text } : undefined;
  }

  async function hasLease(lease: RunLease): Promise<boolean> {
    const rows = await query<{ id: string }>(`SELECT id FROM ctx_simulation_run WHERE ${activeLease}`, leaseParameters(lease));
    return rows[0]?.id === lease.run.id;
  }

  async function releaseRun(lease: RunLease): Promise<boolean> {
    return updateOne(
      `UPDATE ctx_simulation_run SET lease_owner = NULL, lease_until = NULL, next_dispatch_at = UTC_TIMESTAMP(3)
       WHERE ${activeLease}`, leaseParameters(lease),
    );
  }

  async function failRun(lease: RunLease, errorCode: string): Promise<boolean> {
    return updateOne(
      `UPDATE ctx_simulation_run SET status = 'FAILED', error_code = ?, fence = fence + 1,
              lease_owner = NULL, lease_until = NULL, next_dispatch_at = NULL, finished_at = UTC_TIMESTAMP(3)
       WHERE ${activeLease}`, [errorCode, ...leaseParameters(lease)],
    );
  }

  async function batchIndexes(runId: string): Promise<number[]> {
    const rows = await query<{ batch_index: number }>(
      `SELECT batch_index FROM ctx_run_batch WHERE run_id = ? AND expires_at > UTC_TIMESTAMP(3) ORDER BY batch_index LIMIT 101`, [runId],
    );
    return rows.map(({ batch_index }) => batch_index);
  }

  async function saveBatch(lease: RunLease, batch: RunBatch): Promise<boolean> {
    const expectedCount = Math.min(FUTUROS_BATCH_SIZE, lease.run.sampleCount - batch.firstSample);
    if (!Number.isSafeInteger(batch.batchIndex) || batch.batchIndex < 0 || batch.firstSample !== batch.batchIndex * FUTUROS_BATCH_SIZE ||
        batch.sampleCount < 1 || batch.sampleCount !== expectedCount || Buffer.byteLength(batch.samplesJcs, 'utf8') > maxBatchBytes ||
        sha256(batch.samplesJcs) !== batch.hash) {
      throw new RunStoreError('MODEL_UNAVAILABLE');
    }

    await query<UpdateQueryResponse>(
      `INSERT INTO ctx_run_batch (run_id, batch_index, first_sample, sample_count, batch_hash, samples_jcs, created_at, expires_at)
       SELECT id, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))
       FROM ctx_simulation_run WHERE ${activeLease}
       ON DUPLICATE KEY UPDATE run_id = ctx_run_batch.run_id`,
      [batch.batchIndex, batch.firstSample, batch.sampleCount, batch.hash, batch.samplesJcs, batchRetentionSeconds, ...leaseParameters(lease)],
    );
    if (!await hasLease(lease)) return false;
    const [saved] = await query<Pick<BatchRow, 'batch_hash' | 'first_sample' | 'sample_count'>>(
      'SELECT batch_hash, first_sample, sample_count FROM ctx_run_batch WHERE run_id = ? AND batch_index = ?',
      [lease.run.id, batch.batchIndex],
    );
    if (!saved || saved.batch_hash !== batch.hash || saved.first_sample !== batch.firstSample || saved.sample_count !== batch.sampleCount) {
      throw new RunStoreError('MODEL_UNAVAILABLE');
    }

    const counted = await updateOne(
      `UPDATE ctx_simulation_run SET materialized_count = (SELECT COALESCE(SUM(b.sample_count), 0)
         FROM ctx_run_batch b WHERE b.run_id = ? AND b.expires_at > UTC_TIMESTAMP(3))
       WHERE ${activeLease}`, [lease.run.id, ...leaseParameters(lease)],
    );
    return counted || hasLease(lease);
  }

  async function listBatches(runId: string): Promise<RunBatch[]> {
    let after = -1;
    const batches: RunBatch[] = [];
    while (batches.length <= Math.ceil(10_000 / FUTUROS_BATCH_SIZE)) {
      const rows = await query<BatchRow>(
        `SELECT batch_index, first_sample, sample_count, batch_hash, samples_jcs FROM ctx_run_batch
         WHERE run_id = ? AND batch_index > ? AND expires_at > UTC_TIMESTAMP(3) ORDER BY batch_index LIMIT ${batchReadSize}`,
        [runId, after],
      );
      for (const row of rows) {
        batches.push({ batchIndex: row.batch_index, firstSample: row.first_sample, sampleCount: row.sample_count,
          hash: row.batch_hash, samplesJcs: row.samples_jcs });
        after = row.batch_index;
      }
      if (rows.length < batchReadSize) return batches;
    }
    throw new RunStoreError('MODEL_UNAVAILABLE');
  }

  async function savePredictions(lease: RunLease, predictions: readonly RunPrediction[], horizonDays: number): Promise<boolean> {
    for (const metric of predictions) {
      await query<UpdateQueryResponse>(
        `INSERT INTO ctx_prediction (run_id, result_generation, metric_code, subject_id, project_id, unit_code,
                sample_count, horizon_days, summary_jcs, evidence_jcs)
         SELECT id, fence, ?, ?, project_id, ?, sample_count, ?, ?, ? FROM ctx_simulation_run WHERE ${activeLease}
         ON DUPLICATE KEY UPDATE run_id = ctx_prediction.run_id`,
        [metric.metricCode, metric.subjectId, metric.unitCode, horizonDays, metric.summaryJcs, metric.evidenceJcs, ...leaseParameters(lease)],
      );
    }
    if (!await hasLease(lease)) return false;
    const rows = await query<{
      metric_code: string; subject_id: string; unit_code: string; summary_jcs: string; evidence_jcs: string;
    }>(
      `SELECT metric_code, subject_id, unit_code, summary_jcs, evidence_jcs FROM ctx_prediction
       WHERE run_id = ? AND project_id = ? AND result_generation = CAST(? AS UNSIGNED)`,
      [lease.run.id, lease.run.projectId, lease.fence],
    );
    const recorded = new Map(rows.map((entry) => [`${entry.metric_code}/${entry.subject_id}`, entry]));
    if (rows.length !== predictions.length || predictions.some((entry) => {
      const saved = recorded.get(`${entry.metricCode}/${entry.subjectId}`);
      return !saved || saved.unit_code !== entry.unitCode || saved.summary_jcs !== entry.summaryJcs || saved.evidence_jcs !== entry.evidenceJcs;
    })) {
      throw new RunStoreError('MODEL_UNAVAILABLE');
    }
    return true;
  }

  async function publishRun(lease: RunLease, resultHash: string, manifestJcs: string): Promise<boolean> {
    if (Buffer.byteLength(manifestJcs, 'utf8') > maxManifestBytes || sha256(manifestJcs) !== resultHash) {
      throw new RunStoreError('MODEL_UNAVAILABLE');
    }
    return updateOne(
      `UPDATE ctx_simulation_run SET status = 'SUCCEEDED', result_generation = fence, result_hash = ?,
              result_manifest_jcs = ?, materialized_count = sample_count, finished_at = UTC_TIMESTAMP(3),
              lease_owner = NULL, lease_until = NULL, next_dispatch_at = NULL
       WHERE ${activeLease} AND sample_count = (SELECT COALESCE(SUM(b.sample_count), 0)
         FROM ctx_run_batch b WHERE b.run_id = ? AND b.expires_at > UTC_TIMESTAMP(3))`,
      [resultHash, manifestJcs, ...leaseParameters(lease), lease.run.id],
    );
  }

  return { startRun, getRun, cancelRun, reserveDispatch, recoverableRuns, expireRun, expireRuns, purgeStagedData, claimRun, hasLease,
    releaseRun, failRun, batchIndexes, saveBatch, listBatches, savePredictions, publishRun };
}

export type FuturosRunStore = ReturnType<typeof createRunStore>;
