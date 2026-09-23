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
            order_id: string;
            order_type: string;
            saving_order_id: string | null;
            reason: string;
            authorized_by: string;
          }>(
            `SELECT o.order_id,p.order_type,s.id AS saving_order_id,o.reason,o.authorized_by
             FROM refund_obligations o JOIN orders p ON p.id=o.order_id
             LEFT JOIN saving_orders s ON s.order_id=o.order_id WHERE o.refund_id=$1`,
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
        ? `Your refund of ${enAmount} IRR has not completed. The finance team has been notified. View the invoice or contact support for details.`
        : rejected
          ? `Your refund request for ${enAmount} IRR was rejected. View the invoice or contact support for details.`
          : refund.destination === 'wallet'
            ? `${enAmount} IRR has been returned to your wallet. View the invoice for details.${orderSuffix?.en ?? ''}`
            : `Your bank refund of ${enAmount} IRR has been confirmed. View the invoice for details.`,
    },
  };
  const id = uuidv7();
  await client.query(
    `INSERT INTO in_app_notifications(id,recipient_user_id,profile_id,type,title_i18n_key,body_i18n_key,localized_content,link_route,delivery_key)
     VALUES ($1,$2,$3,'general','notifications.legacy.title','notifications.legacy.body',$4::jsonb,$5,$6)`,
    [
      id,
      owner.user_id,
      refund.profile_id,
      JSON.stringify(localizedContent),
      order?.order_type === 'electricity'
        ? `/electricity/orders/${order.order_id}`
        : order?.order_type === 'savings' && order.saving_order_id
          ? `/savings/orders/${order.saving_order_id}`
          : `/invoices/${refund.invoice_id}`,
      `refund:${refund.id}:${refund.state}`,
    ]
  );
}
