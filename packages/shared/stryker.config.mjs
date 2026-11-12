export default {
  mutate: [
    'src/finance/invoice-adjustment.ts',
    'src/finance/invoice-overpayment.ts',
    'src/finance/wallet-reconciliation.ts',
  ],
  // The standalone Vitest suite uses no TypeScript project references.
  ignorePatterns: ['tsconfig.json', 'dist/**', 'coverage/**', 'reports/**'],
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.mutation.config.ts' },
  reporters: ['clear-text', 'json'],
  jsonReporter: {
    fileName: process.env.BARGHSA_MUTATION_REPORT ?? 'reports/mutation/mutation.json',
  },
  concurrency: 2,
};
