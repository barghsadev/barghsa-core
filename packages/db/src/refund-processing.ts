import type { Pool, PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { resolveStaffPermissions } from '@barghsa/shared/admin';
import {
  DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
  readInvoiceBankReceiptDualApprovalThreshold,
} from '@barghsa/shared/finance';
import { postWalletCredit } from './wallet-credit';
import { notifyRefundOutcome } from './refund-notifications';
export { notifyRefundOutcome } from './refund-notifications';

export class RefundProcessingError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
export interface RefundProcessingRow {
  id: string;
  invoice_id: string;
  profile_id: string;
  amount: string;
  state: string;
  destination: string;
  staff_id: string | null;
}

/** A committed cancellation creates an immutable debt. Fulfillment uses that
 * recorded authority; later role or threshold changes cannot erase the debt. */
export async function readContractRefundAuthorization(
  client: PoolClient,
  row: RefundProcessingRow
) {
  const obligation = (
    await client.query<{
      contract_id: string;
      intent_id: string;
      executed_by: string;
      valid: boolean;
    }>(
      `SELECT o.contract_id,c.intent_id,c.executed_by,
      (p.state='Cancelled' AND p.current_version_id=i.version_id AND p.profile_id=$3
       AND o.invoice_id=$2 AND $4::text IS NULL
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(i.refund_decision->'refunds') d
         WHERE d->>'invoiceId'=$2::text AND d->>'amount'=$5 AND d->>'destination'=$6)) AS valid
    FROM contract_refund_obligations o JOIN contract_cancellations c ON c.contract_id=o.contract_id
    JOIN contract_cancellation_intents i ON i.id=c.intent_id JOIN contracts p ON p.id=c.contract_id
    WHERE o.refund_id=$1`,
      [row.id, row.invoice_id, row.profile_id, row.staff_id, row.amount, row.destination]
    )
  ).rows[0];
  if (!obligation) return undefined;
  if (!obligation.valid)
    throw new RefundProcessingError(
      'invalid_contract_obligation',
      'Contract refund evidence does not match the refund'
    );
  return {
    contractId: obligation.contract_id,
    intentId: obligation.intent_id,
    authorizedBy: obligation.executed_by,
    actorType: 'system' as const,
  };
}
export async function refundRequiresApproval(client: PoolClient, amount: string): Promise<boolean> {
  const raw = (
    await client.query('SELECT value FROM app_config WHERE key=$1', [
      DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
    ])
  ).rows[0]?.value;
  const threshold = readInvoiceBankReceiptDualApprovalThreshold(raw);
  if (threshold.status === 'corrupt')
    throw new RefundProcessingError('invalid_policy', 'Dual approval configuration is invalid');
  return threshold.status === 'enabled' && BigInt(amount) >= BigInt(threshold.thresholdIrR);
}
export async function latestRefundApproval(
  client: PoolClient,
  row: Pick<RefundProcessingRow, 'id'>
) {
  const binding = (
    await client.query<{ id: string }>(
      "SELECT metadata::jsonb->>'approvalRequestId' AS id FROM audit_log WHERE event='refund.approval_requested' AND metadata::jsonb->>'refundId'=$1 ORDER BY created_at DESC,audit_log.id DESC LIMIT 1",
      [row.id]
    )
  ).rows[0];
  if (!binding) return undefined;
  const approval = (
    await client.query<{
      id: string;
      action_type: string;
      amount_irr: string;
      initiator_id: string;
      reviewer_id: string | null;
      status: string;
      details: Record<string, string>;
    }>('SELECT * FROM approval_requests WHERE id=$1 FOR UPDATE', [binding.id])
  ).rows[0];
  if (!approval)
    throw new RefundProcessingError('approval_required', 'The bound approval request is missing');
  return approval;
}
export async function requireRefundFinancePermission(
  client: PoolClient,
  userId: string
): Promise<void> {
  const user = (
    await client.query<{ is_admin: boolean }>(
      'SELECT is_admin FROM users WHERE user_id=$1 AND disabled_at IS NULL AND activation_token IS NULL FOR SHARE NOWAIT',
      [userId]
    )
  ).rows[0];
  if (user?.is_admin) return;
  if (user) {
    const roles = await client.query(
      'SELECT r.permissions FROM user_roles ur JOIN staff_roles r ON r.role_id=ur.role_id WHERE ur.user_id=$1 ORDER BY r.role_id FOR SHARE OF ur,r NOWAIT',
      [userId]
    );
    const permissions = resolveStaffPermissions(roles.rows.map((row) => row.permissions));
    if (permissions.includes('*') || permissions.includes('admin:financial:edit')) return;
  }
  throw new RefundProcessingError(
    'finance_permission_required',
    'Current finance permission is required for refund processing'
  );
}
export async function requireRefundApproval(
  client: PoolClient,
  row: RefundProcessingRow
): Promise<void> {
  if (await readContractRefundAuthorization(client, row)) return;
  const approval = await latestRefundApproval(client, row);
  if (approval?.status === 'rejected')
    throw new RefundProcessingError(
      'approval_required',
      'The financial review rejected this refund'
    );
  if (!(await refundRequiresApproval(client, row.amount)) && !approval) return;
  if (
    !approval ||
    approval.action_type !== 'refund' ||
    approval.details.refundId !== row.id ||
    approval.status !== 'approved' ||
    !approval.reviewer_id ||
    approval.reviewer_id === approval.initiator_id ||
    approval.initiator_id !== row.staff_id ||
    approval.amount_irr !== row.amount ||
    approval.details.invoiceId !== row.invoice_id ||
    approval.details.profileId !== row.profile_id ||
    approval.details.destination !== row.destination
  )
    throw new RefundProcessingError(
      'approval_required',
      'A matching approval by a second finance staff member is required'
    );
  await requireRefundFinancePermission(client, approval.initiator_id);
  await requireRefundFinancePermission(client, approval.reviewer_id);
}

async function audit(
  client: PoolClient,
  refund: RefundProcessingRow,
  authorizedBy: string,
  event: string,
  extra: Record<string, unknown>
) {
  await client.query(
    'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id) VALUES ($1,$5,$2,$3::jsonb,$4)',
    [
      uuidv7(),
      event,
      JSON.stringify({
        refundId: refund.id,
        invoiceId: refund.invoice_id,
        profileId: refund.profile_id,
        amount: refund.amount,
        executor: 'refund_worker',
        ...extra,
      }),
      uuidv7(),
      authorizedBy,
    ]
  );
}
async function alertExhausted(
  client: PoolClient,
  row: RefundProcessingRow,
  attempts: number,
  authorizedBy: string
) {
  const recipients = await client.query(`SELECT u.user_id,u.is_admin,
    ARRAY(SELECT r.permissions FROM user_roles ur JOIN staff_roles r ON r.role_id=ur.role_id WHERE ur.user_id=u.user_id) AS permissions
    FROM users u WHERE u.disabled_at IS NULL AND u.activation_token IS NULL
      AND (u.is_admin OR EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=u.user_id))`);
  const content = {
    fa: {
      title: 'بازپرداخت نیازمند پیگیری است',
      body: `بازپرداخت ${row.id} پس از ${attempts} تلاش ناموفق متوقف شد. وضعیت مالی را بررسی کنید.`,
    },
    en: {
      title: 'Refund needs attention',
      body: `Refund ${row.id} stopped after ${attempts} unsuccessful attempts. Review its financial status.`,
    },
  };
  for (const recipient of recipients.rows) {
    const permissions = resolveStaffPermissions(recipient.permissions);
    if (
      !recipient.is_admin &&
      !permissions.includes('*') &&
      !permissions.includes('admin:financial:edit')
    )
      continue;
    // Other finance operations can hold this actor while waiting for this invoice.
    await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR KEY SHARE NOWAIT', [
      recipient.user_id,
    ]);
    await client.query(
      `INSERT INTO in_app_notifications(id,recipient_user_id,type,title_i18n_key,body_i18n_key,localized_content,delivery_key)
      VALUES($1,$2,'general','notifications.legacy.title','notifications.legacy.body',$3::jsonb,$4)`,
      [
        uuidv7(),
        recipient.user_id,
        JSON.stringify(content),
        `refund-exhausted:${row.id}:${recipient.user_id}`,
      ]
    );
  }
  await audit(client, row, authorizedBy, 'refund.retry_exhausted', { attempts });
  await notifyRefundOutcome(client, { ...row, destination: 'wallet', state: 'Failed' });
}

