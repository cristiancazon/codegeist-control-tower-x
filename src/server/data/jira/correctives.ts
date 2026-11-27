import { isIssueKey, isJiraId, isRecord, isText } from './normalize';
import { JiraBoundaryError, type JiraCorrectiveIssueInput } from './types';

const markerPattern = /^ctx-decision-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const unsupportedControls = /[\p{Cc}\p{Cf}\p{Cs}]/u;
export const correctiveFields = 'project,issuetype,summary,description,labels';

export function assertCorrectiveInput(input: JiraCorrectiveIssueInput) {
  if (!isJiraId(input.issueTypeId) || !isIssueKey(`${input.projectKey}-1`) || typeof input.marker !== 'string' ||
    !markerPattern.test(input.marker) || !isText(input.summary, 255) ||
    unsupportedControls.test(input.summary) || !isText(input.description, 4_000) ||
    unsupportedControls.test(input.description.replace(/\r?\n/g, ''))) {
    throw new JiraBoundaryError('VALIDATION_ERROR', 'Los campos aprobados del correctivo Jira no son válidos.');
  }
}

export function correctiveDescription(description: string) {
  return { version: 1, type: 'doc', content: description.split(/\r?\n/).map((text) => ({
    type: 'paragraph', content: text ? [{ type: 'text', text }] : [],
  })) };
}

export function matchesCorrectiveMarker(raw: unknown, projectId: string, marker: string): boolean {
  if (!isRecord(raw) || !isRecord(raw.fields)) return false;
  const { project, labels } = raw.fields;
  return isRecord(project) && project.id === projectId && Array.isArray(labels) && labels.length === 1 && labels[0] === marker;
}

function matchesDescription(raw: unknown, description: string): boolean {
  const lines = description.split(/\r?\n/);
  if (!isRecord(raw) || raw.type !== 'doc' || raw.version !== 1 || !Array.isArray(raw.content) || raw.content.length !== lines.length) {
    return false;
  }
  return raw.content.every((node, index) => {
    if (!isRecord(node) || node.type !== 'paragraph') return false;
    if (!lines[index] && node.content === undefined) return true;
    if (!Array.isArray(node.content) || node.content.length > 100) return false;
    const fragments: string[] = [];
    for (const fragment of node.content) {
      if (!isRecord(fragment) || fragment.type !== 'text' || typeof fragment.text !== 'string' ||
        (fragment.marks !== undefined && (!Array.isArray(fragment.marks) || fragment.marks.length !== 0))) return false;
      fragments.push(fragment.text);
    }
    return fragments.join('') === lines[index];
  });
}

export function matchesCorrectiveFields(raw: unknown, projectId: string, key: string, input: JiraCorrectiveIssueInput) {
  if (!matchesCorrectiveMarker(raw, projectId, input.marker) || !isRecord(raw) || !isRecord(raw.fields)) return false;
  const { project, issuetype, summary, description } = raw.fields;
  return isRecord(project) && project.key === input.projectKey && keyBelongsToProject(key, input.projectKey) &&
    isRecord(issuetype) && issuetype.id === input.issueTypeId && summary === input.summary &&
    matchesDescription(description, input.description);
}

export function keyBelongsToProject(issueKey: string, projectKey: string) {
  return isIssueKey(`${projectKey}-1`) && issueKey.startsWith(`${projectKey}-`);
}
