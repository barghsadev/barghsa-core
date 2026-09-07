import { createVitestConfig } from '../../packages/tsconfig/vitest.base.config';

export default createVitestConfig({
  test: {
    // Shared Testcontainers-backed PostgreSQL for real-DB integration tests
    // (see src/invoices/overdue-scanner.integration.test.ts).
    globalSetup: ['./scripts/build-test-worker.mjs', '../../packages/db/src/test/globalSetup.ts'],
    coverage: { provider: 'custom', customProviderModule: './scripts/coverage-provider.mjs' },
    // Use `forks` pool so testcontainers works correctly across workers.
    pool: 'forks',
  },
});
