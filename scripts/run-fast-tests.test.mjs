import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relatedTestPlan, verifyChangedTestsRan } from './run-fast-tests.mjs';

test('selects changed Vitest files by application with ordinary documentation edits', () => {
  assert.deepEqual(
    relatedTestPlan([
      ['M', 'apps/api/src/documents/document-http.integration.test.ts'],
      ['A', 'apps/web/src/hooks/query.test.tsx'],
      ['M', 'apps/worker/src/jobs/async-runner.test.ts'],
      ['M', 'kanban/board.json'],
      ['M', 'docs/development/ci.md'],
    ]),
    new Map([
      ['api', ['src/documents/document-http.integration.test.ts']],
      ['web', ['src/hooks/query.test.tsx']],
      ['worker', ['src/jobs/async-runner.test.ts']],
    ])
  );
});

test('keeps workspace selection for runtime, fixture, migration, browser and config changes', () => {
  for (const path of [
    'apps/api/src/documents/document.service.ts',
    'apps/api/src/test/http-fixture.ts',
    'apps/web/e2e/rollout-smoke.spec.ts',
    'apps/api/vitest.config.ts',
    'packages/shared/src/storage/clamav.test.ts',
    'packages/db/drizzle/production/0289_add_index.sql',
    '.github/workflows/ci.yml',
    'pnpm-lock.yaml',
  ]) {
    assert.equal(
      relatedTestPlan([
        ['A', 'apps/api/src/documents/scan.test.ts'],
        ['M', path],
      ]),
      null,
      path
    );
  }
});

test('keeps workspace selection for removed, renamed and documentation-only files', () => {
  for (const status of ['D', 'R100', 'T'])
    assert.equal(relatedTestPlan([[status, 'apps/api/src/documents/scan.test.ts']]), null);
  assert.equal(relatedTestPlan([['M', 'docs/development/ci.md']]), null);
  assert.equal(relatedTestPlan([]), null);
});

test('requires a passing case in every changed file', () => {
  const selected = {
    testResults: [
      { name: '/app/src/passed.test.ts', assertionResults: [{ status: 'passed' }] },
      { name: '/app/src/skipped.test.ts', assertionResults: [{ status: 'pending' }] },
    ],
  };
  assert.doesNotThrow(() => verifyChangedTestsRan(selected, '/app', ['src/passed.test.ts']));
  assert.throws(
    () => verifyChangedTestsRan(selected, '/app', ['src/passed.test.ts', 'src/skipped.test.ts']),
    /No passing test ran in changed file src\/skipped.test.ts/
  );
  assert.throws(
    () => verifyChangedTestsRan(selected, '/app', ['src/missing.test.ts']),
    /No passing test ran in changed file src\/missing.test.ts/
  );
});
