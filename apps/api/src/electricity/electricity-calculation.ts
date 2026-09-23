import type { GreenElectricityConfig } from '@barghsa/shared/finance';
import { computeGiftDiscount } from '@barghsa/shared/promotions';
import type { ElectricityPeriod } from './electricity-periods.js';

export type ElectricitySystemKey = 'thermal' | 'green' | 'free_market' | 'energy_saving';

export interface ElectricityProductInput {
  id: string;
  systemKey: ElectricitySystemKey;
  status: string;
  unitPriceIrR: bigint | null;
  minKwh: bigint;
  maxKwh: bigint;
  vatRateBasisPoints: number;
  vatSource: 'product_override' | 'category' | 'fallback_zero';
}

export interface ElectricityLine {
  productId: string;
  systemKey: ElectricitySystemKey;
  quantityKwh: bigint;
  unitPriceIrR: bigint;
  minKwh?: bigint;
  maxKwh?: bigint;
  subtotalIrR: bigint;
  vatRateBasisPoints: number;
  vatSource: ElectricityProductInput['vatSource'];
}

export interface CompositionError {
  code:
    | 'INVALID_PERIOD'
    | 'INVALID_QUANTITY'
    | 'PRODUCT_UNAVAILABLE'
    | 'PRODUCT_MIN_KWH'
    | 'PRODUCT_MAX_KWH'
    | 'GREEN_RULE_UNAVAILABLE'
    | 'AMOUNT_OVERFLOW'
    | 'GREEN_NOT_EDITABLE'
    | 'GREEN_PERCENTAGE_UNSATISFIABLE';
  systemKey?: ElectricitySystemKey;
  requiredKwh?: string;
  limitKwh?: string;
}

export type CompositionResult =
  | { ok: false; errors: CompositionError[] }
  | {
      ok: true;
      lines: ElectricityLine[];
      totalKwh: bigint;
      durationMs: bigint;
      durationHours: string;
      averagePowerKw: string;
      greenRuleApplies: boolean;
      requiredGreenKwh: bigint;
    };

const HOUR_MS = 3_600_000n;
const MAX_INT8 = 9_223_372_036_854_775_807n;
const SYSTEM_KEYS: ElectricitySystemKey[] = ['thermal', 'green', 'free_market', 'energy_saving'];

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new RangeError('Invalid division');
  return (2n * numerator + denominator) / (2n * denominator);
}

function divideCeil(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new RangeError('Invalid division');
  return (numerator + denominator - 1n) / denominator;
}

function decimal(numerator: bigint, denominator: bigint, places = 9): string {
  const scale = 10n ** BigInt(places);
  const scaled = divideHalfUp(numerator * scale, denominator);
  const whole = scaled / scale;
  const fraction = (scaled % scale).toString().padStart(places, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Exact duration is milliseconds / 3,600,000 hours; the string is display-rounded. */
export function calculateDuration(start: Date, end: Date): { milliseconds: bigint; hours: string } {
  const from = start?.getTime();
  const to = end?.getTime();
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to <= from) {
    throw new RangeError('Delivery period must have a finite positive duration');
  }
  const milliseconds = BigInt(to - from);
  return { milliseconds, hours: decimal(milliseconds, HOUR_MS) };
}

/** Uses the exact millisecond duration; no rounded display value enters the division. */
export function calculateAveragePower(totalKwh: bigint, durationMs: bigint): string {
  if (totalKwh < 0n || durationMs <= 0n) throw new RangeError('Invalid energy or duration');
  return decimal(totalKwh * HOUR_MS, durationMs);
}

export function calculateLineTotal(quantityKwh: bigint, unitPriceIrR: bigint): bigint {
  if (quantityKwh < 0n || unitPriceIrR < 0n)
    throw new RangeError('Quantity and price must be non-negative');
  return quantityKwh * unitPriceIrR;
}

/** Convert the persisted decimal percentage to an exact ratio, including exponent notation. */
function percentRatio(percent: number): { numerator: bigint; denominator: bigint } {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new RangeError('Green percentage must be between 0 and 100');
  }
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(percent.toString());
  if (!match) throw new RangeError('Invalid green percentage');
  const digits = `${match[1]}${match[2] ?? ''}`;
  const exponent = Number(match[3] ?? 0) - (match[2]?.length ?? 0);
  return exponent >= 0
    ? { numerator: BigInt(digits) * 10n ** BigInt(exponent), denominator: 100n }
    : { numerator: BigInt(digits), denominator: 100n * 10n ** BigInt(-exponent) };
}

