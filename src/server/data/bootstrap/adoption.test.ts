import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiraProjectAdapter, fixtureMarker, type JiraRequest } from '../jira';
import { readExistingFixture } from './adoption';
import { fixture } from './fixture';

const jiraProjectId = '10202';
const taskIssueTypeId = '50';

const items = fixture.workPackages.map(({ code, title }, index) => ({
  id: String(2000 + index), key: `PED-${index + 1}`,
  fields: {
    project: { id: jiraProjectId }, issuetype: { id: taskIssueTypeId }, summary: title,
    status: { id: '30', name: 'Pendiente' }, labels: [fixtureMarker(code)], updated: '2026-11-25T00:00:00.000Z',
  },
}));

function testAdapter(workItems = items, loop = false) {
  const calls: string[] = [];
  const request: JiraRequest = async (path, options) => {
    assert.equal(options.method, 'GET');
    const url = new URL(path.value, 'https://jira.invalid');
    calls.push(url.pathname);
    if (url.pathname === '/rest/api/3/mypermissions') {
      return { status: 200, json: async () => ({ permissions: { BROWSE_PROJECTS: { havePermission: true } } }) };
    }
    if (url.pathname === `/rest/api/3/project/${jiraProjectId}`) {
      assert.equal(url.searchParams.get('expand'), 'issueTypes');
      return { status: 200, json: async () => ({ id: jiraProjectId, key: 'PED', name: 'Patagonia',
        issueTypes: [{ id: taskIssueTypeId, name: 'Tarea', subtask: false }] }) };
    }
    assert.equal(url.pathname, '/rest/api/3/search/jql');
    assert.match(url.searchParams.get('jql') ?? '', /^project = 10202 ORDER BY id ASC$/);
    const isSecondPage = url.searchParams.has('nextPageToken');
    const response = isSecondPage
      ? { issues: workItems.slice(100), ...(loop ? { nextPageToken: 'page2' } : { isLast: true }) }
      : { issues: workItems.slice(0, 100), nextPageToken: 'page2' };
    return { status: 200, json: async () => response };
  };
  return { jira: createJiraProjectAdapter(jiraProjectId, request), calls };
}

test('staging reads both pages of existing Jira Task identities and only uses GET', async () => {
  const { jira, calls } = testAdapter();
  const project = await jira.getProjectWithTaskType();
  assert.equal(project.taskIssueTypeId, taskIssueTypeId);
  const mapping = await readExistingFixture(jira, project.taskIssueTypeId);
  assert.equal(mapping.size, 120);
  assert.deepEqual(mapping.get('WP-048'), { id: '2047', key: 'PED-48' });
  assert.deepEqual(calls, ['/rest/api/3/mypermissions', '/rest/api/3/project/10202', '/rest/api/3/search/jql', '/rest/api/3/search/jql']);
});

test('staging never falls back to creation for a missing, duplicated or altered fixture identity', async () => {
  const [first, ...rest] = items;
  assert.ok(first);
  const cases = [
    rest,
    [...rest, first, { ...first, id: '3000', key: 'PED-3000' }],
    [...rest, { ...first, fields: { ...first.fields, labels: [...first.fields.labels, fixtureMarker('WP-004', 2)] } }],
    [...rest, { ...first, fields: { ...first.fields, summary: 'Alterado' } }],
    [...rest, { ...first, fields: { ...first.fields, issuetype: { id: '51' } } }],
    [...rest, { ...first, key: 'WRONG-1' }],
  ];
  for (const data of cases) {
    const { jira, calls } = testAdapter(data);
    await assert.rejects(readExistingFixture(jira, taskIssueTypeId), { code: 'RECONCILIATION_REQUIRED' });
    assert.equal(calls.filter((path) => path === '/rest/api/3/search/jql').length, 2);
  }
  const partial = testAdapter(items, true);
  await assert.rejects(readExistingFixture(partial.jira, taskIssueTypeId), { code: 'SOURCE_UNAVAILABLE' });
});
