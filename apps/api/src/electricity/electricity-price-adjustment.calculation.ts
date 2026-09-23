import { BadRequestException, ConflictException } from '@nestjs/common';

export interface ElectricityPriceComponent {
  source: 'original_invoice' | 'quantity_increase' | 'price_adjustment';
  invoiceId: string;
  amountIrR: bigint;
  periodStart: Date;
  periodEnd: Date;
}

const MAX_IRR = 9_223_372_036_854_775_807n;

function roundSigned(numerator: bigint, denominator: bigint) {
  const absolute = numerator < 0n ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return numerator < 0n ? -rounded : rounded;
}

/** Price only delivery after the effective date. A component is billed over its own term. */
export function calculateElectricityPriceAdjustment(
  components: ElectricityPriceComponent[],
  effectiveFrom: Date,
  percentageBps: bigint
) {
  if (percentageBps === 0n || percentageBps <= -10_000n || percentageBps > MAX_IRR)
    throw new BadRequestException('Price change percentage is outside the allowed range');
  if (!Number.isFinite(effectiveFrom.getTime()))
    throw new BadRequestException('Invalid price adjustment effective date');
  if (components.length === 0) throw new ConflictException('No paid electricity price basis');

  let amountIrR = 0n;
  let oldFutureIrR = 0n;
  const calculation = components.map((component) => {
    const start = component.periodStart.getTime();
    const end = component.periodEnd.getTime();
    const eligibleStart = Math.max(start, effectiveFrom.getTime());
    if (
      component.amountIrR === 0n ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start
    )
      throw new ConflictException('Invalid paid electricity price basis');
    const remainingMs = BigInt(Math.max(0, end - eligibleStart));
    const periodMs = BigInt(end - start);
    const componentFutureIrR = roundSigned(component.amountIrR * remainingMs, periodMs);
    const changeIrR = roundSigned(
      component.amountIrR * percentageBps * remainingMs,
      10_000n * periodMs
    );
    amountIrR += changeIrR;
    oldFutureIrR += componentFutureIrR;
    return {
      source: component.source,
      invoiceId: component.invoiceId,
      basisIrR: component.amountIrR.toString(),
      periodStart: component.periodStart.toISOString(),
      periodEnd: component.periodEnd.toISOString(),
      eligibleFrom: new Date(eligibleStart).toISOString(),
      oldFutureIrR: componentFutureIrR.toString(),
      changeIrR: changeIrR.toString(),
      newFutureIrR: (componentFutureIrR + changeIrR).toString(),
      remainingMs: remainingMs.toString(),
      periodMs: periodMs.toString(),
    };
  });
  if (oldFutureIrR + amountIrR <= 0n)
    throw new ConflictException('Price change would leave no positive future price');
  if (amountIrR === 0n || amountIrR > MAX_IRR || amountIrR < -MAX_IRR)
    throw new ConflictException('Price adjustment is not payable or exceeds the IRR limit');
  return {
    amountIrR,
    oldFutureIrR,
    newFutureIrR: oldFutureIrR + amountIrR,
    kind: amountIrR > 0n ? ('charge' as const) : ('credit' as const),
    percentageBps: percentageBps.toString(),
    effectiveFrom: effectiveFrom.toISOString(),
    rounding: 'half-up-to-nearest-IRR' as const,
    components: calculation,
  };
}
