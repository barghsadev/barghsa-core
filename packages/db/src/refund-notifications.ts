import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';

/** The caller holds the profile lock and commits the refund and its notice together. */
export async function notifyRefundOutcome(
  client: PoolClient,
  refund: {
    id: string;
    invoice_id: string;
    profile_id: string;
    amount: string;
    destination: 'wallet' | 'external_bank';
    state: 'Completed' | 'Rejected' | 'Failed';
  }
): Promise<void> {
  const owner = (
    await client.query<{ user_id: string }>('SELECT user_id FROM profiles WHERE id=$1', [
      refund.profile_id,
    ])
  ).rows[0];
  if (!owner) throw new Error('Refund profile owner is missing');
  const faAmount = new Intl.NumberFormat('fa').format(BigInt(refund.amount));
  const enAmount = new Intl.NumberFormat('en').format(BigInt(refund.amount));
  const order =
    refund.state === 'Completed'
      ? (
          await client.query<{
            order_id: string | null;
            order_type: string;
            saving_order_id: string | null;
            reason: string;
            authorized_by: string;
          }>(
            `SELECT o.order_id,p.order_type,s.id AS saving_order_id,o.reason,o.authorized_by
             FROM refund_obligations o JOIN orders p ON p.id=o.order_id
             LEFT JOIN saving_orders s ON s.order_id=o.order_id WHERE o.refund_id=$1
             UNION ALL
             SELECT contract.order_id,contract.service_type::text,s.id,intent.reason,cancellation.executed_by
             FROM contract_refund_obligations obligation
             JOIN contracts contract ON contract.id=obligation.contract_id
             JOIN contract_cancellations cancellation ON cancellation.contract_id=contract.id
             JOIN contract_cancellation_intents intent ON intent.id=cancellation.intent_id
             LEFT JOIN saving_orders s ON s.order_id=contract.order_id
             WHERE obligation.refund_id=$1 LIMIT 1`,
            [refund.id]
          )
        ).rows[0]
      : undefined;
  const completedAt = new Date();
  const orderSuffix = order
    ? {
        fa: ` دلیل: ${order.reason}. بازپرداخت خودکار پس از تصمیم ${order.authorized_by} در ${new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(completedAt)} ثبت شد.`,
        en: ` Reason: ${order.reason}. Automatic refund after ${order.authorized_by}'s decision, posted ${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(completedAt)}.`,
      }
    : null;
  const rejected = refund.state === 'Rejected';
  const failed = refund.state === 'Failed';
  const localizedContent = {
    fa: {
      title: failed
        ? 'بازپرداخت نیازمند پیگیری است'
        : rejected
          ? 'درخواست بازپرداخت رد شد'
          : 'بازپرداخت انجام شد',
      body: failed
        ? `بازپرداخت ${faAmount} ریال هنوز انجام نشده است و تیم مالی آن را پیگیری می‌کند. برای جزئیات، صورتحساب را بررسی کنید یا با پشتیبانی تماس بگیرید.`
        : rejected
          ? `درخواست بازپرداخت ${faAmount} ریال رد شد. برای جزئیات، صورتحساب را بررسی کنید یا با پشتیبانی تماس بگیرید.`
          : refund.destination === 'wallet'
            ? `${faAmount} ریال به کیف پول شما بازگردانده شد. جزئیات در صورتحساب موجود است.${orderSuffix?.fa ?? ''}`
            : `بازپرداخت بانکی ${faAmount} ریال تأیید شد. جزئیات در صورتحساب موجود است.`,
    },
    en: {
      title: failed
        ? 'Refund needs attention'
        : rejected
          ? 'Refund request rejected'
          : 'Refund completed',
      body: failed
        ? `Your refund of ${enAmount} IRR has not completed. The finance team will follow up. View the invoice or contact support for details.`
        : rejected
          ? `Your refund request for ${enAmount} IRR was rejected. View the invoice or contact support for details.`
          : refund.destination === 'wallet'
            ? `${enAmount} IRR has been returned to your wallet. View the invoice for details.${orderSuffix?.en ?? ''}`
            : `Your bank refund of ${enAmount} IRR has been confirmed. View the invoice for details.`,
    },
  };
  const id = uuidv7();
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO in_app_notifications(id,recipient_user_id,profile_id,operating_context,type,title_i18n_key,body_i18n_key,localized_content,link_route,delivery_key)
     VALUES ($1,$2,$3,'customer','general','notifications.legacy.title','notifications.legacy.body',$4::jsonb,$5,$6)
     ON CONFLICT (delivery_key) DO NOTHING RETURNING id`,
    [
      id,
      owner.user_id,
      refund.profile_id,
      JSON.stringify(localizedContent),
      order?.order_type === 'electricity' && order.order_id
        ? `/electricity/orders/${order.order_id}`
        : order?.order_type === 'savings' && order.saving_order_id
          ? `/savings/orders/${order.saving_order_id}`
          : `/invoices/${refund.invoice_id}`,
      `refund:${refund.id}:${refund.state}`,
    ]
  );
  // Attach delivery only to a new completion. Historical inbox receipts remain immutable.
  if (refund.state === 'Completed' && inserted.rows.length === 1) {
    if (inserted.rows[0]!.id !== id) throw new Error('Refund inbox receipt was not stored');
    const outboxId = uuidv7();
    const payload = {
      inboxId: id,
      refundId: refund.id,
      invoiceId: refund.invoice_id,
      amount: refund.amount,
      destination: refund.destination,
      link_route: `/invoices/${refund.invoice_id}`,
    };
    const outbox = await client.query(
      `INSERT INTO notification_outbox(id,user_id,profile_id,event_key,payload,channels,status,idempotency_key,max_attempts)
       VALUES($1,$2,$3,'payment.refund_completed',$4,ARRAY['in_app','email'],'queued',$5,5) RETURNING id`,
      [
        outboxId,
        owner.user_id,
        refund.profile_id,
        payload,
        `payment.refund_completed:${id}:${owner.user_id}`,
      ]
    );
    if (outbox.rows.length !== 1 || outbox.rows[0].id !== outboxId)
      throw new Error('Refund completion outbox was not stored');
    const inboxJob = await client.query(
      `INSERT INTO notification_job(outbox_id,channel,status,priority,max_attempts,attempts,provider_ref,delivery_payload)
       VALUES($1,'in_app','done','urgent',5,1,$2,$3)`,
      [outboxId, id, payload]
    );
    if (inboxJob.rowCount !== 1) throw new Error('Refund inbox job was not stored');
    const emailJob = await client.query(
      `INSERT INTO notification_job(outbox_id,channel,status,priority,max_attempts,attempts)
       VALUES($1,'email','queued','urgent',5,0)`,
      [outboxId]
    );
    if (emailJob.rowCount !== 1) throw new Error('Refund email job was not stored');
    const history = await client.query(
      `INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number,provider_ref)
       VALUES($1,'in_app','delivered',1,$2)`,
      [outboxId, id]
    );
    if (history.rowCount !== 1) throw new Error('Refund inbox history was not stored');
  } else if (refund.state === 'Completed') {
    const retained = await client.query(
      `SELECT id FROM in_app_notifications WHERE delivery_key=$1 AND profile_id=$2
         AND operating_context='customer' AND type='general'`,
      [`refund:${refund.id}:Completed`, refund.profile_id]
    );
    if (retained.rows.length !== 1) throw new Error('Refund inbox receipt was not stored');
  }
}
