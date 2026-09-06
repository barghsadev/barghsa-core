import { notificationLink } from './navigation.js';

export interface InboxText {
  title: string;
  body: string;
}
export type InboxContent = Record<'fa' | 'en', InboxText>;
const labels: Record<string, [string, string, string, string]> = {
  'payment.wallet_topup_completed': [
    'شارژ کیف پول انجام شد',
    'Wallet top-up completed',
    'مبلغ به کیف پول شما اضافه شد.',
    'The amount was credited to your wallet.',
  ],
  'payment.wallet_topup_failed': [
    'شارژ کیف پول رد شد',
    'Wallet top-up rejected',
    'رسید شارژ کیف پول شما تأیید نشد.',
    'Your wallet top-up receipt was not approved.',
  ],
  'payment.bank_receipt_rejected': [
    'رسید بانکی رد شد',
    'Bank receipt rejected',
    'رسید بانکی شما تأیید نشد.',
    'Your bank receipt was not approved.',
  ],
  'payment.invoice_reminder': [
    'یادآوری پرداخت فاکتور',
    'Invoice payment reminder',
    'فاکتور شما هنوز مانده پرداخت‌نشده دارد.',
    'Your invoice still has an unpaid balance.',
  ],
  'finance.chargeback_unresolved': [
    'شارژبک نیازمند بررسی',
    'Chargeback needs review',
    'این شارژبک نیازمند بررسی تیم مالی است.',
    'This chargeback needs finance review.',
  ],
  'admin.service_target_breached': [
    'مهلت پاسخ‌گویی گذشته است',
    'Response target exceeded',
    'یک درخواست از مهلت پاسخ‌گویی عبور کرده است.',
    'A request has exceeded its response target.',
  ],
  'admin.service_escalated': [
    'درخواست ارجاع داده شد',
    'Request escalated',
    'درخواست بی‌پاسخ به سطح بالاتر ارجاع داده شد.',
    'An unanswered request was escalated to the next level.',
  ],
  profile_verified: [
    'پروفایل تأیید شد',
    'Profile verified',
    'وضعیت تأیید پروفایل شما به‌روزرسانی شد.',
    'Your profile verification status was updated.',
  ],
};
export const IMPLEMENTED_INBOX_EVENTS = Object.keys(labels);
function scalar(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}
export function defaultInboxContent(
  event: string,
  data: Record<string, unknown> = {}
): InboxContent {
  const text = labels[event] ?? [
    'اعلان جدید',
    'New notification',
    'به‌روزرسانی جدیدی برای شما ثبت شده است.',
    'There is a new update for you.',
  ];
  const content = {
    fa: { title: text[0]!, body: text[2]! },
    en: { title: text[1]!, body: text[3]! },
  };
  const amount = scalar(data.amount ?? data.amount_irr);
  const reason = scalar(data.reason);
  if (amount) {
    content.fa.body += ` مبلغ: ${amount} ریال.`;
    content.en.body += ` Amount: ${amount} IRR.`;
  }
  if (reason) {
    content.fa.body += ` دلیل: ${reason}`;
    content.en.body += ` Reason: ${reason}`;
  }
  return content;
}
export function defaultInboxLink(event: string, data: Record<string, unknown> = {}): string | null {
  if (Object.hasOwn(data, 'link_route'))
    return notificationLink(typeof data.link_route === 'string' ? data.link_route : null);
  if (event.startsWith('payment.wallet_')) return '/wallet';
  if (event === 'payment.invoice_reminder') {
    const id = scalar(data.invoiceId);
    return id && /^[a-f0-9-]{36}$/i.test(id) ? `/invoices/${id}` : '/invoices';
  }
  if (event.startsWith('profile')) return '/settings/profile';
  if (event.startsWith('admin.') || event.startsWith('finance.')) return '/admin';
  return null;
}
