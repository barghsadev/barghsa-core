import { describe, it, expect } from 'vitest';

describe('createVitestConfig', () => {
  it('keeps package-wide floors separate from CI changed-code gates', async () => {
    const { createVitestConfig } = await import('../tsconfig/vitest.base.config');
    const config = createVitestConfig();
    const testConfig = config.test as Record<string, unknown>;
    const coverage = testConfig.coverage as Record<string, unknown>;
    const thresholds = coverage.thresholds as Record<string, number>;

    expect(thresholds.lines).toBe(0);
    expect(thresholds.branches).toBe(0);
    expect(thresholds.functions).toBe(0);
    expect(thresholds.statements).toBe(0);
  });

  it('preserves coverage options when overriding test environment', async () => {
    const { createVitestConfig } = await import('../tsconfig/vitest.base.config');
    const config = createVitestConfig({
      test: { environment: 'jsdom' },
    });
    const testConfig = config.test as Record<string, unknown>;
    const coverage = testConfig.coverage as Record<string, unknown>;
    const thresholds = coverage.thresholds as Record<string, number>;

    // environment override should not destroy coverage
    expect(testConfig.environment).toBe('jsdom');
    expect(thresholds.lines).toBe(0);
    expect(thresholds.branches).toBe(0);
  });

  it('allows raising thresholds but not lowering them', async () => {
    const { createVitestConfig } = await import('../tsconfig/vitest.base.config');
    const config = createVitestConfig({
      test: {
        coverage: {
          thresholds: {
            lines: 95, // raise — should take effect
            branches: -1, // invalid lower value cannot drop below the package floor
          },
        },
      },
    });
    const testConfig = config.test as Record<string, unknown>;
    const coverage = testConfig.coverage as Record<string, unknown>;
    const thresholds = coverage.thresholds as Record<string, number>;

    expect(thresholds.lines).toBe(95); // raised
    expect(thresholds.branches).toBe(0); // clamped to the package floor
    expect(thresholds.functions).toBe(0); // unchanged
    expect(thresholds.statements).toBe(0); // unchanged
  });
});
