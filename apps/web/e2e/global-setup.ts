/**
 * Barghsa E2E global setup.
 *
 * - Ensures the test environment is non-production
 * - Sets up deterministic seed data markers
 * - Provides isolated test identity pattern
 */
import type { FullConfig } from '@playwright/test';
import { setup as buildApi } from '../../api/src/test/build-http-app';
import startBrowserFixtureProxy, { isLoopbackUrl } from './local-network';

async function globalSetup(config: FullConfig) {
  for (const { use } of config.projects) {
    if (!use.baseURL || !isLoopbackUrl(new URL(use.baseURL)))
      throw new Error('E2E requires a loopback HTTP application URL.');
  }
  // Compile once before workers start. Per-project fixture builds can overwrite
  // shared dist files while another browser's API process is using them.
  buildApi();
  return startBrowserFixtureProxy();
}

export default globalSetup;
