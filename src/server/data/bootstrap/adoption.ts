import { fixtureMarker, JiraBoundaryError, type JiraIssueIdentity, type JiraProjectAdapter } from '../jira';
import { isFixtureMarker } from '../jira/normalize';
import { demoProjectKey, fixture } from './fixture';

const pageLimit = 4;
const expected = new Map(fixture.workPackages.map((task) => [fixtureMarker(task.code), task]));

function mismatchedFixture() {
  return new JiraBoundaryError(
    'RECONCILIATION_REQUIRED',
    'Staging requiere todos los ítems sintéticos originales de PED, con títulos, tipos y marcadores coincidentes.',
  );
}

export async function readExistingFixture(
  jira: Pick<JiraProjectAdapter, 'projectId' | 'searchWorkItemsGet'>, taskIssueTypeId: string,
): Promise<Map<string, JiraIssueIdentity>> {
  const mapped = new Map<string, JiraIssueIdentity>();
  const ids = new Set<string>();
  const keys = new Set<string>();
  const cursors = new Set<string>();
  let nextPageToken: string | undefined;
  for (let page = 0; page < pageLimit; page += 1) {
    const response = await jira.searchWorkItemsGet({ pageSize: 100, nextPageToken });
    for (const issue of response.items) {
      if (issue.projectId !== jira.projectId) throw mismatchedFixture();
      const markers = issue.labels.filter(isFixtureMarker);
      const task = markers.map((marker) => expected.get(marker)).find((value) => value !== undefined);
      if (!task) continue;
      if (markers.length !== 1 || issue.issueTypeId !== taskIssueTypeId || issue.summary !== task.title ||
          !issue.key.startsWith(`${demoProjectKey}-`) || mapped.has(task.code) || ids.has(issue.id) || keys.has(issue.key)) {
        throw mismatchedFixture();
      }
      mapped.set(task.code, { id: issue.id, key: issue.key });
      ids.add(issue.id);
      keys.add(issue.key);
    }
    if (response.nextPageToken === null) {
      if (mapped.size !== expected.size) throw mismatchedFixture();
      return mapped;
    }
    if (cursors.has(response.nextPageToken)) break;
    cursors.add(response.nextPageToken);
    nextPageToken = response.nextPageToken;
  }
  throw new JiraBoundaryError('SOURCE_UNAVAILABLE', 'Jira todavía no confirmó todas las páginas del fixture de staging.');
}
