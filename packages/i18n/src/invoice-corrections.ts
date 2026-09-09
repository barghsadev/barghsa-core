const en = {
  title: 'Invoice corrections',
  description:
    'Replace an unpaid invoice, or issue a charge or credit after payment. Original lines remain available to the customer.',
  invoiceId: 'Original invoice ID',
  load: 'Load invoice for correction',
  loading: 'Loading invoice…',
  loadError: 'The invoice could not be loaded. Check the reference and your finance access.',
  source: 'Original invoice',
  paid: 'Confirmed payment',
  state: 'Invoice state',
  unavailable: 'This invoice cannot be corrected in its current state.',
  replacementTitle: 'Cancel and replace invoice',
  adjustmentTitle: 'Adjust paid invoice',
  replacementIssue: 'Cancel original and issue replacement',
  adjustmentIssue: 'Issue adjustment',
  reason: 'Explanation shown to customer',
  amount: 'Adjustment amount (IRR)',
  amountHint:
    'Positive adds a charge; negative creates a credit note. A credit note does not transfer money to the wallet.',
  total: 'Correction total',
  created: 'Correction issued.',
  retry: 'Retry this correction',
  uncertain:
    'The result is unknown. Retry this correction with the same details before starting another.',
  verifyTitle: 'Verify invoice correction',
  verifyDescription: 'Confirm your password to issue this correction.',
  verify: 'Verify and correct',
  issuing: 'Issuing correction…',
};
const fa: Record<keyof typeof en, string> = {
  title: 'اصلاح فاکتور',
  description:
    'فاکتور پرداخت‌نشده را جایگزین کنید یا پس از پرداخت، فاکتور بدهکار یا بستانکار صادر کنید. ردیف‌های اصلی برای مشتری قابل مشاهده می‌مانند.',
  invoiceId: 'شناسه فاکتور اصلی',
  load: 'دریافت فاکتور برای اصلاح',
  loading: 'در حال دریافت فاکتور…',
  loadError: 'فاکتور دریافت نشد. شناسه و دسترسی مالی خود را بررسی کنید.',
  source: 'فاکتور اصلی',
  paid: 'پرداخت تأییدشده',
  state: 'وضعیت فاکتور',
  unavailable: 'این فاکتور در وضعیت فعلی قابل اصلاح نیست.',
  replacementTitle: 'لغو و جایگزینی فاکتور',
  adjustmentTitle: 'اصلاح فاکتور پرداخت‌شده',
  replacementIssue: 'لغو اصل و صدور فاکتور جایگزین',
  adjustmentIssue: 'صدور فاکتور اصلاحی',
  reason: 'شرح تغییرات برای مشتری',
  amount: 'مبلغ اصلاح (ریال)',
  amountHint:
    'مبلغ مثبت بدهی اضافه می‌کند؛ مبلغ منفی سند بستانکار ایجاد می‌کند. سند بستانکار به کیف پول وجه منتقل نمی‌کند.',
  total: 'جمع اصلاح',
  created: 'فاکتور اصلاحی صادر شد.',
  retry: 'تلاش مجدد برای همین اصلاح',
  uncertain:
    'نتیجه اصلاح مشخص نیست. پیش از شروع اصلاح دیگری، همین درخواست را با همان اطلاعات دوباره ارسال کنید.',
  verifyTitle: 'تأیید هویت برای اصلاح فاکتور',
  verifyDescription: 'برای صدور این اصلاح، رمز عبور خود را تأیید کنید.',
  verify: 'تأیید و اصلاح',
  issuing: 'در حال صدور اصلاح…',
};
export function tInvoiceCorrections(key: string, locale: 'fa' | 'en'): string | undefined {
  return (locale === 'fa' ? fa : en)[key as keyof typeof en];
}
