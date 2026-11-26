import type { OverviewResult } from './overview';

export const OPERATIONS_LIST = 'operations.list';
export const OPERATIONS_DETAIL = 'operations.detail';
export const OPERATIONS_PAGE_SIZE = 20;
export const operationsSections = [
  'work', 'operations', 'assets', 'contractors', 'logistics', 'hse', 'financial', 'knowledge',
] as const;
export type OperationsSection = typeof operationsSections[number];

export type OperationsFilter = 'phaseCode' | 'status' | 'facilityCode' | 'category' | 'contractorCode';
export type OperationsFilters = Partial<Record<OperationsFilter, string>> & {
  q?: string;
  overdueOnly?: boolean;
  from?: string;
  to?: string;
  page?: number;
};

export type OperationsSource = {
  source: 'JIRA' | 'FORGE' | 'ASSETS' | 'JSM' | 'CONFLUENCE';
  state: 'READY' | 'PARTIAL' | 'UNAVAILABLE' | 'DISABLED';
  quality: 'LIVE' | 'SYNTHETIC' | null;
  observedAt: string | null;
  detail: string;
};

export type OperationsField = { label: string; value: string | null };
export type OperationsLink =
  | { label: string; kind: 'jira'; issueKey: string }
  | { label: string; kind: 'record'; section: OperationsSection; code: string };
export type OperationsTarget = { section: OperationsSection; code: string };
export type OperationsRow = {
  code: string;
  cells: Array<string | null>;
  issueKey?: string;
};

export type OperationsPageContent = {
  columns: string[];
  rows: OperationsRow[];
  total: number;
  sources: OperationsSource[];
  facets?: Array<{ name: OperationsFilter; label: string; options: Array<{ value: string; label: string }> }>;
  highlights?: OperationsField[];
  notes?: string[];
};

export type OperationsPage = OperationsPageContent & {
  project: { name: string; key: string };
  asOf: string | null;
  page: number;
  pageSize: number;
};

export type OperationsDetail = {
  code: string;
  title: string;
  fields: OperationsField[];
  links: OperationsLink[];
  sources: OperationsSource[];
  groups?: Array<{ label: string; fields: OperationsField[] }>;
  notes?: string[];
};

export type OperationsResult<T> = OverviewResult<T>;
