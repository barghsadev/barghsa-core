import { describe, it, expect } from 'vitest'

describe('createVitestConfig', () => {
  it('sets default coverage thresholds when no overrides are provided', async () => {
    const { createVitestConfig } = await import('../tsconfig/vitest.base.config')
    const config = createVitestConfig()
    const testConfig = config.test as Record<string, unknown>
    const coverage = testConfig.coverage as Record<string, unknown>
    const thresholds = coverage.thresholds as Record<string, number>

    expect(thresholds.lines).toBe(80)
    expect(thresholds.branches).toBe(75)
    expect(thresholds.functions).toBe(80)
    expect(thresholds.statements).toBe(80)
  })

  it('preserves coverage thresholds when overriding test environment', async () => {
    const { createVitestConfig } = await import('../tsconfig/vitest.base.config')
    const config = createVitestConfig({
      test: { environment: 'jsdom' },
    })
    const testConfig = config.test as Record<string, unknown>
    const coverage = testConfig.coverage as Record<string, unknown>
    const thresholds = coverage.thresholds as Record<string, number>

    // environment override should not destroy coverage
    expect(testConfig.environment).toBe('jsdom')
    expect(thresholds.lines).toBe(80)
    expect(thresholds.branches).toBe(75)
  })

  it('allows raising thresholds but not lowering them', async () => {
    const { createVitestConfig } = await import('../tsconfig/vitest.base.config')
    const config = createVitestConfig({
      test: {
        coverage: {
          thresholds: {
            lines: 95,    // raise — should take effect
            branches: 10, // below floor — should be clamped to 75
          },
        },
      },
    })
    const testConfig = config.test as Record<string, unknown>
    const coverage = testConfig.coverage as Record<string, unknown>
    const thresholds = coverage.thresholds as Record<string, number>

    expect(thresholds.lines).toBe(95)    // raised
    expect(thresholds.branches).toBe(75) // clamped to floor
    expect(thresholds.functions).toBe(80) // unchanged
    expect(thresholds.statements).toBe(80) // unchanged
  })
})