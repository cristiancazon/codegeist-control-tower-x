export const DECISIONS_LIST = 'decisions.list';
export const DECISIONS_GET = 'decisions.get';
export const DECISIONS_PREPARE = 'decisions.prepare';
export const DECISIONS_PROPOSE = 'decisions.propose';
export const DECISIONS_APPROVE = 'decisions.approve';
export const DECISIONS_REJECT = 'decisions.reject';
export const DECISIONS_EXECUTE = 'decisions.execute';
export const DECISIONS_RECONCILE = 'decisions.reconcile';
export const DECISIONS_ACTIVATE_APPROVER = 'decisions.activateDemoApprover';

export type DecisionStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'EXECUTING' | 'APPLIED' | 'FAILED' |
  'RECONCILIATION_REQUIRED' | 'EXPIRED';

export type DecisionEvidence = {
  runId: string;
  scenario: 'S2';
  snapshotId: string;
  asOf: string;
  modelVersion: string;
  resultHash: string;
  sourceIssueKey: string;
  durationP80Days: number;
  costP80Cents: string;
};

export type DecisionDraft = {
  summary: string;
  description: string;
  evidence: DecisionEvidence;
  target: { projectKey: string; issueTypeId: string };
};

export type DecisionCard = {
  id: string;
  summary: string;
  status: DecisionStatus;
  proposedAt: string;
  isMine: boolean;
};

export type DecisionActivity = {
  id: string;
  event: 'proposed' | 'approved' | 'rejected' | 'execution_reserved' | 'execution_failed' |
    'reconciliation_required' | 'reconciled' | 'applied';
  at: string;
  actor: 'SELF' | 'PLANNER' | 'APPROVER' | 'SYSTEM';
};

export type Decision = DecisionDraft & DecisionCard & {
  revision: number;
  hash: string;
  reviewedAt: string | null;
  reviewReason: string | null;
  expiresAt: string | null;
  executionStartedAt: string | null;
  attemptCount: number;
  appliedAt: string | null;
  issueKey: string | null;
  errorCode: string | null;
  activity: DecisionActivity[];
  canReview: boolean;
  canExecute: boolean;
  canReconcile: boolean;
};

export type DecisionReference = { decisionId: string; expectedRevision: number; expectedHash: string; confirmed: true };
export type DecisionExecution = DecisionReference & { expectedAttempt: number };
export type DecisionReview = DecisionReference & { reason: string };
export type DecisionProposal = {
  runId: string; summary: string; description: string; idempotencyKey: string;
  expectedResultHash: string; expectedIssueTypeId: string; expectedProjectKey: string;
};

export type DecisionsResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: { code: string; message: string; retryable: boolean }; requestId: string };
