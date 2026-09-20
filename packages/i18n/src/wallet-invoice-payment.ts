const en = {
  title: 'Pay from wallet',
  remaining: 'Invoice amount remaining',
  available: 'Available wallet balance',
  pay: 'Review wallet payment',
  retry: 'Retry this payment',
  refresh: 'Review latest amount',
  loading: 'Checking invoice and wallet…',
  loadError: 'Could not check the invoice and wallet. Try again.',
  unavailable: 'The invoice cannot be paid from the available wallet balance right now.',
  confirm: 'Confirm wallet payment',
  description: 'Pay {amount} from your wallet for invoice {invoice}. Available balance: {balance}.',
  conflict: 'The invoice or wallet changed. Close this dialog and review the latest amount.',
  denied: 'Your payment access is unavailable. Sign in again and check the active profile.',
  retryHint:
    'If the result is unclear, retry this payment. The same request is kept until you review a changed invoice amount.',
  request: 'Payment request',
  paid: 'Invoice paid from wallet.',
  reference: 'Wallet transaction',
  refreshError:
    'Payment completed, but invoice details could not refresh. Reload this page to check them.',
};
const fa: Record<keyof typeof en, string> = {
  title: 'پرداخت از کیف پول',
  remaining: 'مانده مبلغ فاکتور',
  available: 'موجودی قابل استفاده کیف پول',
  pay: 'بررسی پرداخت از کیف پول',
  retry: 'تلاش مجدد برای همین پرداخت',
  refresh: 'بررسی مبلغ فعلی',
  loading: 'در حال بررسی فاکتور و کیف پول…',
  loadError: 'بررسی فاکتور و کیف پول ممکن نشد. دوباره تلاش کنید.',
  unavailable: 'در حال حاضر پرداخت این فاکتور از موجودی قابل استفاده کیف پول ممکن نیست.',
  confirm: 'تأیید پرداخت از کیف پول',
  description:
    'مبلغ {amount} از کیف پول برای فاکتور {invoice} پرداخت شود. موجودی قابل استفاده: {balance}.',
  conflict: 'فاکتور یا کیف پول تغییر کرده است. این پنجره را ببندید و مبلغ فعلی را بررسی کنید.',
  denied: 'دسترسی پرداخت شما در دسترس نیست. دوباره وارد شوید و پروفایل فعال را بررسی کنید.',
  retryHint:
    'اگر نتیجه مشخص نیست، همین پرداخت را دوباره ارسال کنید. تا زمان بررسی مبلغ تغییریافته فاکتور، همان درخواست حفظ می‌شود.',
  request: 'درخواست پرداخت',
  paid: 'فاکتور از کیف پول پرداخت شد.',
  reference: 'تراکنش کیف پول',
  refreshError:
    'پرداخت انجام شد، اما اطلاعات فاکتور به‌روز نشد. برای بررسی، صفحه را دوباره بارگذاری کنید.',
};
export function tWalletInvoicePayment(key: keyof typeof en, locale: 'fa' | 'en'): string {
  return (locale === 'fa' ? fa : en)[key];
}
