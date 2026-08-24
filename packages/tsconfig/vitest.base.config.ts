import { defineConfig, type UserConfig } from 'vitest/config'

/**
 * Shared Vitest base configuration.
 *
 * All packages/apps extend this config and may override specific fields.
 *
 * Minimum coverage thresholds (80% line / 75% branch) apply to all packages.
 * Domain packages (auth, payments, wallet, etc.) require 90% line / 85% branch
 * — exceptions require tech lead approval.
 *
 * Overrides are deep-merged: `overrides.test` extends the base test config
 * rather than replacing it, preserving coverage thresholds and other defaults.
 */
export function createVitestConfig(overrides: UserConfig = {}): UserConfig {
  const overrideTest = overrides.test ?? ({} as Record<string, unknown>)
  const overrideCoverage = (overrideTest as Record<string, unknown>).coverage ?? ({} as Record<string, unknown>)

  const baseCoverage = {
    provider: 'v8' as const,
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
  }

  return defineConfig({
    // Top-level overrides (plugins, resolve, etc.)
    ...overrides,
    test: {
      // Base defaults
      globals: false,
      typecheck: { enabled: false },
      environment: 'node',
      // Per-package overrides (e.g. environment, setupFiles)
      ...overrideTest,
      // Coverage always merges into base — survives overrideTest spread
      coverage: {
        ...baseCoverage,
        ...overrideCoverage,
        thresholds: {
          ...baseCoverage.thresholds,
          ...(overrideCoverage as Record<string, unknown>).thresholds ?? {},
        },
      },
    },
  })
}