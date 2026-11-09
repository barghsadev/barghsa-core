import type { PoolClient } from 'pg';
import { Gauge } from 'prom-client';
import { registry } from '../notifications/worker-metrics.js';

const overdueRefundObligations = new Gauge({
  name: 'refund_obligations_overdue',
  help: 'Distinct mandatory refunds outstanding for more than one hour',
  registers: [registry],
});

export async function collectRefundObligationMetrics(pool: Pick<PoolClient, 'query'>) {
  // An adopted legacy obligation may also appear in the contract ledger.
  const result = await pool.query<{ count: string }>(`
    SELECT COUNT(*) AS count FROM (
      SELECT refund_id FROM refund_obligations
      WHERE status IN ('pending', 'processing', 'failed')
        AND created_at < NOW() - INTERVAL '1 hour'
      UNION
      SELECT obligation.refund_id
      FROM contract_refund_obligations obligation
      JOIN refunds refund ON refund.id = obligation.refund_id
      WHERE refund.state <> 'Completed'
        AND obligation.created_at < NOW() - INTERVAL '1 hour'
    ) overdue
  `);
  overdueRefundObligations.set(Number(result.rows[0]!.count));
}
