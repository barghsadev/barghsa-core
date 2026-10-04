import type { ElectricityPriceAdjustmentCalculation } from '@barghsa/shared/finance';
export type { ElectricityPriceAdjustmentCalculation } from '@barghsa/shared/finance';

export interface ElectricityPriceAdjustmentRow {
  adjustmentId: string;
  contractId: string;
  status: 'proposed' | 'finalized' | 'cancelled';
  effectiveFrom: string;
  periodEnd: string;
  percentageBps: string;
  reason: string;
  contractualBasis: string;
  calculation: ElectricityPriceAdjustmentCalculation;
  calculationSha256: string;
  adjustmentAmountIrR: string;
  adjustmentInvoiceId: string | null;
  adjustmentInvoiceState: string | null;
  proposedAt: string;
  finalizedAt: string | null;
  cancelledAt: string | null;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const amount = (value: unknown): value is string =>
  typeof value === 'string' && /^-?(0|[1-9]\d*)$/.test(value);
const unsigned = (value: unknown): value is string =>
  typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
const instant = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
  Number.isFinite(Date.parse(value));
const text = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const componentKeys = [
  'source',
  'invoiceId',
  'basisIrR',
  'periodStart',
  'periodEnd',
  'eligibleFrom',
  'oldFutureIrR',
  'changeIrR',
  'newFutureIrR',
  'remainingMs',
  'periodMs',
] as const;
type Component = ElectricityPriceAdjustmentCalculation['quote']['components'][number];
function component(value: unknown): value is Component {
  if (
    !record(value) ||
    !['original_invoice', 'quantity_increase', 'price_adjustment'].includes(String(value.source)) ||
    !uuid(value.invoiceId) ||
    !amount(value.basisIrR) ||
    BigInt(value.basisIrR) === 0n ||
    !amount(value.oldFutureIrR) ||
    !amount(value.changeIrR) ||
    !amount(value.newFutureIrR) ||
    !instant(value.periodStart) ||
    !instant(value.periodEnd) ||
    !instant(value.eligibleFrom) ||
    !unsigned(value.remainingMs) ||
    !unsigned(value.periodMs)
  )
    return false;
  const start = Date.parse(value.periodStart),
    end = Date.parse(value.periodEnd);
  const eligible = Date.parse(value.eligibleFrom);
  return (
    start < end &&
    eligible >= start &&
    BigInt(value.periodMs) === BigInt(end - start) &&
    BigInt(value.remainingMs) === BigInt(Math.max(0, end - eligible)) &&
    BigInt(value.oldFutureIrR) + BigInt(value.changeIrR) === BigInt(value.newFutureIrR)
  );
}
function calculation(value: unknown): value is ElectricityPriceAdjustmentCalculation {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !uuid(value.contractId) ||
    !uuid(value.versionId) ||
    !uuid(value.originalInvoiceId) ||
    !text(value.reason, 1000) ||
    !text(value.contractualBasis, 2000) ||
    !record(value.quote)
  )
    return false;
  const quote = value.quote;
  if (
    !amount(quote.amountIrR) ||
    !amount(quote.oldFutureIrR) ||
    !amount(quote.newFutureIrR) ||
    !amount(quote.percentageBps) ||
    !instant(quote.effectiveFrom) ||
    quote.rounding !== 'half-up-to-nearest-IRR' ||
    !Array.isArray(quote.components) ||
    !quote.components.length ||
    !quote.components.every(component)
  )
    return false;
  const components = quote.components;
  const first = components[0];
  if (!first) return false;
  const total = (key: 'oldFutureIrR' | 'changeIrR' | 'newFutureIrR') =>
    components.reduce((sum: bigint, item: Component) => sum + BigInt(item[key]), 0n);
  return (
    first.source === 'original_invoice' &&
    first.invoiceId === value.originalInvoiceId &&
    BigInt(quote.percentageBps) !== 0n &&
    BigInt(quote.percentageBps) > -10_000n &&
    BigInt(quote.percentageBps) <= 9_223_372_036_854_775_807n &&
    BigInt(quote.newFutureIrR) > 0n &&
    BigInt(quote.oldFutureIrR) + BigInt(quote.amountIrR) === BigInt(quote.newFutureIrR) &&
    total('oldFutureIrR') === BigInt(quote.oldFutureIrR) &&
    total('changeIrR') === BigInt(quote.amountIrR) &&
    total('newFutureIrR') === BigInt(quote.newFutureIrR) &&
    (quote.kind === 'charge'
      ? BigInt(quote.amountIrR) > 0n
      : quote.kind === 'credit' && BigInt(quote.amountIrR) < 0n)
  );
}
function row(value: unknown): value is ElectricityPriceAdjustmentRow {
  if (
    !record(value) ||
    !uuid(value.adjustmentId) ||
    !uuid(value.contractId) ||
    !['proposed', 'finalized', 'cancelled'].includes(String(value.status)) ||
    !instant(value.effectiveFrom) ||
    !instant(value.periodEnd) ||
    Date.parse(value.effectiveFrom) >= Date.parse(value.periodEnd) ||
    !amount(value.percentageBps) ||
    !text(value.reason, 1000) ||
    !text(value.contractualBasis, 2000) ||
    !calculation(value.calculation) ||
    typeof value.calculationSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.calculationSha256) ||
    !amount(value.adjustmentAmountIrR) ||
    !instant(value.proposedAt) ||
    !(value.finalizedAt === null || instant(value.finalizedAt)) ||
    !(value.cancelledAt === null || instant(value.cancelledAt)) ||
    !(value.adjustmentInvoiceId === null || uuid(value.adjustmentInvoiceId)) ||
    !(value.adjustmentInvoiceState === null || typeof value.adjustmentInvoiceState === 'string')
  )
    return false;
  const quote = value.calculation.quote;
  return (
    value.calculation.contractId === value.contractId &&
    value.calculation.reason === value.reason &&
    value.calculation.contractualBasis === value.contractualBasis &&
    quote.effectiveFrom === value.effectiveFrom &&
    quote.percentageBps === value.percentageBps &&
    quote.amountIrR === value.adjustmentAmountIrR &&
    (value.status === 'finalized'
      ? value.adjustmentInvoiceId !== null &&
        text(value.adjustmentInvoiceState, 100) &&
        instant(value.finalizedAt) &&
        value.cancelledAt === null
      : value.adjustmentInvoiceId === null &&
        value.adjustmentInvoiceState === null &&
        value.finalizedAt === null &&
        (value.status === 'cancelled' ? instant(value.cancelledAt) : value.cancelledAt === null))
  );
}
export function parseElectricityPriceAdjustmentRow(
  value: unknown
): ElectricityPriceAdjustmentRow | null {
  return row(value) ? value : null;
}
/** JSONB can reorder object keys; array order and every calculation primitive remain significant. */
export function sameElectricityPriceCalculation(
  actual: ElectricityPriceAdjustmentCalculation,
  expected: ElectricityPriceAdjustmentCalculation
) {
  const keys = [
    'schemaVersion',
    'contractId',
    'versionId',
    'originalInvoiceId',
    'reason',
    'contractualBasis',
  ] as const;
  const quoteKeys = [
    'amountIrR',
    'oldFutureIrR',
    'newFutureIrR',
    'kind',
    'percentageBps',
    'effectiveFrom',
    'rounding',
  ] as const;
  return (
    keys.every((key) => actual[key] === expected[key]) &&
    quoteKeys.every((key) => actual.quote[key] === expected.quote[key]) &&
    actual.quote.components.length === expected.quote.components.length &&
    expected.quote.components.every((item, index) =>
      componentKeys.every((key) => actual.quote.components[index]![key] === item[key])
    )
  );
}
