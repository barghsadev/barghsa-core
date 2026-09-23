import { ConflictException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { PoolClient } from 'pg';

/** Caller holds the profile and invoice locks and commits the terminal order state
 * in the same transaction. The existing refund worker owns the wallet credit. */
export async function createElectricityRefundObligation(
  client: PoolClient,
  input: {
    orderId: string;
    contractId: string;
    invoiceId: string;
    profileId: string;
    paidAmount: string;
    refundedAmount: string;
    authorizedBy: string;
    reason: string;
  }
): Promise<string | null> {
  const paid = BigInt(input.paidAmount);
  const refunded = BigInt(input.refundedAmount);
  if (paid < refunded) throw new ConflictException('Invoice refund totals are invalid');
  const reserved = BigInt(
    (
      await client.query<{ amount: string }>(
        `SELECT COALESCE(SUM(amount),0)::text AS amount FROM refunds
         WHERE invoice_id=$1 AND state NOT IN ('Completed','Rejected','Cancelled')`,
        [input.invoiceId]
      )
    ).rows[0]!.amount
  );
  if (reserved > 0n) throw new ConflictException('Resolve existing refund before ending the order');
  if (paid === refunded) return null;
  const refundId = uuidv7();
  const amount = (paid - refunded).toString();
  await client.query(
    `INSERT INTO refunds(id,invoice_id,profile_id,amount,destination,idempotency_key)
     VALUES($1,$2,$3,$4,'wallet',$5)`,
    [
      refundId,
      input.invoiceId,
      input.profileId,
      amount,
      `electricity-end:${input.orderId}:${input.invoiceId}`,
    ]
  );
  await client.query(
    `INSERT INTO refund_obligations(id,order_id,contract_id,invoice_id,profile_id,
       refund_id,total_paid_amount,completed_refund_amount,idempotency_key,
       authorized_by,reason)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      uuidv7(),
      input.orderId,
      input.contractId,
      input.invoiceId,
      input.profileId,
      refundId,
      paid.toString(),
      refunded.toString(),
      `electricity-end:${input.orderId}`,
      input.authorizedBy,
      input.reason,
    ]
  );
  await client.query("UPDATE refunds SET state='Approved' WHERE id=$1", [refundId]);
  await client.query("UPDATE refunds SET state='Processing' WHERE id=$1", [refundId]);
  await client.query('INSERT INTO refund_retry_jobs(refund_id,executor_user_id) VALUES($1,$2)', [
    refundId,
    input.authorizedBy,
  ]);
  return refundId;
}
