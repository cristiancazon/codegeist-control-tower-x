import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isConfiguredDemoProject, isConfiguredEvaluationProject, isConfiguredStagingAdoption, readDemoActor } from './demo-access';

test('demo resolves the trusted Atlassian actor, including lowercase s, p and c', () => {
  assert.equal(readDemoActor({ accountId: '557058:site-person-c' }), '557058:site-person-c');
  assert.equal(readDemoActor({ accountId: 'anonymous', accountType: 'anonymous' }), undefined);
  assert.equal(readDemoActor({ accountId: 'account id' }), undefined);
  assert.equal(readDemoActor({ accountId: 'account\u0000id' }), undefined);
});

test('demo only enables the configured development Jira site and project', () => {
  const config = { cloudId: 'demo-cloud', jiraProjectId: '10202' };
  const runtime = {
    environmentType: 'DEVELOPMENT',
    installation: { contexts: [{ toString: () => 'ari:cloud:jira::site/demo-cloud', cloudId: 'demo-cloud' }] },
  };
  assert.equal(isConfiguredDemoProject(runtime, '10202', config), true);
  assert.equal(isConfiguredDemoProject(runtime, '10203', config), false);
  assert.equal(isConfiguredDemoProject(runtime, '10202', {}), false);
  assert.equal(isConfiguredDemoProject({ environmentType: 'DEVELOPMENT' }, '10202', config), false);
  assert.equal(isConfiguredDemoProject({ ...runtime, environmentType: 'PRODUCTION' }, '10202', config), false);
  assert.equal(isConfiguredDemoProject(runtime, '10202', { ...config, cloudId: 'other-cloud' }), false);
  assert.equal(isConfiguredDemoProject({
    ...runtime, installation: {
      contexts: [{ toString: () => 'ari:cloud:confluence::site/demo-cloud', cloudId: 'demo-cloud' }],
    },
  }, '10202', config), false);
});

test('staging adoption requires the explicit flag and exact Jira installation and project', () => {
  const config = { cloudId: 'demo-cloud', jiraProjectId: '10202', enabled: 'true' };
  const runtime = {
    environmentType: 'STAGING',
    installation: { contexts: [{ toString: () => 'ari:cloud:jira::site/demo-cloud', cloudId: 'demo-cloud' }] },
  };
  assert.equal(isConfiguredStagingAdoption(runtime, '10202', config), true);
  assert.equal(isConfiguredDemoProject(runtime, '10202', config), false);
  assert.equal(isConfiguredStagingAdoption(runtime, '10202', { ...config, enabled: 'TRUE' }), false);
  assert.equal(isConfiguredStagingAdoption(runtime, '10202', { ...config, enabled: undefined }), false);
  assert.equal(isConfiguredStagingAdoption(runtime, '10203', config), false);
  assert.equal(isConfiguredStagingAdoption(runtime, '10202', { ...config, cloudId: 'other-cloud' }), false);
  for (const environmentType of ['PRODUCTION', 'DEVELOPMENT']) {
    assert.equal(isConfiguredStagingAdoption({ ...runtime, environmentType }, '10202', config), false);
  }
  assert.equal(isConfiguredStagingAdoption({ environmentType: 'STAGING' }, '10202', config), false);
  assert.equal(isConfiguredStagingAdoption({
    ...runtime, installation: { contexts: [{ toString: () => 'ari:cloud:confluence::site/demo-cloud', cloudId: 'demo-cloud' }] },
  }, '10202', config), false);
});
test('evaluation opt-in is restricted to the configured Jira installation and project', () => {
  const cloudId = 'evaluation-cloud';
  const config = { cloudId, jiraProjectId: '10202', enabled: 'true' };
  const installation = { contexts: [{ cloudId, toString: () => `ari:cloud:jira::site/${cloudId}` }] };
  for (const environmentType of ['STAGING', 'PRODUCTION']) {
    const runtime = { environmentType, installation };
    assert.equal(isConfiguredEvaluationProject(runtime, '10202', config), true);
    assert.equal(isConfiguredEvaluationProject(runtime, '10202', { ...config, enabled: undefined }), false);
    assert.equal(isConfiguredEvaluationProject(runtime, '10203', config), false);
    assert.equal(isConfiguredEvaluationProject(runtime, '10202', { ...config, cloudId: 'another-site' }), false);
  }
  assert.equal(isConfiguredEvaluationProject({ environmentType: 'DEVELOPMENT', installation }, '10202', config), false);
  assert.equal(isConfiguredEvaluationProject({ environmentType: 'PRODUCTION' }, '10202', config), false);
});
