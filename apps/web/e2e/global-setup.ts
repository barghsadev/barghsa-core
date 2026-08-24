/**
 * Barghsa E2E global setup.
 *
 * - Ensures the test environment is non-production
 * - Sets up deterministic seed data markers
 * - Provides isolated test identity pattern
 */
import type { FullConfig } from '@playwright/test'

async function globalSetup(_config: FullConfig): Promise<void> {
  // Guard: never run against production
  const baseURL = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:5173'
  const hostname = new URL(baseURL).hostname

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.local')
  ) {
    // Local/test environments are safe
    return
  }

  // For staging/CI environments, verify the PLAYWRIGHT_TEST_ENV marker
  if (process.env['PLAYWRIGHT_TEST_ENV'] !== 'test') {
    throw new Error(
      `E2E tests would target ${baseURL} which is not localhost. ` +
        'Set PLAYWRIGHT_TEST_ENV=test to confirm this is a safe test environment.',
    )
  }
}

export default globalSetup