export function checkGreenRule(input: {
  enabled: boolean;
  thresholdKw: number;
  minGreenPercentage: number;
  totalKwh: bigint;
  durationMs: bigint;
}): { applies: boolean; requiredGreenKwh: bigint } {
  const { enabled, thresholdKw, minGreenPercentage, totalKwh, durationMs } = input;
  if (totalKwh < 0n || durationMs <= 0n || !Number.isSafeInteger(thresholdKw) || thresholdKw < 0) {
    throw new RangeError('Invalid green-rule input');
  }
  const percentage = percentRatio(minGreenPercentage);
  const applies = enabled && totalKwh * HOUR_MS > BigInt(thresholdKw) * durationMs;
  return {
    applies,
    requiredGreenKwh: applies
      ? divideCeil(totalKwh * percentage.numerator, percentage.denominator)
      : 0n,
  };
}

export function validateProductLimit(
  quantityKwh: bigint,
  product: ElectricityProductInput
): CompositionError[] {
  if (quantityKwh < 0n || product.minKwh < 0n || product.maxKwh < 0n) {
    return [{ code: 'INVALID_QUANTITY', systemKey: product.systemKey }];
  }
  if (quantityKwh === 0n) return [];
  const errors: CompositionError[] = [];
  if (product.minKwh > 0n && quantityKwh < product.minKwh) {
    errors.push({
      code: 'PRODUCT_MIN_KWH',
      systemKey: product.systemKey,
      requiredKwh: product.minKwh.toString(),
    });
  }
  if (product.maxKwh > 0n && quantityKwh > product.maxKwh) {
    errors.push({
      code: 'PRODUCT_MAX_KWH',
      systemKey: product.systemKey,
      requiredKwh: quantityKwh.toString(),
      limitKwh: product.maxKwh.toString(),
    });
  }
  return errors;
}

