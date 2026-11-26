import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectPath, projectRoute } from './futuros-navigation';

test('Futuros locates the same run when Jira reloads a deep link', () => {
  const route = { view: 'futuros', runId: '7c4a10d3-7a18-4db7-8b14-d441f6a75b4a' } as const;
  assert.deepEqual(projectRoute(projectPath(route)), route);
  assert.deepEqual(projectRoute('/futuros/'), { view: 'futuros' });
});

test('project navigation ignores malformed run selectors and external paths', () => {
  assert.equal(projectPath({ view: 'futuros', runId: '../operaciones' }), '/futuros');
  assert.deepEqual(projectRoute('/futuros/------------------------------------'), { view: 'overview' });
  assert.deepEqual(projectRoute('/operaciones'), { view: 'operations' });
});
