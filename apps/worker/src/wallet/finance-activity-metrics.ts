import type { PoolClient } from 'pg';
import { Gauge } from 'prom-client';
import {
  BANK_RECEIPT_CONFIRMED_EVENT,
  BANK_RECEIPT_REJECTED_EVENT,
  INVOICE_BANK_RECEIPT_CONFIRMED_EVENT,
  INVOICE_BANK_RECEIPT_REJECTED_EVENT,
  WALLET_INVOICE_PAYMENT_EVENT,
} from '@barghsa/shared/finance';
import { registry } from '../notifications/worker-metrics.js';

const completedRefundEvent = 'refund.completed';
const onlineCompletedEvent = 'payment.wallet_topup_completed';
const onlineFailedEvent = 'payment.wallet_topup_failed';
const paymentOperations = [
  'wallet_invoice_payment',
  'invoice_bank_receipt',
  'wallet_bank_topup',
  'online_topup',
] as const;
const destinations = ['wallet', 'external_bank'] as const;

const collectionSuccess = new Gauge({
  name: 'finance_activity_collection_success',
  help: 'Whether the latest read of the one-hour finance activity window succeeded',
  registers: [registry],
});
const paymentOutcomes = new Gauge({
  name: 'finance_payment_outcomes_1h',
  help: 'Recorded terminal payment outcomes during the past hour, one per financial intent',
  labelNames: ['operation', 'outcome'] as const,
  registers: [registry],
});
const completedRefunds = new Gauge({
  name: 'finance_refunds_completed_1h',
  help: 'Completed audited refunds in the past hour, by destination',
  labelNames: ['destination'] as const,
  registers: [registry],
});
const refundedValue = new Gauge({
  name: 'finance_refunds_completed_irr_1h',
  help: 'IRR returned by completed audited refunds in the past hour, by destination',
  labelNames: ['destination'] as const,
  registers: [registry],
});

interface ActivityRow {
  operation: string | null;
  outcome: 'completed' | 'unsuccessful' | null;
  destination: string | null;
  count: string;
  amount: string | null;
}

let inFlight: Promise<void> | undefined;

export function collectFinanceActivityMetrics(pool: Pick<PoolClient, 'query'>): Promise<void> {
  inFlight ??= refresh(pool).finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

async function refresh(pool: Pick<PoolClient, 'query'>): Promise<void> {
  try {
    // The audit and outbox time indexes bound the input. Identity lookups use
    // ledger keys. Read only committed outcomes, independent of notification delivery.
    const result = await pool.query<ActivityRow>(
      `WITH recent_audit AS MATERIALIZED (
         SELECT event, created_at, CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb END AS data
         FROM audit_log
         WHERE created_at BETWEEN now() - INTERVAL '1 hour' AND now() AND event=ANY($1::text[])
       ), outcomes AS (
         SELECT CASE WHEN event=$2 THEN 'wallet_invoice_payment'
                     WHEN event IN ($3,$4) THEN 'invoice_bank_receipt'
                     ELSE 'wallet_bank_topup' END AS operation,
                CASE WHEN event=$2 THEN data->>'walletTransactionId'
                     WHEN event IN ($3,$4) THEN data->>'receiptId'
                     ELSE data->>'transactionId' END AS identity,
                event IN ($2,$3,$5) AS completed, created_at
         FROM recent_audit WHERE event<>$6
         UNION ALL
         SELECT 'online_topup', COALESCE(tx.metadata->>'pendingTransactionId', tx.id::text),
                ob.event_key=$7, ob.created_at
         FROM notification_outbox ob
         JOIN wallet_transactions tx ON tx.id = CASE
           WHEN pg_input_is_valid(ob.payload->>'transactionId','uuid')
           THEN (ob.payload->>'transactionId')::uuid END
         WHERE ob.created_at BETWEEN now() - INTERVAL '1 hour' AND now()
           AND ob.event_key IN ($7,$8) AND tx.type='topup' AND tx.metadata->>'channel'='online'
           AND ob.idempotency_key=ob.event_key||':online:'||tx.id::text||':'||ob.user_id
       ), latest AS (
         SELECT DISTINCT ON (operation,identity) operation, completed
         FROM outcomes WHERE pg_input_is_valid(identity,'uuid')
         ORDER BY operation,identity,created_at DESC,completed DESC
       ), refund_ids AS (
         SELECT DISTINCT CASE WHEN pg_input_is_valid(data->>'refundId','uuid')
           THEN (data->>'refundId')::uuid END AS id FROM recent_audit WHERE event=$6
       )
       SELECT operation, CASE WHEN completed THEN 'completed' ELSE 'unsuccessful' END AS outcome,
              NULL AS destination, COUNT(*)::text AS count, NULL AS amount
       FROM latest GROUP BY operation,completed
       UNION ALL
       SELECT NULL,NULL,r.destination::text,COUNT(*)::text,SUM(r.amount)::text
       FROM refund_ids selected JOIN refunds r ON r.id=selected.id AND r.state='Completed'
       JOIN refund_transactions tx ON tx.refund_id=r.id AND tx.state='Completed'
       GROUP BY r.destination`,
      [
        [
          WALLET_INVOICE_PAYMENT_EVENT,
          INVOICE_BANK_RECEIPT_CONFIRMED_EVENT,
          INVOICE_BANK_RECEIPT_REJECTED_EVENT,
          BANK_RECEIPT_CONFIRMED_EVENT,
          BANK_RECEIPT_REJECTED_EVENT,
          completedRefundEvent,
        ],
        WALLET_INVOICE_PAYMENT_EVENT,
        INVOICE_BANK_RECEIPT_CONFIRMED_EVENT,
        INVOICE_BANK_RECEIPT_REJECTED_EVENT,
        BANK_RECEIPT_CONFIRMED_EVENT,
        completedRefundEvent,
        onlineCompletedEvent,
        onlineFailedEvent,
      ]
    );

    for (const operation of paymentOperations) {
      paymentOutcomes.set({ operation, outcome: 'completed' }, 0);
      if (operation !== 'wallet_invoice_payment')
        paymentOutcomes.set({ operation, outcome: 'unsuccessful' }, 0);
    }
    for (const destination of destinations) {
      completedRefunds.set({ destination }, 0);
      refundedValue.set({ destination }, 0);
    }
    for (const row of result.rows) {
      if (row.operation && row.outcome) {
        paymentOutcomes.set({ operation: row.operation, outcome: row.outcome }, Number(row.count));
      } else if (row.destination && row.amount !== null) {
        const labels = { destination: row.destination };
        completedRefunds.set(labels, Number(row.count));
        refundedValue.set(labels, Number(row.amount));
      }
    }
    collectionSuccess.set(1);
  } catch {
    // Optional activity reporting cannot take the existing safety alerts offline.
    paymentOutcomes.reset();
    completedRefunds.reset();
    refundedValue.reset();
    collectionSuccess.set(0);
  }
}
