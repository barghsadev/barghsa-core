import { defineConfig, devices } from '@playwright/test'

/**
 * Barghsa E2E test configuration.
 *
 * Projects:
 *   - Chromium    — run on every PR (fast, stable)
 *   - Firefox     — nightly and CI full-run
 *   - WebKit      — nightly and CI full-run
 *   - Mobile (iPhone, Android) — nightly and CI full-run
 *
 * Project selection:
 *   - `pnpm e2e`              — runs all projects (full suite)
 *   - `pnpm e2e:pr`           — runs only Chromium (fast PR gate)
 *   - `pnpm e2e:ci`           — CI runner: Chromium with retries
 *
 * Trace is retained on failure for debugging.
 * Base URL is read from PLAYWRIGHT_BASE_URL (defaults to local dev server).
 * When PLAYWRIGHT_BASE_URL is set externally, webServer is disabled.
 */
const EXTERNAL_URL = process.env['PLAYWRIGHT_BASE_URL']
const LOCAL_URL = 'http://localhost:5173'
const resolvedBaseURL = EXTERNAL_URL ?? LOCAL_URL

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],

  use: {
    baseURL: resolvedBaseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    },
  ],

  /* Auto-start local dev server when no external URL is configured */
  webServer: EXTERNAL_URL
    ? undefined
    : {
        command: 'pnpm --filter @barghsa/web dev',
        url: LOCAL_URL,
        reuseExistingServer: !process.env['CI'],
        timeout: 30_000,
      },
})