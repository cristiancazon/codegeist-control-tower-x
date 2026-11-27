import type { Route } from '@forge/api';

export const BOOTSTRAP_PERMISSIONS = ['BROWSE_PROJECTS', 'ADMINISTER_PROJECTS', 'CREATE_ISSUES'] as const;
export type JiraPermission = typeof BOOTSTRAP_PERMISSIONS[number];

export type JiraBoundaryErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'SOURCE_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'RECONCILIATION_REQUIRED';

export class JiraBoundaryError extends Error {
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    readonly code: JiraBoundaryErrorCode,
    message: string,
    options: { status?: number; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'JiraBoundaryError';
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export type JiraRequest = (path: Route, options: {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  signal: AbortSignal;
  body?: string;
}) => Promise<{
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export type JiraIssueIdentity = { id: string; key: string };
export type JiraProjectIdentity = { id: string; key: string; name: string };

export type JiraWorkItem = JiraIssueIdentity & {
  projectId: string;
  issueTypeId: string;
  summary: string;
  status: { id: string; name: string; categoryKey: string | null };
  assigneeAccountId: string | null;
  dueDate: string | null;
  updatedAt: string;
  labels: string[];
};

export type JiraSearchOptions = { marker?: string; nextPageToken?: string; pageSize?: number };
export type JiraWorkItemPage = { items: JiraWorkItem[]; nextPageToken: string | null };

export type JiraTaskCreateMetadata = {
  issueTypeId: string;
  supportsDueDate: boolean;
  requiresDueDate: boolean;
};

export type JiraFixtureTaskInput = {
  issueTypeId: string;
  marker: string;
  summary: string;
  description: string;
  dueDate?: string;
};

export type JiraCorrectiveIssueInput = {
  issueTypeId: string;
  projectKey: string;
  marker: string;
  summary: string;
  description: string;
};
