import type { PoolClient } from 'pg';
import type { ElectricityPeriod } from './electricity-periods.js';
import {
  calculateDuration,
  electricitySubmissionSnapshot,
  type CompositionResult,
  type ElectricityGiftDiscount,
  type calculateElectricityTotals,
} from './electricity-calculation.js';

/**
 * Transaction-owned persistence seam for a confirmed electricity draft.
 * The caller owns BEGIN/COMMIT and locks the parent order before invoking it.
 * Batch 3 uses this together with contract and invoice creation in one transaction.
 */
export async function persistElectricitySubmissionSnapshot(
  client: Pick<PoolClient, 'query'>,
  orderId: string,
  period: ElectricityPeriod,
  composition: Extract<CompositionResult, { ok: true }>,
  totals: ReturnType<typeof calculateElectricityTotals>,
  gift: ElectricityGiftDiscount | undefined,
  submittedAt: Date
): Promise<Record<string, unknown>> {
  if (!orderId || !Number.isFinite(submittedAt.getTime())) {
    throw new RangeError('Order and submission time are required');
  }
  const duration = calculateDuration(period.start, period.end);
  if (
    duration.milliseconds !== composition.durationMs ||
    composition.totalKwh !== totals.lines.reduce((sum, line) => sum + line.quantityKwh, 0n) ||
    totals.lines.length !== composition.lines.length ||
    totals.lines.some(
      (line, index) =>
        line.productId !== composition.lines[index]?.productId ||
        line.quantityKwh !== composition.lines[index]?.quantityKwh ||
        line.unitPriceIrR !== composition.lines[index]?.unitPriceIrR
    )
  ) {
    throw new RangeError(
      'Submission calculation does not match the selected period or composition'
    );
  }
  const snapshot = electricitySubmissionSnapshot(composition, totals, gift, period, submittedAt);
  const result = await client.query(
    `UPDATE electricity_orders
        SET status='submitted', period_start=$2, period_end=$3, submitted_at=$4,
            pricing_snapshot=$5::jsonb, updated_at=NOW()
      WHERE id=$1 AND status='draft' AND pricing_snapshot IS NULL
      RETURNING id`,
    [orderId, period.start, period.end, submittedAt, JSON.stringify(snapshot)]
  );
  if (result.rows.length !== 1) throw new Error('Electricity draft is unavailable for submission');
  return snapshot;
}
