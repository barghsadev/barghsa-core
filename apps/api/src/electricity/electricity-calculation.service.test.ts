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
  const vat = { resolveRate: vi.fn(async () => ({ rateBasisPoints: 900, source: 'category' })) };
  const service = new ElectricityCalculationService(vat as never);
  const input = { mode: 'simple' as const, period, totalKwh: 20n };
  const first = await service.calculate(executor as never, input, settings);
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  expect(first.totals).toMatchObject({ subtotalIrR: 4_000n, vatIrR: 360n, totalIrR: 4_360n });
  expect(executor.query.mock.calls[0]?.[0]).toContain('effective_product_price');
  expect(vat.resolveRate).toHaveBeenCalledWith(
    executor,
    expect.objectContaining({
      productId: 'thermal-id',
      category: 'thermal_electricity',
    })
  );
  price = '300';
  const second = await service.calculate(executor as never, input, settings);
  expect(second.ok && second.totals.totalIrR).toBe(6_540n);
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
  const vat = { resolveRate: vi.fn(async () => ({ rateBasisPoints: 0, source: 'fallback_zero' })) };
  const result = await new ElectricityCalculationService(vat as never).calculate(
    executor as never,
    { mode: 'simple', period, totalKwh: 20n },
    settings
  );
  expect(result).toMatchObject({
    ok: false,
    errors: [{ code: 'PRODUCT_MAX_KWH', systemKey: 'thermal', requiredKwh: '20', limitKwh: '19' }],
  });
  expect(vat.resolveRate).not.toHaveBeenCalled();
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
  const vat = { resolveRate: vi.fn() };
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
  expect(vat.resolveRate).not.toHaveBeenCalled();
});
