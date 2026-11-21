import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/browser-nightly.yml', import.meta.url),
  'utf8'
);

test('nightly browser shards run directly on the GitHub-hosted runner', () => {
  assert.doesNotMatch(workflow, /^\s*['"]?container['"]?\s*:/m, 'Keep nightly jobs on the runner');
  assert.doesNotMatch(
    workflow,
    /docker\.sock|--net(?:work)?(?:\s+|=)["']?host\b/i,
    'Keep Docker socket mounts and host networking out of the nightly workflow'
  );
  const nativeCommand =
    '        run: node scripts/run-production-browser.mjs --project "${{ matrix.project }}" --shard "${{ matrix.shard }}/8"';
  assert.ok(workflow.split('\n').includes(nativeCommand), 'Run browser shards directly');
});
