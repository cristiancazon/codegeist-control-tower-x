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

export function runFuturos(event: AsyncEvent<{ runId: string }>) {
  return futurosWorker.consume(event.body.runId);
}

export function recoverFuturos() {
  return futurosWorker.recover();
}
