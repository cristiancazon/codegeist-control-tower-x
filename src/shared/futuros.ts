import type { PairedComparison, StatisticsSummary } from '../domain/futuros/statistics';
import type { LogicalSchedule } from '../domain/futuros/types';

export const FUTUROS_SCENARIOS = 'futuros.listScenarios';
export const FUTUROS_START = 'futuros.startRun';
export const FUTUROS_RETRY = 'futuros.retryRun';
export const FUTUROS_RUN = 'futuros.getRun';
export const FUTUROS_CANCEL = 'futuros.cancelRun';
export const FUTUROS_COMPARE = 'futuros.compareRuns';
export const FUTUROS_GRANT = 'futuros.grantDemoPlanner';

export type FuturosStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
export type FuturosRunCard = {
  id: string;
  scenarioId: string;
  status: FuturosStatus;
  sampleCount: number;
  createdAt: string;
  seed: string;
};
export type FuturosRun = FuturosRunCard & {
  snapshotId: string;
  retryOfId: string | null;
  materializedCount: number;
  modelVersion: string;
  engineBuild: string;
  rngVersion: string;
  inputHash: string;
  resultHash: string | null;
  startedAt: string | null;
  deadlineAt: string;
  finishedAt: string | null;
  errorCode: string | null;
  snapshotAsOf: string | null;
  canCancel: boolean;
  canRetry: boolean;
  logical: LogicalSchedule | null;
  result: StatisticsSummary | null;
};
export type FuturosCatalog = {
  scenarios: Array<{ id: string; code: string; name: string; revision: number; snapshotId: string; asOf: string }>;
  runs: FuturosRunCard[];
  canStart: boolean;
  canConfigureDemoPlanner: boolean;
};
export type FuturosComparison = { baselineId: string; items: Array<{ runId: string; comparison: PairedComparison }> };
export type FuturosFailure =
  | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'INVALID_REQUEST' | 'INVALID_SCENARIO' | 'INSUFFICIENT_DATA'
  | 'RESOURCE_INFEASIBLE' | 'CONFLICT' | 'STALE_INPUT' | 'RUN_NOT_READY' | 'MODEL_UNAVAILABLE'
  | 'INCOMPATIBLE_RUNS' | 'SAMPLES_EXPIRED' | 'UNAVAILABLE';
export type FuturosResponse<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: FuturosFailure; message: string }; requestId: string };
