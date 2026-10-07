import { notificationLink } from './navigation.js';
import { renderTemplate } from './template-engine.js';

export interface InboxText {
  title: string;
  body: string;
}
export type InboxContent = Record<'fa' | 'en', InboxText>;

/** Render only fresh inbox content; callers retain existing receipts unchanged. */
export function renderInboxTemplates(
  fallback: InboxContent,
  templates: Array<{
    locale: unknown;
    subject: string | null;
    body_template: unknown;
    variables: unknown;
  }>,
  data: Record<string, unknown>
): InboxContent {
  const content = { ...fallback };
  for (const template of templates) {
    if (template.locale !== 'fa' && template.locale !== 'en')
      throw new Error('Invalid inbox template locale');
    if (!Array.isArray(template.variables) || typeof template.body_template !== 'string')
      throw new Error('Invalid inbox template');
    const names = template.variables.map((item: unknown) =>
      typeof item === 'string'
        ? item.trim()
        : item && typeof item === 'object' && 'name' in item && typeof item.name === 'string'
          ? item.name.trim()
          : ''
    );
    if (names.some((name: string) => !name)) throw new Error('Invalid inbox template variables');
    const title = renderTemplate(template.subject ?? content[template.locale].title, names, {
      data,
      escapeValues: false,
    });
    const body = renderTemplate(template.body_template, names, { data, escapeValues: false });
    if (title.missing.length || title.unknown.length || body.missing.length || body.unknown.length)
      throw new Error('Inbox template data incomplete');
    content[template.locale] = { title: title.output, body: body.output };
  }
  return content;
}
const labels: Record<string, [string, string, string, string]> = {
  'wallet.low_balance': [
    'موجودی کیف پول پایین',
    'Low wallet balance',
    'هنگام ثبت این اعلان، موجودی کیف پول برای صورتحساب‌های باز کافی نبود. موجودی فعلی و صورتحساب‌ها را بررسی کنید.',
    'Your wallet did not cover the open invoices when this alert was recorded. Check your current balance and invoices.',
  ],
  'payment.refund_failed': [
    'بازپرداخت نیازمند پیگیری است',
    'Refund needs attention',
    'یک تلاش برای بازپرداخت ناموفق بود. وضعیت و سابقه تلاش‌ها را در بخش مالی بررسی کنید.',
    'A refund attempt failed. Review its status and attempt history in the finance workspace.',
  ],
  'document.scan_failed': [
    'اسکن مدرک ناموفق بود',
    'Document scan failed',
    'اسکن مدرک ناموفق بود و تلاش دوباره برنامه‌ریزی شده است.',
    'The document scan failed and another attempt is scheduled.',
  ],
  'document.quarantined': [
    'مدرک قرنطینه شد',
    'Document quarantined',
    'مدرک به دلیل شناسایی بدافزار قرنطینه شد و قابل دریافت نیست.',
    'The document was quarantined after malware detection and cannot be downloaded.',
  ],
  'auth.refresh_token_reused': [
    'قطع نشست برای حفظ امنیت حساب',
    'Session ended for account security',
    'درخواست ورود غیرعادی شناسایی شد و نشست مربوط به آن را بستیم. نشست‌های دیگر خود را بررسی کنید و اگر این فعالیت را نمی‌شناسید، رمز عبور خود را تغییر دهید.',
    'We detected an unusual sign-in request and ended the affected session. Review your other sessions and change your password if this activity was unexpected.',
  ],
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
  'finance.chargeback_reversed': [
    'برگشت شارژبک ثبت شد',
    'Chargeback reversed',
    'برگشت مبلغ شارژبک ارائه‌دهنده با تراکنش جبرانی ثبت شد.',
    'The provider chargeback was recorded with a compensating reversal.',
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
  if (event === 'document.scan_failed' || event === 'document.quarantined') {
    const name = scalar(data.documentName);
    if (name) {
      content.fa.body += ` مدرک: ${name}`;
      content.en.body += ` Document: ${name}`;
    }
  }
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
  if (event === 'document.scan_failed' || event === 'document.quarantined')
    return '/admin/documents';
  if (event.startsWith('payment.wallet_')) return '/wallet';
  if (event === 'auth.refresh_token_reused') return '/settings/security';
  if (event === 'payment.invoice_reminder') {
    const id = scalar(data.invoiceId);
    return id && /^[a-f0-9-]{36}$/i.test(id) ? `/invoices/${id}` : '/invoices';
  }
  if (event.startsWith('profile')) return '/settings/profile';
  if (event.startsWith('admin.') || event.startsWith('finance.')) return '/admin';
  return null;
}
