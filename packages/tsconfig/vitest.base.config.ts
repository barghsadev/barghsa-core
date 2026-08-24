import { defineConfig, type UserConfig } from 'vitest/config'

/**
 * Shared Vitest base configuration.
 *
 * All packages/apps extend this config and may override specific fields.
 *
 * Minimum coverage thresholds (80% line / 75% branch) apply to all packages.
 * Domain packages (auth, payments, wallet, etc.) require 90% line / 85% branch
 * — exceptions require tech lead approval.
 */
export function createVitestConfig(overrides: UserConfig = {}): UserConfig {
  return defineConfig({
    test: {
      globals: false,
      typecheck: { enabled: false },
      environment: 'node',
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'lcov', 'html'],
        include: ['src/**'],
        exclude: [
          'src/**/*.test.ts',
          'src/**/*.spec.ts',
          'src/**/__tests__/**',
          'src/generated/**',
          'src/**/index.ts',
          'src/**/*.d.ts',
        ],
        thresholds: {
          lines: 80,
          branches: 75,
          functions: 80,
          statements: 80,
        },
      },
    },
    ...overrides,
  })
}