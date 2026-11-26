export const DEMO_PREVIEW = 'demo.preview';
export const DEMO_APPLY = 'demo.apply';

export type DemoProgress = {
  jiraProjectKey: string;
  fixtureName: string;
  fixtureHash: string;
  issuesTotal: number;
  issuesMapped: number;
  phases: number;
  assets: number;
  contractors: number;
  historicalPeriods: number;
  state: 'NOT_STARTED' | 'IMPORTING' | 'PUBLISHING' | 'COMPLETE' | 'REVIEW';
  mode?: 'ADOPT_EXISTING';
  firstIssueKey?: string;
};

export type DemoResponse =
  | { ok: true; data: DemoProgress }
  | { ok: false; error: { code: string; message: string; retryAfterSeconds?: number } };
