import { executeSql } from './client';

const projectRoles = ['VIEWER', 'PLANNER', 'APPROVER', 'ADMIN', 'HSE_READER'] as const;
export type ProjectRole = typeof projectRoles[number];

export type ProjectAccess = {
  projectId: string;
  roles: readonly ProjectRole[];
};

type RoleRow = { project_id: string; role_code: string };

const isProjectRole = (role: string): role is ProjectRole =>
  projectRoles.some((allowed) => allowed === role);

// Pass selectors from the verified Forge context after checking Jira Browse Projects.
// The SQL service selects the installation database using that invocation context.
export async function getProjectAccess(
  jiraProjectId: string,
  accountId: string,
  query: typeof executeSql = executeSql,
): Promise<ProjectAccess | undefined> {
  if (!/^[1-9][0-9]{0,31}$/.test(jiraProjectId) || !/^[^\s\p{Cc}]{1,128}$/u.test(accountId)) {
    return undefined;
  }

  const rows = await query<RoleRow>(
    `SELECT p.id AS project_id, r.role_code
      FROM ctx_project p
      INNER JOIN ctx_project_role r ON r.project_id = p.id
      WHERE p.jira_project_id = ? AND r.account_id = ?
        AND p.status = 'ACTIVE' AND r.revoked_at IS NULL
      ORDER BY r.role_code`,
    [jiraProjectId, accountId],
  );

  const projectId = rows[0]?.project_id;
  if (!projectId || rows.some((row) => row.project_id !== projectId)) {
    return undefined;
  }

  const roles = rows.map((row) => row.role_code).filter(isProjectRole);
  return roles.length ? { projectId, roles } : undefined;
}
