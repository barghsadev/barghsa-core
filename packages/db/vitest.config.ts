import { defineConfig } from 'vitest/config'

// Shared config for @barghsa/db — database utilities, migrations, and seed logic.
// Integration tests against real PostgreSQL are configured separately (T-01.04.03).
export default defineConfig({
  test: {
    globals: false,
    typecheck: { enabled: false },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})