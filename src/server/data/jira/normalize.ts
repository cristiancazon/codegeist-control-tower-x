import { JiraBoundaryError, type JiraIssueIdentity, type JiraWorkItem } from './types.js';

const JIRA_ID = /^[1-9][0-9]{0,31}$/;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,39}-[1-9][0-9]{0,31}$/;
const WORK_PACKAGE_CODE = /^WP-(00[1-9]|0[1-9][0-9]|1[01][0-9]|120)$/;
const FIXTURE_MARKER = /^ctx-demo-v[1-9][0-9]{0,3}-wp-(00[1-9]|0[1-9][0-9]|1[01][0-9]|120)$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJiraId(value: unknown): value is string {
  return typeof value === 'string' && JIRA_ID.test(value);
}

export function isIssueKey(value: unknown): value is string {
  return typeof value === 'string' && ISSUE_KEY.test(value);
}

export function isText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit && value.trim().length > 0;
}

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function isFixtureMarker(value: unknown): value is string {
  return typeof value === 'string' && FIXTURE_MARKER.test(value);
}

export function fixtureMarker(workPackageCode: string, fixtureVersion = 1): string {
  if (!WORK_PACKAGE_CODE.test(workPackageCode) || !Number.isInteger(fixtureVersion) || fixtureVersion < 1 || fixtureVersion > 9999) {
    throw new JiraBoundaryError('VALIDATION_ERROR', 'El identificador de fixture Jira no es válido.');
  }
  return `ctx-demo-v${fixtureVersion}-${workPackageCode.toLowerCase()}`;
}

export function readIssueIdentity(raw: unknown): JiraIssueIdentity | undefined {
  if (isRecord(raw) && isJiraId(raw.id) && isIssueKey(raw.key)) {
    return { id: raw.id, key: raw.key };
  }
  return undefined;
}

export function normalizeWorkItem(raw: unknown, expectedProjectId: string): JiraWorkItem {
  const identity = readIssueIdentity(raw);
  if (!identity || !isRecord(raw) || !isRecord(raw.fields)) {
    throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira devolvió un ítem de trabajo incompleto.');
  }

  const { project, issuetype, summary, status, assignee, duedate, updated, labels } = raw.fields;
  if (!isRecord(project) || project.id !== expectedProjectId) {
    throw new JiraBoundaryError('FORBIDDEN', 'El ítem de trabajo no pertenece al proyecto actual.');
  }

  if (!isRecord(issuetype) || !isJiraId(issuetype.id) || !isRecord(status) || !isJiraId(status.id) ||
      !isText(status.name, 255) || !isText(summary, 255) || !isText(updated, 48) ||
      (duedate != null && !isDateOnly(duedate)) ||
      !Array.isArray(labels) || labels.length > 500 || !labels.every((label) => isText(label, 255))) {
    throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira devolvió un ítem de trabajo incompleto.');
  }

  const updatedAt = new Date(updated);
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(updated) || Number.isNaN(updatedAt.valueOf())) {
    throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira devolvió una fecha de actualización inválida.');
  }

  return {
    ...identity,
    projectId: expectedProjectId,
    issueTypeId: issuetype.id,
    summary,
    status: {
      id: status.id,
      name: status.name,
      categoryKey: isRecord(status.statusCategory) && isText(status.statusCategory.key, 128) ? status.statusCategory.key : null,
    },
    assigneeAccountId: isRecord(assignee) && isText(assignee.accountId, 128) ? assignee.accountId : null,
    dueDate: duedate ?? null,
    updatedAt: updatedAt.toISOString(),
    labels: [...new Set<string>(labels)].sort(),
  };
}
