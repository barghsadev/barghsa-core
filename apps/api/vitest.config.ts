import { createVitestConfig } from '../../packages/tsconfig/vitest.base.config'

export default createVitestConfig({
  test: {
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