export function validateOrderComposition(
  input: {
    mode: 'simple' | 'advanced';
    period: ElectricityPeriod;
    totalKwh?: bigint;
    quantities?: Partial<Record<ElectricitySystemKey, bigint>>;
  },
  settings: GreenElectricityConfig,
  products: ElectricityProductInput[]
): CompositionResult {
  let duration: ReturnType<typeof calculateDuration>;
  try {
    duration = calculateDuration(input.period.start, input.period.end);
  } catch {
    return { ok: false, errors: [{ code: 'INVALID_PERIOD' }] };
  }
  const byKey = new Map(products.map((product) => [product.systemKey, product]));
  const quantities: Partial<Record<ElectricitySystemKey, bigint>> = {};
  if (input.mode === 'simple') {
    if (typeof input.totalKwh !== 'bigint' || input.totalKwh <= 0n) {
      return { ok: false, errors: [{ code: 'INVALID_QUANTITY' }] };
    }
    quantities.thermal = input.totalKwh;
  } else {
    for (const systemKey of SYSTEM_KEYS) {
      const value = input.quantities?.[systemKey] ?? 0n;
      if (typeof value !== 'bigint' || value < 0n) {
        return { ok: false, errors: [{ code: 'INVALID_QUANTITY', systemKey }] };
      }
      quantities[systemKey] = value;
    }
    if (SYSTEM_KEYS.every((key) => quantities[key] === 0n)) {
      return { ok: false, errors: [{ code: 'INVALID_QUANTITY' }] };
    }
  }

  const config = input.mode === 'simple' ? settings.simpleOrder : settings.advancedOrder;
  if (input.mode === 'advanced' && config.mandatoryGreenEnabled && (quantities.green ?? 0n) > 0n) {
    return { ok: false, errors: [{ code: 'GREEN_NOT_EDITABLE', systemKey: 'green' }] };
  }
  const baseTotal = SYSTEM_KEYS.reduce(
    (sum, key) =>
      sum +
      (key === 'green' && input.mode === 'advanced' && config.mandatoryGreenEnabled
        ? 0n
        : (quantities[key] ?? 0n)),
    0n
  );
  const rule = checkGreenRule({
    enabled: config.mandatoryGreenEnabled,
    thresholdKw: config.averagePowerThresholdKw,
    minGreenPercentage: config.mandatoryGreenSharePercent,
    totalKwh: input.mode === 'advanced' ? (quantities.thermal ?? 0n) : baseTotal,
    durationMs: duration.milliseconds,
  });
  let requiredGreenKwh = 0n;
  if (rule.applies) {
    const percent = percentRatio(config.mandatoryGreenSharePercent);
    if (input.mode === 'simple') {
      requiredGreenKwh = rule.requiredGreenKwh;
      quantities.thermal = input.totalKwh! - requiredGreenKwh;
      quantities.green = requiredGreenKwh;
    } else {
      if (
        (percent.numerator > 0n && (quantities.thermal ?? 0n) === 0n) ||
        percent.numerator >= percent.denominator
      ) {
        return {
          ok: false,
          errors: [{ code: 'GREEN_PERCENTAGE_UNSATISFIABLE', systemKey: 'green' }],
        };
      }
      requiredGreenKwh =
        percent.numerator === 0n
          ? 0n
          : divideCeil(
              (quantities.thermal ?? 0n) * percent.numerator,
              percent.denominator - percent.numerator
            );
      quantities.green = requiredGreenKwh;
    }
  }

  const errors: CompositionError[] = [];
  const lines: ElectricityLine[] = [];
  for (const systemKey of SYSTEM_KEYS) {
    const quantity = quantities[systemKey] ?? 0n;
    if (quantity === 0n) continue;
    if (quantity > MAX_INT8) {
      errors.push({ code: 'INVALID_QUANTITY', systemKey });
      continue;
    }
    const product = byKey.get(systemKey);
    if (
      !product ||
      product.status !== 'active' ||
      product.unitPriceIrR === null ||
      product.unitPriceIrR <= 0n
    ) {
      errors.push({ code: 'PRODUCT_UNAVAILABLE', systemKey });
      continue;
    }
    errors.push(...validateProductLimit(quantity, product));
    if (
      !Number.isInteger(product.vatRateBasisPoints) ||
      product.vatRateBasisPoints < 0 ||
      product.vatRateBasisPoints > 10_000
    ) {
      errors.push({ code: 'PRODUCT_UNAVAILABLE', systemKey });
      continue;
    }
    const subtotalIrR = calculateLineTotal(quantity, product.unitPriceIrR);
    if (subtotalIrR > MAX_INT8) {
      errors.push({ code: 'AMOUNT_OVERFLOW', systemKey });
      continue;
    }
    lines.push({
      productId: product.id,
      systemKey,
      quantityKwh: quantity,
      unitPriceIrR: product.unitPriceIrR,
      minKwh: product.minKwh,
      maxKwh: product.maxKwh,
      subtotalIrR,
      vatRateBasisPoints: product.vatRateBasisPoints,
      vatSource: product.vatSource,
    });
  }
  if (errors.length) return { ok: false, errors };
  const totalKwh = lines.reduce((sum, line) => sum + line.quantityKwh, 0n);
  if (totalKwh > MAX_INT8) return { ok: false, errors: [{ code: 'INVALID_QUANTITY' }] };
  return {
    ok: true,
    lines,
    totalKwh,
    durationMs: duration.milliseconds,
    durationHours: duration.hours,
    averagePowerKw: calculateAveragePower(totalKwh, duration.milliseconds),
    greenRuleApplies: rule.applies,
    requiredGreenKwh,
  };
}

export type ElectricityGiftDiscount =
  | { type: 'fixed_irr'; value: bigint }
  | { type: 'percentage'; basisPoints: number; maxCapIrR: bigint };

