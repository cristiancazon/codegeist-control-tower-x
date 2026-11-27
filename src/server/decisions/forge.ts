import { randomUUID } from 'node:crypto';
import { getAppContext } from '@forge/api';
import type { DecisionsResult } from '../../shared/decisions';
import { isConfiguredDemoProject, readDemoActor } from '../data/bootstrap/demo-access';
import { demoProjectKey, fixture } from '../data/bootstrap/fixture';
import { createForgeJiraProjectAdapter } from '../data/jira';
import { isDateOnly, isJiraId, isRecord } from '../data/jira/normalize';
import { enqueue } from '../data/migration-events';
import { executeSql } from '../data/sql/client';
import { DECISIONS_SCHEMA_VERSION, isSchemaReady } from '../data/sql/migrations';
import { getProjectAccess } from '../data/sql/projects';
import { authorizeDecisionEvidence, readDecisionRun } from '../futuros/resolvers';
import { confirmFuturosVisibility } from '../futuros/snapshot';
import { readVisibleJiraIssues } from '../overview/resolvers';
import { createDecisionResolvers, DecisionFailure } from './resolvers';
import { decisionStore } from './store';

const s2 = fixture.scenarios.find(({ code }) => code === 'S2')!;

function demoTarget(context: unknown) {
  const actor = readDemoActor(context);
  if (!actor) throw new DecisionFailure('AUTH_REQUIRED');
  const project = isRecord(context) && isRecord(context.extension) ? context.extension.project : undefined;
  const cloudId = process.env.CTX_DEMO_CLOUD_ID;
  const jiraProjectId = process.env.CTX_DEMO_JIRA_PROJECT_ID;
  const issueTypeId = process.env.CTX_DECISIONS_ISSUE_TYPE_ID;
  if (!isRecord(context) || !isRecord(project) || !isJiraId(project.id) || !cloudId ||
      context.installContext !== `ari:cloud:jira::site/${cloudId}` ||
      !isConfiguredDemoProject(getAppContext(), project.id, { cloudId, jiraProjectId }) || !isJiraId(issueTypeId)) {
    throw new DecisionFailure('DISABLED');
  }
  return { actor, jiraProjectId: project.id, issueTypeId };
}

async function ensureTables() {
  if (!await isSchemaReady(DECISIONS_SCHEMA_VERSION)) {
    await enqueue();
    throw new DecisionFailure('SCHEMA_PENDING');
  }
}

async function canActivateApprover(actor: string, jiraProjectId: string) {
  if (process.env.CTX_DEMO_APPROVER_ACCOUNT_ID !== actor) return false;
  const rows = await executeSql<{ role_code: string }>(
    `SELECT r.role_code FROM ctx_project_role r JOIN ctx_project p ON p.id = r.project_id
     WHERE p.id = ? AND p.jira_project_id = ? AND r.account_id = ? AND r.role_code IN ('APPROVER', 'PLANNER', 'ADMIN')`,
    [fixture.project.id, jiraProjectId, actor],
  );
  // A prior APPROVER grant (including revocation) or a planner/admin account closes self-enrollment.
  return rows.length === 0;
}

