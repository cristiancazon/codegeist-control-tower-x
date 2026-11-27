import { getAppContext } from '@forge/api';
import type { AsyncEvent } from '@forge/events';
import { createRunStore, type RunRecord } from './run-store';
import { loadFuturosSnapshot } from './snapshot';
import { createFuturosWorker } from './worker';

export const futurosRunStore = createRunStore();
export const loadFuturosRunInput = (run: RunRecord) => loadFuturosSnapshot({
  projectId: run.projectId, scenarioId: run.scenarioId, snapshotId: run.snapshotId,
  seed: run.seed, sampleCount: run.sampleCount,
});
export const futurosWorker = createFuturosWorker({ store: futurosRunStore, loadInput: loadFuturosRunInput });

export function isStagingFuturosBenchmark() {
  try {
    return process.env.CTX_STAGING_ADOPT_FIXTURE === 'true' && getAppContext().environmentType === 'STAGING';
  } catch {
    return false;
  }
}

export function runFuturos(event: AsyncEvent<{ runId: string }>) {
  if (isStagingFuturosBenchmark()) {
    return futurosWorker.consume(event.body.runId, (timing) => {
      console.info(JSON.stringify({ operation: 'futuros.workerTiming', ...timing }));
    });
  }
  return futurosWorker.consume(event.body.runId);
}

export function recoverFuturos() {
  return futurosWorker.recover();
}