export function calculateElectricityTotals(
  lines: ElectricityLine[],
  gift?: ElectricityGiftDiscount
): {
  lines: Array<ElectricityLine & { discountIrR: bigint; netIrR: bigint; vatIrR: bigint }>;
  subtotalIrR: bigint;
  discountIrR: bigint;
  vatIrR: bigint;
  totalIrR: bigint;
} {
  if (lines.length === 0) throw new RangeError('At least one electricity line is required');
  for (const line of lines) {
    if (
      line.subtotalIrR !== calculateLineTotal(line.quantityKwh, line.unitPriceIrR) ||
      !Number.isInteger(line.vatRateBasisPoints) ||
      line.vatRateBasisPoints < 0 ||
      line.vatRateBasisPoints > 10_000
    ) {
      throw new RangeError('Invalid electricity line snapshot');
    }
  }
  const subtotalIrR = lines.reduce((sum, line) => sum + line.subtotalIrR, 0n);
  if (subtotalIrR <= 0n) throw new RangeError('Electricity subtotal must be positive');
  if (subtotalIrR > MAX_INT8)
    throw new RangeError('Electricity subtotal exceeds supported IRR range');
  let discountIrR = 0n;
  if (gift?.type === 'fixed_irr') {
    if (gift.value < 0n) throw new RangeError('Invalid gift discount');
    discountIrR = BigInt(
      computeGiftDiscount({
        discountType: 'fixed_irr',
        discountValue: gift.value,
        maxCapIrr: null,
        orderAmount: subtotalIrR,
      })
    );
  } else if (gift?.type === 'percentage') {
    if (
      !Number.isInteger(gift.basisPoints) ||
      gift.basisPoints < 0 ||
      gift.basisPoints > 10_000 ||
      gift.maxCapIrR <= 0n
    ) {
      throw new RangeError('Invalid gift discount');
    }
    discountIrR = BigInt(
      computeGiftDiscount({
        discountType: 'percentage',
        discountValue: BigInt(gift.basisPoints),
        maxCapIrr: gift.maxCapIrR,
        orderAmount: subtotalIrR,
      })
    );
  }
  if (discountIrR > subtotalIrR) discountIrR = subtotalIrR;
  const allocations = lines.map((line) => (line.subtotalIrR * discountIrR) / subtotalIrR);
  let remaining = discountIrR - allocations.reduce((sum, value) => sum + value, 0n);
  const priority = lines
    .map((line, index) => ({ index, remainder: (line.subtotalIrR * discountIrR) % subtotalIrR }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1
    );
  for (const { index } of priority) {
    if (remaining === 0n) break;
    if (allocations[index]! < lines[index]!.subtotalIrR) {
      allocations[index]! += 1n;
      remaining--;
    }
  }
  const priced = lines.map((line, index) => {
    const lineDiscount = allocations[index]!;
    const netIrR = line.subtotalIrR - lineDiscount;
    return {
      ...line,
      discountIrR: lineDiscount,
      netIrR,
      vatIrR: divideHalfUp(netIrR * BigInt(line.vatRateBasisPoints), 10_000n),
    };
  });
  const vatIrR = priced.reduce((sum, line) => sum + line.vatIrR, 0n);
  if (subtotalIrR - discountIrR + vatIrR > MAX_INT8) {
    throw new RangeError('Electricity total exceeds supported IRR range');
  }
  return {
    lines: priced,
    subtotalIrR,
    discountIrR,
    vatIrR,
    totalIrR: subtotalIrR - discountIrR + vatIrR,
  };
}

/** JSON-safe immutable inputs for the order, contract and invoice at submission. */
export function electricitySubmissionSnapshot(
  composition: Extract<CompositionResult, { ok: true }>,
  totals: ReturnType<typeof calculateElectricityTotals>,
  gift: ElectricityGiftDiscount | undefined,
  period: ElectricityPeriod,
  submittedAt: Date
) {
  return {
    schemaVersion: 1,
    submittedAt: submittedAt.toISOString(),
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    durationMs: composition.durationMs.toString(),
    totalKwh: composition.totalKwh.toString(),
    greenRuleApplies: composition.greenRuleApplies,
    requiredGreenKwh: composition.requiredGreenKwh.toString(),
    gift:
      gift?.type === 'fixed_irr'
        ? { type: gift.type, valueIrR: gift.value.toString() }
        : gift
          ? { type: gift.type, basisPoints: gift.basisPoints, maxCapIrR: gift.maxCapIrR.toString() }
          : null,
    lines: totals.lines.map((line, index) => {
      const source = composition.lines[index];
      return {
        productId: line.productId,
        systemKey: line.systemKey,
        quantityKwh: line.quantityKwh.toString(),
        unitPriceIrR: line.unitPriceIrR.toString(),
        ...(source?.minKwh !== undefined ? { minKwh: source.minKwh.toString() } : {}),
        ...(source?.maxKwh !== undefined ? { maxKwh: source.maxKwh.toString() } : {}),
        subtotalIrR: line.subtotalIrR.toString(),
        discountIrR: line.discountIrR.toString(),
        netIrR: line.netIrR.toString(),
        vatRateBasisPoints: line.vatRateBasisPoints,
        vatSource: line.vatSource,
        vatIrR: line.vatIrR.toString(),
      };
    }),
    subtotalIrR: totals.subtotalIrR.toString(),
    discountIrR: totals.discountIrR.toString(),
    vatIrR: totals.vatIrR.toString(),
    totalIrR: totals.totalIrR.toString(),
  };
}
