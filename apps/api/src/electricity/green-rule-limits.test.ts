import { expect, it } from 'vitest';
import { greenRuleLimitsCompatible, validateOrderComposition } from './electricity-calculation.js';

it('matches valid integer compositions, including omitted thermal and ceiling rounding', () => {
  for (const mode of ['simple', 'advanced'] as const)
    for (const percentage of [0, 4, 25, 50, 75, 100])
      for (const thermalMin of [0, 1, 3])
        for (const greenMin of [0, 1, 5]) {
          const thermal = { minKwh: BigInt(thermalMin), maxKwh: 5n };
          const green = { minKwh: BigInt(greenMin), maxKwh: 6n };
          const config = {
            mandatoryGreenEnabled: true,
            averagePowerThresholdKw: 0,
            mandatoryGreenSharePercent: percentage,
          };
          const products = [
            { id: 'thermal', systemKey: 'thermal' as const, ...thermal },
            { id: 'green', systemKey: 'green' as const, ...green },
          ].map((product) => ({
            ...product,
            status: 'active',
            unitPriceIrR: 1n,
            vatRateBasisPoints: 0,
            vatSource: 'fallback_zero' as const,
          }));
          let possible = false;
          for (let energy = 1n; energy <= 11n; energy++) {
            const result = validateOrderComposition(
              {
                mode,
                period: { start: new Date(0), end: new Date(3600000) },
                ...(mode === 'simple' ? { totalKwh: energy } : { quantities: { thermal: energy } }),
              },
              { simpleOrder: config, advancedOrder: config },
              products
            );
            if (result.ok && result.greenRuleApplies) possible = true;
          }
          expect(
            greenRuleLimitsCompatible(mode, percentage, thermal, green),
            JSON.stringify({ mode, percentage, thermalMin, greenMin })
          ).toBe(possible);
        }
});

it('keeps unlimited maxima, exact decimal percentages and bigint overflow boundaries', () => {
  expect(
    greenRuleLimitsCompatible(
      'advanced',
      4.5,
      { minKwh: 0n, maxKwh: 0n },
      { minKwh: 100n, maxKwh: 0n }
    )
  ).toBe(true);
  expect(
    greenRuleLimitsCompatible(
      'advanced',
      1e-7,
      { minKwh: 0n, maxKwh: 0n },
      { minKwh: 1n, maxKwh: 0n }
    )
  ).toBe(true);
  expect(
    greenRuleLimitsCompatible(
      'simple',
      4,
      { minKwh: 0n, maxKwh: 1n },
      { minKwh: 100n, maxKwh: 100n }
    )
  ).toBe(false);
  expect(
    greenRuleLimitsCompatible(
      'advanced',
      100,
      { minKwh: 0n, maxKwh: 0n },
      { minKwh: 0n, maxKwh: 0n }
    )
  ).toBe(false);
  expect(
    greenRuleLimitsCompatible(
      'advanced',
      50,
      { minKwh: 9223372036854775807n, maxKwh: 0n },
      { minKwh: 0n, maxKwh: 0n }
    )
  ).toBe(false);
});
