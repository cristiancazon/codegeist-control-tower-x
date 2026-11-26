export const OVERVIEW_GET = 'overview.get';
export const OVERVIEW_ALERT = 'overview.alert';

export type OverviewFilters = { phaseCode?: string; asOf?: string };
export type SourceState = 'READY' | 'PARTIAL' | 'UNAVAILABLE';
export type SourceName = 'JIRA' | 'FORGE';

export type OverviewSource = {
  source: SourceName;
  state: SourceState;
  observedAt: string | null;
  detail: string;
};

export type OverviewEvidence = { label: string; value: string; issueKey?: string };
export type OverviewMetric = {
  id: 'progress' | 'overdue' | 'milestones' | 'logistics' | 'assets' | 'cost';
  title: string;
  unit: 'percent' | 'count' | 'cents';
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  coverage: number | null;
  source: SourceName;
  detail: string;
  evidence: OverviewEvidence[];
};

export type OverviewAlert = {
  code: 'A-17';
  title: string;
  severity: 'HIGH';
  baselineEta: string;
  currentEta: string;
  delayDays: number;
};

export type Overview = {
  project: { name: string; key: string; currency: string; jiraProjectId?: string };
  asOf: string | null;
  snapshot: { asOf: string; collectedAt: string } | null;
  phases: Array<{ code: string; name: string }>;
  sources: OverviewSource[];
  metrics: OverviewMetric[];
  alerts: OverviewAlert[];
  map: Array<{ code: string; name: string; x: number; y: number; status: string }>;
};

export type OverviewAlertDetail = OverviewAlert & {
  asset: { code: string; name: string; status: string; nextAvailableDate: string | null } | null;
  contractor: { code: string; name: string } | null;
  work: Array<{ code: string; title: string; issueKey: string }>;
  simulationInput: {
    scenarioCode: 'S1';
    variable: 'SUPPLY_DELAY_DAYS';
    value: number;
    snapshotId: string;
    snapshotAsOf: string;
  } | null;
};

export type OverviewErrorCode = 'INVALID_FILTER' | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'NOT_READY' | 'UNAVAILABLE';
export type OverviewResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: OverviewErrorCode; message: string }; requestId: string };
