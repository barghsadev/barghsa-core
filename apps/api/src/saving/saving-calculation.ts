import { BadRequestException } from '@nestjs/common';

export interface SavingPriceLine {
  type: 'plan_price' | 'hardware_price';
  productId: string;
  title: { fa: string; en: string };
  amountIrR: bigint;
  vatRateBps: number;
}

const MAX_IRR = 9_223_372_036_854_775_807n;

/** Allocate the one order discount by exact fractional remainder, then tax each net line. */
export function calculateSavingTotals(
  lines: [SavingPriceLine, SavingPriceLine],
  discountIrR: bigint
) {
  const subtotalIrR = lines.reduce((sum, line) => sum + line.amountIrR, 0n);
  if (
    lines.some(
      (line) =>
        line.amountIrR <= 0n ||
        line.amountIrR > MAX_IRR ||
        !Number.isInteger(line.vatRateBps) ||
        line.vatRateBps < 0 ||
        line.vatRateBps > 10_000
    ) ||
    subtotalIrR > MAX_IRR ||
    discountIrR < 0n ||
    discountIrR > subtotalIrR
  )
    throw new BadRequestException('Invalid saving order price or discount');

  const allocations = lines.map((line) => (line.amountIrR * discountIrR) / subtotalIrR);
  let remaining = discountIrR - allocations.reduce((sum, amount) => sum + amount, 0n);
  const priority = lines
    .map((line, index) => ({ index, remainder: (line.amountIrR * discountIrR) % subtotalIrR }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1
    );
  for (const { index } of priority) {
    if (remaining === 0n) break;
    allocations[index]! += 1n;
    remaining--;
  }
  const priced = lines.map((line, index) => {
    const lineDiscountIrR = allocations[index]!;
    const netIrR = line.amountIrR - lineDiscountIrR;
    const vatIrR = (netIrR * BigInt(line.vatRateBps) + 5_000n) / 10_000n;
    return {
      ...line,
      discountIrR: lineDiscountIrR,
      netIrR,
      vatIrR,
    };
  });
  const vatIrR = priced.reduce((sum, line) => sum + line.vatIrR, 0n);
  const totalIrR = subtotalIrR - discountIrR + vatIrR;
  if (totalIrR <= 0n || totalIrR > MAX_IRR)
    throw new BadRequestException('Saving order total is outside the payable range');
  return { lines: priced, subtotalIrR, discountIrR, vatIrR, totalIrR };
}
