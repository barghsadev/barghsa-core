import type { Locale } from './index.js';
// Shared invoice rows do not load the payment workspace's unrelated action copy.
export const en = {
  notSet: 'Not specified',
  profile: 'Profile',
  invoice: 'Invoice',
  service: 'Service',
  issued: 'Issued',
  payable: 'Payable from',
  due: 'Due date',
  discount: 'Discount',
  subtotal: 'Subtotal after discount',
  vat: 'VAT',
  invoiceTotal: 'Invoice total',
  alreadyPaid: 'Already paid',
  contract: 'Contract',
  initialPayment:
    'This pays the initial invoice. Activation still requires all contract prerequisites.',
  otherContractChecks: 'Payment does not replace the contract acceptance or activation checks.',
  signatureRequired: 'Signature is required for activation.',
  serviceStartRequired: 'The service start date must be reached before activation.',
  serviceStarts: 'Service starts',
  serviceEnds: 'Service ends',
  fullWalletRefund:
    'If this electricity contract is cancelled, refundable payments must return to the wallet.',
  staffRefund: 'Refunds on cancellation require a staff decision.',
  remaining: 'Invoice amount remaining',
  breakdown: 'Invoice breakdown',
  legacyBreakdown:
    'This older invoice has no stored item breakdown. Review its total before paying.',
};
export const fa: typeof en = {
  notSet: 'مشخص نشده',
  profile: 'پروفایل',
  invoice: 'فاکتور',
  service: 'خدمت',
  issued: 'تاریخ صدور',
  payable: 'قابل پرداخت از',
  due: 'سررسید',
  discount: 'تخفیف',
  subtotal: 'جمع پس از تخفیف',
  vat: 'مالیات بر ارزش افزوده',
  invoiceTotal: 'مبلغ کل فاکتور',
  alreadyPaid: 'پرداخت‌شده',
  contract: 'قرارداد',
  initialPayment:
    'فاکتور اولیه پرداخت می‌شود. فعال‌سازی همچنان به همه پیش‌نیازهای قرارداد نیاز دارد.',
  otherContractChecks: 'پرداخت جایگزین تأیید قرارداد یا بررسی‌های فعال‌سازی نیست.',
  signatureRequired: 'برای فعال‌سازی، امضا لازم است.',
  serviceStartRequired: 'برای فعال‌سازی، رسیدن تاریخ شروع خدمت لازم است.',
  serviceStarts: 'شروع خدمت',
  serviceEnds: 'پایان خدمت',
  fullWalletRefund: 'در صورت لغو این قرارداد برق، مبالغ قابل استرداد باید به کیف پول بازگردند.',
  staffRefund: 'استرداد وجه هنگام لغو به تصمیم کارشناس نیاز دارد.',
  remaining: 'مانده مبلغ فاکتور',
  breakdown: 'جزئیات محاسبه فاکتور',
  legacyBreakdown:
    'جزئیات اقلام این فاکتور قدیمی ذخیره نشده است. مبلغ کل را پیش از پرداخت بررسی کنید.',
};
export type InvoiceFinancialReviewKey = keyof typeof en;
export function tInvoiceFinancialReview(
  key: InvoiceFinancialReviewKey,
  locale: Locale = 'fa'
): string {
  return (locale === 'fa' ? fa : en)[key];
}
