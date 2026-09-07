import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserArguments } from './browser-projects.mjs';

test('defaults to Chromium without overriding explicit projects', () => {
  assert.deepEqual(browserArguments(['smoke.spec.ts']), ['smoke.spec.ts', '--project', 'chromium']);
  for (const args of [
    ['--project', 'firefox', '--list'],
    ['--project=webkit', '--grep', 'login'],
    ['--project', 'mobile-chrome', '--project', 'mobile-safari'],
  ])
    assert.deepEqual(browserArguments(args), args);
});

test('rejects invalid or incompatible coverage browser selection', () => {
  for (const args of [['--project'], ['--project='], ['--project', '--list']]) {
    assert.throws(() => browserArguments(args), /Missing browser project/);
  }
  for (const args of [
    ['--project', 'firefox'],
    ['--project', 'chromium', 'firefox'],
    ['--project=chromium', 'firefox'],
    ['--project=chromium', '--project=webkit'],
    ['--project=chrom*'],
  ])
    assert.throws(() => browserArguments(args, true), /Chromium project only/);
  assert.deepEqual(browserArguments(['--project=chromium'], true), ['--project=chromium']);
  assert.deepEqual(browserArguments([], true), ['--project', 'chromium']);
});
