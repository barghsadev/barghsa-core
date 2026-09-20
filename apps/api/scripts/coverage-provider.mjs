import v8 from '@vitest/coverage-v8';

// Worker-side collection stays Vitest's supported V8 implementation. Load the
// parent-side provider lazily, just as the built-in provider does.
export default {
  ...v8,
  async getProvider() {
    const { HttpV8CoverageProvider } = await import('./http-v8-provider.mjs');
    return new HttpV8CoverageProvider();
  },
};
