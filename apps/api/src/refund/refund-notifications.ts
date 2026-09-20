import type { PoolClient } from 'pg';
import { NotificationsService } from '../notifications/notifications.service.js';

/** The caller holds the profile lock and commits the refund and its notice together. */
export async function notifyRefundOutcome(
  client: PoolClient,
  refund: {
    id: string;
    invoice_id: string;
    profile_id: string;
    amount: string;
    destination: 'wallet' | 'external_bank';
    state: 'Completed' | 'Rejected';
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
  const rejected = refund.state === 'Rejected';
  const localizedContent = {
    fa: {
      title: rejected ? 'درخواست بازپرداخت رد شد' : 'بازپرداخت انجام شد',
      body: rejected
        ? `درخواست بازپرداخت ${faAmount} ریال رد شد. برای جزئیات، صورتحساب را بررسی کنید یا با پشتیبانی تماس بگیرید.`
        : refund.destination === 'wallet'
          ? `${faAmount} ریال به کیف پول شما بازگردانده شد. جزئیات در صورتحساب موجود است.`
          : `بازپرداخت بانکی ${faAmount} ریال تأیید شد. جزئیات در صورتحساب موجود است.`,
    },
    en: {
      title: rejected ? 'Refund request rejected' : 'Refund completed',
      body: rejected
        ? `Your refund request for ${enAmount} IRR was rejected. View the invoice or contact support for details.`
        : refund.destination === 'wallet'
          ? `${enAmount} IRR has been returned to your wallet. View the invoice for details.`
          : `Your bank refund of ${enAmount} IRR has been confirmed. View the invoice for details.`,
    },
  };
  await new NotificationsService().create(
    {
      userId: owner.user_id,
      profileId: refund.profile_id,
      type: 'general',
      ...localizedContent.fa,
      localizedContent,
      link: `/invoices/${refund.invoice_id}`,
    },
    client
  );
}
