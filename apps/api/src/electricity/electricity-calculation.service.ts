import { Injectable } from '@nestjs/common';
import { evaluateGreenRuleEnforcement, type GreenElectricityConfig } from '@barghsa/shared/finance';
import {
  VatCalculationRepository,
  type DbExecutor,
} from '../invoice/vat-calculation.repository.js';
import {
  calculateElectricityTotals,
  validateOrderComposition,
  type CompositionResult,
  type ElectricityGiftDiscount,
  type ElectricityLine,
  type ElectricityProductInput,
  type ElectricitySystemKey,
} from './electricity-calculation.js';
import type { ElectricityPeriod } from './electricity-periods.js';

const keys = ['thermal', 'green', 'free_market', 'energy_saving'] as const;
const categories: Record<ElectricitySystemKey, string> = {
  thermal: 'thermal_electricity',
  green: 'green_electricity',
  free_market: 'free_market_electricity',
  energy_saving: 'energy_saving_electricity',
};

function nonnegativeInt8(raw: string | null): bigint | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = BigInt(raw);
  return value <= 9_223_372_036_854_775_807n ? value : null;
}

/** Reads current DB prices/limits and VAT before applying the pure calculation rules. */
@Injectable()
export class ElectricityCalculationService {
  constructor(private readonly vat: VatCalculationRepository) {}

  async calculate(
    executor: DbExecutor,
    input: {
      mode: 'simple' | 'advanced';
      period: ElectricityPeriod;
      totalKwh?: bigint;
      quantities?: Partial<Record<ElectricitySystemKey, bigint>>;
    },
    settings: GreenElectricityConfig,
    gift?: ElectricityGiftDiscount,
    at: Date = new Date()
  ): Promise<
    | Extract<CompositionResult, { ok: false }>
    | {
        ok: true;
        composition: Extract<CompositionResult, { ok: true }>;
        totals: ReturnType<typeof calculateElectricityTotals>;
      }
  > {
    const result = await executor.query<{
      id: string;
      system_key: ElectricitySystemKey;
      status: string;
      price: string | null;
      min_kwh: string | null;
      max_kwh: string | null;
    }>(
      `SELECT p.id, p.system_key, p.status,
              effective_product_price(p.id, $1) AS price,
              l.min_kwh, l.max_kwh
         FROM products p
         LEFT JOIN electricity_product_limits l ON l.product_id=p.id
        WHERE p.type='electricity' AND p.system_key=ANY($2::text[])
        FOR SHARE OF p`,
      [at, keys]
    );
    const products: ElectricityProductInput[] = [];
    for (const row of result.rows) {
      if (!keys.includes(row.system_key)) continue;
      const price = nonnegativeInt8(row.price);
      const minKwh = nonnegativeInt8(row.min_kwh ?? '0');
      const maxKwh = nonnegativeInt8(row.max_kwh ?? '0');
      if (minKwh === null || maxKwh === null) continue;
      products.push({
        id: row.id,
        systemKey: row.system_key,
        status: row.status,
        unitPriceIrR: price,
        minKwh,
        maxKwh,
        vatRateBasisPoints: 0,
        vatSource: 'fallback_zero',
      });
    }
    const green = products.find((product) => product.systemKey === 'green');
    const safety = evaluateGreenRuleEnforcement(
      settings,
      input.mode === 'simple' ? 'simpleOrder' : 'advancedOrder',
      {
        exists: green !== undefined,
        status:
          green?.status === 'active' || green?.status === 'inactive' || green?.status === 'archived'
            ? green.status
            : null,
        priceIrR: green?.unitPriceIrR && green.unitPriceIrR > 0n ? 1 : null,
      }
    );
    if (safety.blocked) {
      return { ok: false, errors: [{ code: 'GREEN_RULE_UNAVAILABLE', systemKey: 'green' }] };
    }
    const composition = validateOrderComposition(input, settings, products);
    if (!composition.ok) return composition;
    const pricedLines: ElectricityLine[] = [];
    for (const line of composition.lines) {
      const rate = await this.vat.resolveRate(executor, {
        productId: line.productId,
        category: categories[line.systemKey],
        at,
      });
      const fallback =
        rate.source === 'fallback_zero'
          ? await this.vat.resolveRate(executor, { category: 'electricity', at })
          : rate;
      pricedLines.push({
        ...line,
        vatRateBasisPoints: fallback.rateBasisPoints,
        vatSource: fallback.source,
      });
    }
    const pricedComposition = { ...composition, lines: pricedLines };
    return {
      ok: true,
      composition: pricedComposition,
      totals: calculateElectricityTotals(pricedLines, gift),
    };
  }
}