export type RefundAttemptResult = 'completed' | 'failed' | 'exhausted' | 'deferred';
/** The due time is enforced here for both API attempts and worker polls. */
export async function runWalletRefund(pool: Pool, refundId: string): Promise<RefundAttemptResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const acquired = (
      await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',
        [`refund-run:${refundId}`]
      )
    ).rows[0]?.acquired;
    if (!acquired) {
      await client.query('ROLLBACK');
      return 'deferred';
    }
    const owner = (
      await client.query('SELECT invoice_id,profile_id FROM refunds WHERE id=$1', [refundId])
    ).rows[0];
    if (!owner) {
      await client.query('ROLLBACK');
      return 'deferred';
    }
    const profile = (
      await client.query<{ id: string; archived: boolean }>(
        'SELECT id,archived FROM profiles WHERE id=$1 FOR SHARE',
        [owner.profile_id]
      )
    ).rows[0]!;
    await client.query(
      "SELECT pg_advisory_xact_lock_shared(hashtext('finance.dual_approval_threshold'))"
    );
    const invoice = (
      await client.query(
        'SELECT id,profile_id,state,adjustment_kind,total_amount,paid_amount,refunded_amount FROM invoices WHERE id=$1 FOR UPDATE',
        [owner.invoice_id]
      )
    ).rows[0];
    const row = (
      await client.query<RefundProcessingRow>('SELECT * FROM refunds WHERE id=$1 FOR UPDATE', [
        refundId,
      ])
    ).rows[0]!;
    const job = (
      await client.query<{ executor_user_id: string; attempts: number; max_attempts: number }>(
        'SELECT executor_user_id,attempts,max_attempts FROM refund_retry_jobs WHERE refund_id=$1 AND next_attempt_at <= now() AND exhausted_at IS NULL AND completed_at IS NULL AND attempts < max_attempts FOR UPDATE',
        [refundId]
      )
    ).rows[0];
    if (!job || row.destination !== 'wallet' || !['Processing', 'Failed'].includes(row.state)) {
      await client.query('ROLLBACK');
      return 'deferred';
    }
    const attempt = job.attempts + 1;
    await client.query('UPDATE refund_retry_jobs SET attempts=$2 WHERE refund_id=$1', [
      row.id,
      attempt,
    ]);
    if (row.state === 'Failed') {
      await client.query("UPDATE refunds SET state='Processing' WHERE id=$1", [row.id]);
      await audit(client, row, job.executor_user_id, 'refund.processing', {
        fromState: 'Failed',
        toState: 'Processing',
        attempt,
      });
    }
    await client.query('SAVEPOINT refund_posting');
    let result: RefundAttemptResult;
    try {
      const obligation = await readContractRefundAuthorization(client, row);
      if (!profile || profile.archived)
        throw new RefundProcessingError('profile_archived', 'Profile is unavailable');
      if (
        !invoice ||
        invoice.profile_id !== row.profile_id ||
        invoice.adjustment_kind === 'credit' ||
        !(
          obligation
            ? ['Paid', 'PartiallyFunded', 'Unpaid', 'Overdue', 'PartiallyRefunded']
            : ['Paid', 'PartiallyRefunded']
        ).includes(invoice.state) ||
        BigInt(invoice.total_amount) <= 0n
      )
        throw new RefundProcessingError('invoice_not_refundable', 'Invoice cannot be refunded');
      if (obligation) {
        if (obligation.authorizedBy !== job.executor_user_id)
          throw new RefundProcessingError(
            'invalid_contract_obligation',
            'Refund job does not match cancellation authority'
          );
      } else {
        await requireRefundFinancePermission(client, job.executor_user_id);
        await requireRefundApproval(client, row);
      }
      await client.query(
        'INSERT INTO wallets(profile_id) VALUES($1) ON CONFLICT(profile_id) DO NOTHING',
        [row.profile_id]
      );
      await postWalletCredit(
        client,
        profile,
        row.profile_id,
        BigInt(row.amount),
        {
          type: 'refund',
          refId: row.id,
          description: 'Invoice wallet refund',
          metadata: { refundId: row.id, invoiceId: row.invoice_id, ...obligation },
        },
        `refund-wallet-credit:${row.id}`
      );
      await client.query("UPDATE refunds SET state='Completed' WHERE id=$1", [row.id]);
      await audit(client, row, job.executor_user_id, 'refund.completed', {
        fromState: 'Processing',
        toState: 'Completed',
        attempt,
        authorizedBy: job.executor_user_id,
        ...obligation,
      });
      const after = (
        await client.query('SELECT paid_amount,refunded_amount FROM invoices WHERE id=$1', [
          row.invoice_id,
        ])
      ).rows[0];
      const paid = BigInt(after.paid_amount),
        returned = BigInt(after.refunded_amount);
      if (returned <= 0n || returned > paid)
        throw new RefundProcessingError('accounting_conflict', 'Invalid refund totals');
      const next = returned === paid ? 'Refunded' : 'PartiallyRefunded';
      await client.query('UPDATE invoices SET state=$2,updated_at=now() WHERE id=$1', [
        row.invoice_id,
        next,
      ]);
      await client.query(
        'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id) VALUES($1,$5,$2,$3::jsonb,$4)',
        [
          uuidv7(),
          returned === paid ? 'invoice.full_refund' : 'invoice.partial_refund',
          JSON.stringify({
            invoiceId: row.invoice_id,
            fromState: invoice.state,
            toState: next,
            transition: returned === paid ? 'full_refund' : 'partial_refund',
            reason: 'Wallet refund completed',
            refundId: row.id,
            executor: 'refund_worker',
          }),
          uuidv7(),
          job.executor_user_id,
        ]
      );
      await notifyRefundOutcome(client, { ...row, destination: 'wallet', state: 'Completed' });
      await client.query(
        'UPDATE refund_retry_jobs SET completed_at=now(),next_attempt_at=NULL,last_error_code=NULL WHERE refund_id=$1',
        [row.id]
      );
      result = 'completed';
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT refund_posting');
      const code = error instanceof RefundProcessingError ? error.code : 'posting_failed';
      await client.query("UPDATE refunds SET state='Failed' WHERE id=$1", [row.id]);
      const exhausted = attempt >= job.max_attempts;
      const delay = Math.min(60_000 * 2 ** (attempt - 1), 3_600_000);
      await client.query(
        `UPDATE refund_retry_jobs SET last_error_code=$2,
        next_attempt_at=CASE WHEN $3 THEN NULL ELSE now()+($4::bigint * interval '1 millisecond') END,
        exhausted_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE refund_id=$1`,
        [row.id, code, exhausted, delay]
      );
      await audit(client, row, job.executor_user_id, 'refund.failed', {
        fromState: 'Processing',
        toState: 'Failed',
        attempt,
        errorCode: code,
      });
      if (exhausted) await alertExhausted(client, row, attempt, job.executor_user_id);
      result = exhausted ? 'exhausted' : 'failed';
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function retryDueWalletRefunds(pool: Pool, limit = 20) {
  const ids = await pool.query<{ refund_id: string }>(
    `SELECT refund_id FROM refund_retry_jobs WHERE next_attempt_at <= now()
    AND exhausted_at IS NULL AND completed_at IS NULL AND attempts < max_attempts ORDER BY next_attempt_at,refund_id LIMIT $1`,
    [Math.max(1, Math.min(100, Math.trunc(limit) || 20))]
  );
  const results: RefundAttemptResult[] = [];
  for (const row of ids.rows) results.push(await runWalletRefund(pool, row.refund_id));
  return results;
}
