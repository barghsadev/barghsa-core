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
 * Trace is retained on failure for debugging.
 * Base URL is read from PLAYWRIGHT_BASE_URL (defaults to local dev server).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],

  use: {
    baseURL: process.env['PLAYWRIGHT_BASE_URL'] || 'http://localhost:5173',
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

  /* Run local dev server before tests when not in CI */
  webServer: !process.env['CI']
    ? {
        command: 'pnpm --filter @barghsa/web dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env['CI'],
        timeout: 30_000,
      }
    : undefined,
})