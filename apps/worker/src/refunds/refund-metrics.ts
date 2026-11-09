import type { PoolClient } from 'pg';
import { Gauge } from 'prom-client';
import { registry } from '../notifications/worker-metrics.js';

const unresolvedRefundObligations = new Gauge({
  name: 'refund_obligations_unresolved',
  help: 'Distinct mandatory refunds outstanding across order and contract obligations',
  registers: [registry],
});

const overdueRefundObligations = new Gauge({
  name: 'refund_obligations_overdue',
  help: 'Distinct mandatory refunds outstanding for more than one hour',
  registers: [registry],
});

export async function collectRefundObligationMetrics(pool: Pick<PoolClient, 'query'>) {
  // An adopted legacy obligation may also appear in the contract ledger.
  const result = await pool.query<{ unresolved: string; overdue: string }>(`
    SELECT COUNT(*) AS unresolved,
      COUNT(*) FILTER (WHERE first_created_at < NOW() - INTERVAL '1 hour') AS overdue
    FROM (
      SELECT refund_id, MIN(created_at) AS first_created_at
      FROM (
        SELECT refund_id, created_at FROM refund_obligations
        WHERE status IN ('pending', 'processing', 'failed')
        UNION ALL
        SELECT obligation.refund_id, obligation.created_at
        FROM contract_refund_obligations obligation
        JOIN refunds refund ON refund.id = obligation.refund_id
        WHERE refund.state <> 'Completed'
      ) outstanding
      GROUP BY refund_id
    ) obligations
  `);
  unresolvedRefundObligations.set(Number(result.rows[0]!.unresolved));
  overdueRefundObligations.set(Number(result.rows[0]!.overdue));
}
