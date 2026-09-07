import { test as base } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export * from '@playwright/test';

export const test = base.extend<{ browserCoverage: void }>({
  browserCoverage: [
    async ({ page, browserName }, use) => {
      const directory = process.env['BARGHSA_BROWSER_COVERAGE_DIR'];
      if (!directory) return use();
      if (browserName !== 'chromium') throw new Error('Browser coverage requires Chromium');
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      try {
        await use();
      } finally {
        const entries = await page.coverage.stopJSCoverage();
        await mkdir(directory, { recursive: true });
        await writeFile(
          join(directory, `${randomUUID()}.json`),
          JSON.stringify({
            schema_version: 1,
            head_sha: process.env['BARGHSA_BROWSER_COVERAGE_HEAD'],
            working_tree_dirty: process.env['BARGHSA_BROWSER_COVERAGE_DIRTY'] !== 'false',
            entries,
          })
        );
      }
    },
    { auto: true },
  ],
});