export async function activateDemoApprover(request: { payload?: unknown; context?: unknown }): Promise<DecisionsResult<{ granted: true }>> {
  const requestId = randomUUID();
  const { payload, context } = request;
  if (!isRecord(payload) || Reflect.ownKeys(payload).length !== 1 || payload.confirmed !== true) {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: 'Confirmá la activación en esta cuenta.', retryable: false }, requestId };
  }
  try {
    const { actor, jiraProjectId } = demoTarget(context);
    const jira = createForgeJiraProjectAdapter(context);
    await jira.assertBrowsePermission();
    await ensureTables();
    if (!await canActivateApprover(actor, jiraProjectId)) throw new DecisionFailure('FORBIDDEN');
    const coverage = await readVisibleJiraIssues(jira);
    if (coverage.state !== 'READY' || !coverage.issues || !await confirmFuturosVisibility(fixture.project.id, jiraProjectId, coverage.issues)) {
      throw new DecisionFailure('FORBIDDEN');
    }
    await executeSql(
      `INSERT INTO ctx_project_role (project_id, account_id, role_code, granted_by, granted_at)
       SELECT p.id, ?, roles.role_code, ?, UTC_TIMESTAMP(3)
       FROM ctx_project p CROSS JOIN (SELECT 'APPROVER' AS role_code UNION ALL SELECT 'VIEWER') roles
       WHERE p.id = ? AND p.jira_project_id = ? AND p.data_mode = 'DEMO' AND p.status = 'ACTIVE'
         AND NOT EXISTS (SELECT 1 FROM ctx_project_role r WHERE r.project_id = p.id AND r.account_id = ?
           AND r.role_code IN ('APPROVER', 'PLANNER', 'ADMIN'))
       ON DUPLICATE KEY UPDATE role_code = ctx_project_role.role_code`,
      [actor, actor, fixture.project.id, jiraProjectId, actor],
    );
    const access = await getProjectAccess(jiraProjectId, actor);
    if (access?.projectId !== fixture.project.id || !access.roles.includes('APPROVER')) throw new DecisionFailure('FORBIDDEN');
    return { ok: true, data: { granted: true }, requestId };
  } catch (error) {
    const code = error instanceof DecisionFailure ? error.code : 'UNAVAILABLE';
    console.info(JSON.stringify({ operation: 'decisions.activateDemoApprover', requestId, code }));
    return { ok: false, error: { code, message: 'No se pudo activar el rol de revisión en esta cuenta.',
      retryable: code === 'UNAVAILABLE' || code === 'SCHEMA_PENDING' }, requestId };
  }
}

export const decisionsResolvers = createDecisionResolvers({
  now: Date.now,
  store: decisionStore,
  async authorize(context) {
    const target = demoTarget(context);
    if (process.env.CTX_DEMO_APPROVER_ACCOUNT_ID === target.actor) {
      await createForgeJiraProjectAdapter(context).assertBrowsePermission();
      if (await canActivateApprover(target.actor, target.jiraProjectId)) throw new DecisionFailure('APPROVER_SETUP');
    }
    const scope = await authorizeDecisionEvidence(context);
    await ensureTables();
    return { ...scope, target: { projectKey: demoProjectKey, issueTypeId: target.issueTypeId } };
  },
  async evidence(scope, runId) {
    const run = await readDecisionRun(scope.projectId, runId);
    const days = run.result?.finishDay.percentiles.p80;
    const cost = run.result?.costCents.percentiles.p80;
    if (run.scenarioId !== s2.id || run.snapshotId !== fixture.snapshot.id || run.status !== 'SUCCEEDED' ||
        !run.resultHash || !isDateOnly(run.snapshotAsOf) || typeof days !== 'number' || !Number.isFinite(days) ||
        typeof cost !== 'string' || !/^\d{1,18}$/.test(cost)) {
      throw new DecisionFailure('STALE_INPUT');
    }
    const [anchor] = await executeSql<{ issue_id: string; expires_at: string }>(
      `SELECT w.jira_issue_id AS issue_id, CAST(s.expires_at AS CHAR) AS expires_at
       FROM ctx_work_package w INNER JOIN ctx_data_snapshot s ON s.project_id = w.project_id AND s.id = ?
       INNER JOIN ctx_source_mapping m ON m.project_id = w.project_id AND m.entity_id = w.id AND m.source_id = w.jira_issue_id
       WHERE w.project_id = ? AND w.code = 'WP-048' AND w.tombstoned_at IS NULL
         AND m.source_system = 'JIRA' AND m.source_scope = ? AND m.entity_kind = 'WORK_PACKAGE' AND m.tombstoned_at IS NULL
         AND s.state = 'SEALED' AND s.access_class = 'SYNTHETIC_DEMO' AND s.expires_at > UTC_TIMESTAMP(3) LIMIT 1`,
      [run.snapshotId, scope.projectId, scope.jiraProjectId],
    );
    if (!anchor || !isJiraId(anchor.issue_id)) throw new DecisionFailure('STALE_INPUT');
    const issue = await scope.jira.getWorkItem(anchor.issue_id);
    const expiresAt = new Date(`${anchor.expires_at.replace(' ', 'T')}Z`).toISOString();
    return { expiresAt, data: { runId, scenario: 'S2', snapshotId: run.snapshotId, asOf: run.snapshotAsOf,
      modelVersion: run.modelVersion, resultHash: run.resultHash, sourceIssueKey: issue.key,
      durationP80Days: days, costP80Cents: cost } };
  },
});
