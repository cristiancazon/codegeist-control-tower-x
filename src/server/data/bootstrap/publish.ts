import { Queue, type AsyncEvent } from '@forge/events';
import { persistPatagoniaFixture } from '../sql/patagonia';
import { fixture, fixtureHash } from './fixture';
import { activateProject, isProjectAdmin, readImport, readTickets } from './store';

const publishQueue = new Queue<{ jiraProjectId: string }>({ key: 'ctx-fixture-publish' });

export async function enqueueFixturePublish(jiraProjectId: string) {
  await publishQueue.push({ body: { jiraProjectId }, concurrency: { key: 'publish', limit: 1 } });
}

export async function publish(event: AsyncEvent<{ jiraProjectId: string }>) {
  const { jiraProjectId } = event.body;
  if (typeof jiraProjectId !== 'string' || !/^[1-9][0-9]{0,31}$/.test(jiraProjectId)) {
    throw new Error('Invalid fixture publication context');
  }
  const projectId = fixture.project.id;
  const current = await readImport(projectId, jiraProjectId);
  if (!current || current.fixture_hash !== fixtureHash || current.state !== 'IMPORTING') {
    return;
  }
  if (!await isProjectAdmin(projectId, current.owner_account_id)) {
    console.warn(JSON.stringify({ operation: 'demo.publish', code: 'FORBIDDEN' }));
    return;
  }
  const mapped = await readTickets(projectId);
  const issues = mapped.flatMap((ticket) =>
    ticket.state === 'DONE' && ticket.issue_id !== null && ticket.issue_key !== null
      ? [{ taskCode: ticket.task_code, issueId: ticket.issue_id, issueKey: ticket.issue_key }]
      : []);
  if (issues.length !== fixture.workPackages.length) {
    throw new Error('Fixture publication is missing Jira mappings');
  }
  await persistPatagoniaFixture({ fixture, jiraProjectId, ownerAccountId: current.owner_account_id, issues });
  await activateProject(projectId, jiraProjectId, current.owner_account_id, fixtureHash);
  console.info(JSON.stringify({ operation: 'demo.publish', code: 'COMPLETE', mapped: issues.length }));
}
