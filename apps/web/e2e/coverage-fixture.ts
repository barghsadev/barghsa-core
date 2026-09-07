import { test as base } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

export * from '@playwright/test';

const componentBuilds = new Map<string, string>();
export function registerComponentCoverage(origin: string, directory: string) {
  componentBuilds.set(new URL(origin).origin, basename(directory));
}

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
            application_origin: new URL(process.env['PLAYWRIGHT_BASE_URL']!).origin,
            head_sha: process.env['BARGHSA_BROWSER_COVERAGE_HEAD'],
            working_tree_dirty: process.env['BARGHSA_BROWSER_COVERAGE_DIRTY'] !== 'false',
            component_builds: Array.from(componentBuilds, ([origin, directory]) => ({
              origin,
              directory,
            })),
            entries,
          })
        );
      }
    },
    { auto: true },
  ],
});
