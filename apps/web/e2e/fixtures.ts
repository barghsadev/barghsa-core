import { test as base, expect, type Page } from '@playwright/test'

/**
 * Extended test fixture providing isolated test context.
 *
 * Each test gets a unique identity prefix for deterministic seed data,
 * ensuring no cross-test state pollution.
 */
interface TestFixtures {
  /** Unique identity to scope test data (e.g. seed search prefix) */
  identity: string
}

/**
 * Creates a test-scoped identity for isolated E2E test data.
 */
function createTestIdentity(): string {
  // Use performance.now + random for uniqueness without external deps
  const ts = performance.now().toString(36).replace('.', '')
  const rnd = Math.random().toString(36).slice(2, 8)
  return `e2e-test-${ts}-${rnd}`
}

export const test = base.extend<TestFixtures>({
  identity: async ({}, use) => {
    await use(createTestIdentity())
  },
})

export { expect } from '@playwright/test'
export type { Page }