import { createVitestConfig } from '../../packages/tsconfig/vitest.base.config';

export default createVitestConfig({
  test: {
    // Shared Testcontainers-backed PostgreSQL for real-DB integration tests
    // (see src/invoice/invoice-state-machine.integration.test.ts).
    globalSetup: ['./src/test/build-http-app.ts', '../../packages/db/src/test/globalSetup.ts'],
    exclude: ['dist/**', 'node_modules/**', 'e2e/**'],
    // Use `forks` pool so testcontainers works correctly across workers.
    pool: 'forks',
    coverage: {
      provider: 'custom',
      customProviderModule: './scripts/coverage-provider.mjs',
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/__tests__/**',
        'src/generated/**',
        'src/**/*.d.ts',
      ],
      // Measured whole-package floor; required changed-code/critical gates remain separate.
      thresholds: {
        lines: 80,
        branches: 65,
        functions: 70,
        statements: 80,
      },
    },
  },
});
