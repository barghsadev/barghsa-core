import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 45000,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
