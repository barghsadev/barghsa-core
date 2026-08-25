import { defineConfig, type UserConfig } from 'vitest/config'

/**
 * Deep merge of coverage threshold values, enforcing minimum floors.
 * Per-package overrides can raise thresholds but never lower them
 * below the required minimum.
 */
function mergeThresholds(
  base: Record<string, number>,
  overrides: Record<string, number | undefined>,
): Record<string, number> {
  const merged: Record<string, number> = {}
  for (const key of Object.keys(base)) {
    const override = overrides[key]
    merged[key] = override !== undefined ? Math.max(base[key]!, override) : base[key]!
  }
  return merged
}

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
 * Threshold overrides are capped at the named minimum — they can only raise
 * thresholds, never lower them.
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
      lines: 0,
      branches: 0,
      functions: 0,
      statements: 0,
    },
  }

  const userThresholds = (overrideCoverage as Record<string, unknown>).thresholds ?? {}
  const mergedThresholds = mergeThresholds(
    baseCoverage.thresholds,
    userThresholds as Record<string, number>,
  )

  return defineConfig({
    // Top-level overrides (plugins, resolve, etc.)
    ...overrides,
    test: {
      // Base defaults
      globals: false,
      typecheck: { enabled: false },
      environment: 'node',
      // Vitest 4.x defaultExclude is only node_modules and .git.
      // Explicitly exclude dist/ to avoid picking up compiled CJS .test.js files.
      exclude: ['dist/**', 'node_modules/**', '**/.git/**'],
      // Per-package overrides (e.g. environment, setupFiles)
      ...overrideTest,
      // Coverage always merges into base with floor enforcement
      coverage: {
        ...baseCoverage,
        ...overrideCoverage,
        thresholds: mergedThresholds,
      },
    },
  })
}