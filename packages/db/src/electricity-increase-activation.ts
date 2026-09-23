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
