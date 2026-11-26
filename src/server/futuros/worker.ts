import { Queue } from '@forge/events';
import { performance } from 'node:perf_hooks';
import { canonicalJson, inputDigest, sha256 } from '../../domain/futuros/digest';
import { prepareEngine } from '../../domain/futuros/engine';
import { summarizeSamples, type StatisticsSummary } from '../../domain/futuros/statistics';
import {
  FUTUROS_BATCH_SIZE, FUTUROS_ENGINE_BUILD, FUTUROS_MODEL, FUTUROS_RNG,
  type EngineInput, type LogicalSchedule, type Sample,
} from '../../domain/futuros/types';
import { createRunStore, RunStoreError, type FuturosRunStore, type RunBatch, type RunLease, type RunPrediction, type RunRecord } from './run-store';

export const FUTUROS_QUEUE_KEY = 'ctx-futuros';
const defaultBudgetMs = 90_000;
const transientDelaySeconds = 15;
const queue = new Queue<{ runId: string }>({ key: FUTUROS_QUEUE_KEY });
const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const terminalErrors = new Set(['INVALID_SCENARIO', 'INSUFFICIENT_DATA', 'RESOURCE_INFEASIBLE', 'MODEL_UNAVAILABLE', 'STALE_INPUT']);

type StoredSample = [number | null, number | null, Array<number | null>, number, number | null, number | null, number[]];
type StoredBody = { version: 1; rows: StoredSample[]; criticalCounts: number[] };
type BatchSummary = { samples: Sample[]; criticalCounts: number[] };

export type FuturosResultManifest = { snapshotAsOf: string; logical: LogicalSchedule; summary: StatisticsSummary };

export type FuturosWorkerOptions = {
  loadInput(run: RunRecord): Promise<EngineInput>;
  store?: FuturosRunStore;
  push?: (runId: string, delaySeconds: number) => Promise<unknown>;
  monotonicClock?: () => number;
  invocationBudgetMs?: number;
};

function modelFailure(): never {
  throw new RunStoreError('MODEL_UNAVAILABLE');
}

