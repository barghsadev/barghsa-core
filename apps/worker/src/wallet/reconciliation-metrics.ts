import type { PoolClient } from 'pg';
import { Gauge } from 'prom-client';
import {
  WALLET_LEDGER_POSTED_STATE,
  WALLET_LEDGER_RESERVED_STATE,
  WALLET_MISMATCH_CRITICAL_ABS_IRR,
  WALLET_MISMATCH_EXCEPTION_TYPE,
} from '@barghsa/shared/finance';
import { registry } from '../notifications/worker-metrics.js';

const openMismatches = new Gauge({
  name: 'reconciliation_mismatches_unresolved',
  help: 'Reconciliation mismatch cases awaiting or under investigation',
  registers: [registry],
});

const criticalWalletDrift = new Gauge({
  name: 'reconciliation_wallets_critical_drift',
  help: 'Wallets with an open mismatch and current drift at or above the critical threshold',
  registers: [registry],
});

export async function collectReconciliationMetrics(pool: Pick<PoolClient, 'query'>) {
  // Recheck only known mismatches. The periodic scanner finds new wallets.
  const result = await pool.query<{ mismatches: string; critical_wallets: string }>(
    `WITH active AS (
      SELECT exception_type, details->>'walletId' AS wallet_id
      FROM reconciliation_exceptions
      WHERE status IN ('open', 'investigating')
    )
    SELECT (SELECT COUNT(*) FROM active) AS mismatches, COUNT(*) AS critical_wallets
    FROM (SELECT DISTINCT wallet_id FROM active WHERE exception_type = $1) observed
    JOIN wallets wallet ON wallet.profile_id::text = observed.wallet_id
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE state = $2), 0) AS posted,
        COALESCE(SUM(amount) FILTER (WHERE state = $3), 0) AS reserved
      FROM wallet_transactions
      WHERE wallet_id = wallet.profile_id
    ) ledger
    WHERE GREATEST(
      ABS(wallet.posted_balance - ledger.posted),
      ABS(wallet.reserved_balance - ledger.reserved)
    ) >= $4::numeric`,
    [
      WALLET_MISMATCH_EXCEPTION_TYPE,
      WALLET_LEDGER_POSTED_STATE,
      WALLET_LEDGER_RESERVED_STATE,
      WALLET_MISMATCH_CRITICAL_ABS_IRR.toString(),
    ]
  );
  openMismatches.set(Number(result.rows[0]!.mismatches));
  criticalWalletDrift.set(Number(result.rows[0]!.critical_wallets));
}
