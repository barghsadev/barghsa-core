import v8 from '@vitest/coverage-v8';
export default {
  ...v8,
  async getProvider() {
    const { ProcessV8CoverageProvider } = await import('../../../scripts/process-v8-provider.mjs');
    const provider = new ProcessV8CoverageProvider();
    provider.environmentKey = 'BARGHSA_WORKER_COVERAGE_DIR';
    provider.compiledDirectory = 'dist';
    provider.processLabel = 'worker';
    return provider;
  },
};
