import { createVitestConfig } from '../../packages/tsconfig/vitest.base.config'

export default createVitestConfig({
  test: {
    // Shared Testcontainers-backed PostgreSQL for real-DB integration tests
    // (see src/invoice/invoice-state-machine.integration.test.ts).
    globalSetup: ['../../packages/db/src/test/globalSetup.ts'],
    // Use `forks` pool so testcontainers works correctly across workers.
    pool: 'forks',
    coverage: {
      exclude: [
        'src/crm/**',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/__tests__/**',
        'src/generated/**',
        'src/**/index.ts',
        'src/**/*.d.ts',
      ],
      thresholds: {
        lines: 38,
        branches: 30,
        functions: 34,
        statements: 38,
      },
    },
  },
})