import { defineConfig } from 'vitest/config';

// Root discovery and selected-project runs. Use pnpm test:coverage for the
// per-package coverage providers and changed-code gates used by CI.
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
  },
});