function encodeBatch(batchIndex: number, samples: Sample[], taskCount: number): RunBatch {
  const criticalCounts = Array<number>(taskCount).fill(0);
  const rows: StoredSample[] = [];
  const firstSample = batchIndex * FUTUROS_BATCH_SIZE;
  for (const [offset, sample] of samples.entries()) {
    if (sample.index !== firstSample + offset) modelFailure();
    let previous = -1;
    for (const index of sample.critical) {
      const count = criticalCounts[index];
      if (!Number.isInteger(index) || index <= previous || count === undefined) modelFailure();
      criticalCounts[index] = count + 1;
      previous = index;
    }
    rows.push([sample.finishDay, sample.costCents, sample.milestoneDays, sample.waits, sample.utilization, sample.productivity, sample.factors]);
  }
  const payload: StoredBody = { version: 1, rows, criticalCounts };
  const samplesJcs = canonicalJson(payload);
  return { batchIndex, firstSample, sampleCount: samples.length, samplesJcs, hash: sha256(samplesJcs) };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function decodeSample(row: unknown, index: number): Sample {
  if (!Array.isArray(row) || row.length !== 7) modelFailure();
  const [finishDay, costCents, milestoneDays, waits, utilization, productivity, factors]: unknown[] = row;
  if (!nullableNumber(finishDay) || !nullableNumber(costCents) || (costCents !== null && !Number.isSafeInteger(costCents)) ||
      !Array.isArray(milestoneDays) || milestoneDays.length > 5 || !milestoneDays.every(nullableNumber) || !isFiniteNumber(waits) ||
      !nullableNumber(utilization) || !nullableNumber(productivity) || !Array.isArray(factors) || factors.length > 10 || !factors.every(isFiniteNumber)) {
    modelFailure();
  }
  return { index, finishDay, costCents, milestoneDays, waits, utilization, productivity, factors, critical: [] };
}

function decodeBatches(run: RunRecord, batches: RunBatch[], taskCount?: number): BatchSummary | undefined {
  const expectedBatches = Math.ceil(run.sampleCount / FUTUROS_BATCH_SIZE);
  if (batches.length < expectedBatches) return undefined;
  if (batches.length !== expectedBatches) modelFailure();

  const samples: Sample[] = [];
  let criticalCounts: number[] | undefined;
  for (const [index, batch] of batches.entries()) {
    const expectedCount = Math.min(FUTUROS_BATCH_SIZE, run.sampleCount - samples.length);
    if (batch.batchIndex !== index || batch.firstSample !== samples.length || batch.sampleCount !== expectedCount ||
        sha256(batch.samplesJcs) !== batch.hash) modelFailure();

    let body: unknown;
    try {
      body = JSON.parse(batch.samplesJcs);
    } catch {
      modelFailure();
    }
    if (typeof body !== 'object' || body === null || !('version' in body) || body.version !== 1 ||
        !('rows' in body) || !Array.isArray(body.rows) || body.rows.length !== batch.sampleCount ||
        !('criticalCounts' in body) || !Array.isArray(body.criticalCounts) || body.criticalCounts.length > 250 ||
        (taskCount !== undefined && body.criticalCounts.length !== taskCount) ||
        !body.criticalCounts.every((count: unknown) => isFiniteNumber(count) && Number.isInteger(count) && count >= 0 && count <= batch.sampleCount)) {
      modelFailure();
    }
    const counts: number[] = body.criticalCounts;
    criticalCounts ??= Array<number>(counts.length).fill(0);
    if (counts.length !== criticalCounts.length) modelFailure();
    criticalCounts = criticalCounts.map((count, taskIndex) => count + counts[taskIndex]!);
    for (const row of body.rows) samples.push(decodeSample(row, samples.length));
  }

  return { samples, criticalCounts: criticalCounts ?? [] };
}

/** Retained pairable samples are for an authorized server comparison, never a public response. */
export async function readRunSamples(run: RunRecord, store: FuturosRunStore = createRunStore()): Promise<Sample[] | undefined> {
  if (run.status !== 'SUCCEEDED') return undefined;
  return decodeBatches(run, await store.listBatches(run.id))?.samples;
}

function predictionsFor(run: RunRecord, summary: StatisticsSummary): RunPrediction[] {
  const evidenceJcs = canonicalJson({ snapshotId: run.snapshotId, scenarioId: run.scenarioId, inputHash: run.inputHash });
  const prediction = (metricCode: string, subjectId: string, unitCode: string, data: unknown): RunPrediction => ({
    metricCode, subjectId, unitCode, summaryJcs: canonicalJson(data), evidenceJcs,
  });
  return [
    prediction('FINISH_DAY', run.projectId, 'DAY', summary.finishDay),
    prediction('COST_CENTS', run.projectId, 'USD_CENT', summary.costCents),
    prediction('WAIT_DAYS', run.projectId, 'DAY', summary.waitDays),
    prediction('UTILIZATION', run.projectId, 'RATIO', summary.utilization),
    prediction('PRODUCTIVITY', run.projectId, 'RATIO', summary.productivity),
    prediction('DEADLINE_SUCCESS', run.projectId, 'RATIO', summary.success.deadline),
    prediction('BUDGET_SUCCESS', run.projectId, 'RATIO', summary.success.budget),
    prediction('JOINT_SUCCESS', run.projectId, 'RATIO', summary.success.joint),
    ...summary.milestones.map(({ taskId, ...distribution }) => prediction('MILESTONE_DAY', taskId, 'DAY', distribution)),
  ];
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return undefined;
  if (error.code === 'INVALID_SAMPLES') return 'MODEL_UNAVAILABLE';
  if (error.code === 'FORBIDDEN') return 'STALE_INPUT';
  return terminalErrors.has(error.code) ? error.code : undefined;
}

function enqueueRun(runId: string, delaySeconds: number) {
  return queue.push({
    body: { runId },
    concurrency: { key: FUTUROS_QUEUE_KEY, limit: 2 },
    ...(delaySeconds > 0 ? { delayInSeconds: delaySeconds } : {}),
  });
}

export function createFuturosWorker({ loadInput, store = createRunStore(), push = enqueueRun,
  monotonicClock = () => performance.now(), invocationBudgetMs = defaultBudgetMs }: FuturosWorkerOptions) {
  async function dispatch(runId: string, delaySeconds = 0): Promise<boolean> {
    if (!runIdPattern.test(runId) || !await store.reserveDispatch(runId, delaySeconds)) return false;
    try {
      await push(runId, delaySeconds);
      return true;
    } catch {
      // The journal's next-dispatch time survives a disconnected queue operation.
      return false;
    }
  }

  async function consume(runId: string): Promise<void> {
    if (!runIdPattern.test(runId)) return;
    const deadline = monotonicClock() + invocationBudgetMs;
    const lease = await store.claimRun(runId);
    if (!lease) return;
    const { run } = lease;

    async function continueLater(current: RunLease, delaySeconds: number) {
      if (await store.releaseRun(current)) await dispatch(runId, delaySeconds);
    }

    try {
      const input = await loadInput(run);
      if (input.snapshotId !== run.snapshotId || input.scenarioId !== run.scenarioId || input.seed !== run.seed ||
          input.sampleCount !== run.sampleCount || inputDigest(input) !== run.inputHash) {
        throw new RunStoreError('STALE_INPUT');
      }
      if (run.modelVersion !== FUTUROS_MODEL || run.engineBuild !== FUTUROS_ENGINE_BUILD || run.rngVersion !== FUTUROS_RNG) modelFailure();

      const prepared = prepareEngine(input);
      const count = Math.ceil(run.sampleCount / FUTUROS_BATCH_SIZE);
      const existing = new Set(await store.batchIndexes(runId));
      for (let index = 0; index < count; index += 1) {
        if (existing.has(index)) continue;
        if (monotonicClock() >= deadline) return await continueLater(lease, 0);
        if (!await store.hasLease(lease)) return;

        const first = index * FUTUROS_BATCH_SIZE;
        const end = Math.min(first + FUTUROS_BATCH_SIZE, run.sampleCount);
        const values: Sample[] = [];
        for (let i = first; i < end; i += 1) values.push(prepared.sample(i));
        if (!await store.saveBatch(lease, encodeBatch(index, values, prepared.logical.tasks.length))) return;
      }
      if (monotonicClock() >= deadline) return await continueLater(lease, 0);
      const data = decodeBatches(run, await store.listBatches(runId), prepared.logical.tasks.length);
      if (!data) modelFailure();
      const summary = summarizeSamples(input, data.samples, {
        factorNames: prepared.factorNames, milestoneIds: prepared.milestoneIds, logical: prepared.logical,
        criticalCounts: data.criticalCounts,
      });
      const manifest: FuturosResultManifest = { snapshotAsOf: input.asOf, logical: prepared.logical, summary };
      const json = canonicalJson(manifest);
      if (await store.savePredictions(lease, predictionsFor(run, summary), input.horizon)) {
        await store.publishRun(lease, sha256(json), json);
      }
    } catch (error) {
      const code = errorCode(error);
      if (code) await store.failRun(lease, code);
      else await continueLater(lease, transientDelaySeconds);
    }
  }

  async function recover(): Promise<number> {
    await store.expireRuns();
    let dispatched = 0;
    for (const id of await store.recoverableRuns()) {
      if (await dispatch(id)) dispatched += 1;
    }
    await store.purgeStagedData();
    return dispatched;
  }

  return { dispatch, consume, recover };
}
