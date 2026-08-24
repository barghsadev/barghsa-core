import { test as base, expect, type Page } from '@playwright/test'

/**
 * Extended test fixture providing isolated test context.
 *
 * Each test gets a deterministic identity derived from the test metadata
 * so runs are reproducible and seed data can be traced back to a specific
 * test + project + worker combination.
 */
interface TestFixtures {
  /** Deterministic identity to scope test data (e.g. seed search prefix).
   *  Format: `e2e-<project>-<worker>-<sanitized-title>` */
  identity: string
}

/**
 * Sanitize a test title to a filesystem-safe identifier.
 */
function sanitize(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

export const test = base.extend<TestFixtures>({
  identity: [
    async ({}, use, testInfo) => {
      const identity = `e2e-${testInfo.project.name}-w${testInfo.workerIndex}-${sanitize(testInfo.title)}`
      await use(identity)
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
export type { Page }