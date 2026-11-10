import { expect, it, vi } from 'vitest';
import type { GreenElectricityConfig } from '@barghsa/shared/finance';
import { ElectricityCalculationService } from './electricity-calculation.service.js';

const settings: GreenElectricityConfig = {
  simpleOrder: {
    mandatoryGreenEnabled: false,
    averagePowerThresholdKw: 1000,
    mandatoryGreenSharePercent: 4,
  },
  advancedOrder: {
    mandatoryGreenEnabled: false,
    averagePowerThresholdKw: 1000,
    mandatoryGreenSharePercent: 4,
  },
};
const period = { start: new Date('2026-09-23T00:00:00Z'), end: new Date('2026-09-23T01:00:00Z') };

it('uses DB prices, limits and resolved VAT instead of client-supplied amounts', async () => {
  let price = '200';
  const executor = {
    query: vi.fn(async (_sql: string, _params?: unknown[]) => ({
      rows: [
        {
          id: 'thermal-id',
          system_key: 'thermal',
          status: 'active',
          price,
          min_kwh: '10',
          max_kwh: '100',
        },
      ],
    })),
  };
  const vat = {
    resolveCategorizedRates: vi.fn(async () => [{ rateBasisPoints: 900, source: 'category' }]),
  };
  const service = new ElectricityCalculationService(vat as never);
  const input = { mode: 'simple' as const, period, totalKwh: 20n };
  const first = await service.calculate(
    executor as never,
    input,
    settings,
    undefined,
    period.start
  );
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.totals).toMatchObject({ subtotalIrR: 4_000n, vatIrR: 360n, totalIrR: 4_360n });
  expect(executor.query.mock.calls[0]?.[0]).toContain('effective_product_price');
  expect(vat.resolveCategorizedRates).toHaveBeenCalledTimes(1);
  expect(vat.resolveCategorizedRates).toHaveBeenCalledWith(
    executor,
    [{ productId: 'thermal-id', category: 'thermal_electricity' }],
    'electricity',
    period.start
  );
  price = '300';
  const second = await service.calculate(executor as never, input, settings);
  expect(second.ok && second.totals.totalIrR).toBe(6_540n);
  vat.resolveCategorizedRates.mockResolvedValueOnce([]);
  await expect(service.calculate(executor as never, input, settings)).rejects.toThrow(
    'Missing VAT resolution for electricity line'
  );
});

it('prices an advanced bundle with distinct VAT rates in composition order', async () => {
  const executor = {
    query: vi.fn(async () => ({
      rows: [
        {
          id: 'green-id',
          system_key: 'green',
          status: 'active',
          price: '300',
          min_kwh: null,
          max_kwh: null,
        },
        {
          id: 'thermal-id',
          system_key: 'thermal',
          status: 'active',
          price: '200',
          min_kwh: null,
          max_kwh: null,
        },
      ],
    })),
  };
  const rates = [
    { rateBasisPoints: 0, source: 'product_override' },
    { rateBasisPoints: 1000, source: 'category' },
  ];
  const vat = { resolveCategorizedRates: vi.fn(async () => rates) };
  const result = await new ElectricityCalculationService(vat as never).calculate(
    executor as never,
    { mode: 'advanced', period, quantities: { thermal: 20n, green: 10n } },
    settings,
    undefined,
    period.start
  );
  expect(vat.resolveCategorizedRates).toHaveBeenCalledTimes(1);
  expect(vat.resolveCategorizedRates).toHaveBeenCalledWith(
    executor,
    [
      { productId: 'thermal-id', category: 'thermal_electricity' },
      { productId: 'green-id', category: 'green_electricity' },
    ],
    'electricity',
    period.start
  );
  expect(result).toMatchObject({
    ok: true,
    composition: {
      lines: [
        { productId: 'thermal-id', vatRateBasisPoints: 0, vatSource: 'product_override' },
        { productId: 'green-id', vatRateBasisPoints: 1000, vatSource: 'category' },
      ],
    },
    totals: { subtotalIrR: 7_000n, vatIrR: 300n, totalIrR: 7_300n },
  });
});

it('returns a specific product limit error from current DB limits', async () => {
  const executor = {
    query: vi.fn(async (_sql: string, _params?: unknown[]) => ({
      rows: [
        {
          id: 'thermal-id',
          system_key: 'thermal',
          status: 'active',
          price: '200',
          min_kwh: '10',
          max_kwh: '19',
        },
      ],
    })),
  };
  const vat = { resolveCategorizedRates: vi.fn() };
  const result = await new ElectricityCalculationService(vat as never).calculate(
    executor as never,
    { mode: 'simple', period, totalKwh: 20n },
    settings
  );
  expect(result).toMatchObject({
    ok: false,
    errors: [{ code: 'PRODUCT_MAX_KWH', systemKey: 'thermal', requiredKwh: '20', limitKwh: '19' }],
  });
  expect(vat.resolveCategorizedRates).not.toHaveBeenCalled();
});

it('fails closed when a mandatory green rule cannot be enforced, even below its threshold', async () => {
  const executor = {
    query: vi.fn(async () => ({
      rows: [
        {
          id: 'thermal-id',
          system_key: 'thermal',
          status: 'active',
          price: '200',
          min_kwh: '0',
          max_kwh: '0',
        },
      ],
    })),
  };
  const vat = { resolveCategorizedRates: vi.fn() };
  const requiredGreen = {
    ...settings,
    simpleOrder: {
      mandatoryGreenEnabled: true,
      averagePowerThresholdKw: 1000,
      mandatoryGreenSharePercent: 4,
    },
  };
  expect(
    await new ElectricityCalculationService(vat as never).calculate(
      executor as never,
      { mode: 'simple', period, totalKwh: 20n },
      requiredGreen
    )
  ).toMatchObject({ ok: false, errors: [{ code: 'GREEN_RULE_UNAVAILABLE' }] });
  expect(vat.resolveCategorizedRates).not.toHaveBeenCalled();
});
