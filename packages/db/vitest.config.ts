import { createVitestConfig } from '../tsconfig/vitest.base.config'

export default createVitestConfig({
  test: {
    globalSetup: ['./src/test/globalSetup.ts'],
    // testcontainers manages its own lifecycle — no need for jsdom/browser env.
    environment: 'node',
    // Use `forks` pool so testcontainers works correctly across workers.
    pool: 'forks',
    // Exclude test helpers from coverage.
    coverage: {
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/__tests__/**',
        'src/test/**',
        'src/generated/**',
        'src/**/index.ts',
        'src/**/*.d.ts',
      ],
    },
  },
})