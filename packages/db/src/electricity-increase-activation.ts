import type { Pool } from 'pg';

/** Activate signed increases whose adjustment was paid and start date has arrived. */
export async function activateDueElectricityIncreases(pool: Pool, limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new RangeError('Invalid electricity increase batch size');
  const due = await pool.query<{ id: string }>(
    `SELECT r.id FROM electricity_quantity_increase_requests r
     JOIN invoices i ON i.id=r.adjustment_invoice_id
     JOIN contracts c ON c.id=r.contract_id
     WHERE r.status='awaiting_payment' AND r.effective_from<=statement_timestamp()
       AND (r.pricing_snapshot->>'eligibleFrom')::timestamptz<=statement_timestamp()
       AND r.period_end>statement_timestamp() AND c.state='Active'
       AND i.state='Paid' AND i.paid_amount>=i.total_amount AND i.refunded_amount=0
     ORDER BY r.effective_from,r.id LIMIT $1`,
    [limit]
  );
  let activated = 0;
  let skipped = 0;
  for (const row of due.rows) {
    const result = await pool.query<{ activated: boolean }>(
      'SELECT finalize_paid_electricity_increase($1) AS activated',
      [row.id]
    );
    if (result.rows[0]?.activated) activated++;
    else skipped++;
  }
  return { activated, skipped };
}

/** Expire unfulfilled requests and cancel only invoices with no confirmed payment. */
export async function expireDueElectricityIncreases(pool: Pool, limit = 100) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new RangeError('Invalid electricity increase batch size');
  const due = await pool.query<{ id: string }>(
    `SELECT id FROM electricity_quantity_increase_requests
     WHERE status IN ('pending','awaiting_signature','awaiting_payment')
       AND period_end<=statement_timestamp()
     ORDER BY period_end,id LIMIT $1`,
    [limit]
  );
  const result = { expired: 0, cancelled: 0, financeReview: 0, skipped: 0 };
  for (const row of due.rows) {
    const disposition = (
      await pool.query<{ disposition: string }>(
        'SELECT expire_electricity_increase($1) AS disposition',
        [row.id]
      )
    ).rows[0]?.disposition;
    if (disposition === 'skipped' || !disposition) result.skipped++;
    else {
      result.expired++;
      if (disposition === 'invoice_cancelled') result.cancelled++;
      if (disposition === 'finance_review') result.financeReview++;
    }
  }
  return result;
}
