import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('actual CI browser config rejects a failed-first retry and accepts a clean pass', () => {
  const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), 'barghsa-flake-gate-'));
  try {
    const config = fileURLToPath(new URL('../apps/web/playwright.config.ts', import.meta.url));
    writeFileSync(
      join(directory, 'playwright.config.ts'),
      `import original from ${JSON.stringify(config)};
export default { ...original, globalSetup: undefined, testDir: ${JSON.stringify(directory)},
  webServer: undefined, projects: [{ name: 'gate-fixture' }], retries: 1, reporter: 'json' };`
    );
    for (const flaky of [false, true]) {
      writeFileSync(
        join(directory, 'gate.spec.cjs'),
        `const {test,expect}=require(${JSON.stringify(require.resolve('@playwright/test'))});
test('retry gate',async ({},info)=>{expect(${flaky ? 'info.retry' : '1'}).toBe(1);});`
      );
      const result = spawnSync(
        process.execPath,
        [
          require.resolve('@playwright/test/cli'),
          'test',
          '--config',
          join(directory, 'playwright.config.ts'),
          '--output',
          join(directory, 'results'),
        ],
        { encoding: 'utf8', env: { ...process.env, CI: 'true' }, timeout: 30_000 }
      );
      assert.equal(result.status, flaky ? 1 : 0, result.stderr + result.stdout);
      assert.equal(JSON.parse(result.stdout).stats.flaky, flaky ? 1 : 0);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
