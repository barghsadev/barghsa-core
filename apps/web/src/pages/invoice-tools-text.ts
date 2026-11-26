import type { Locale } from '@barghsa/i18n/app';

const en = {
  browseRecent: 'Choose a recent invoice',
  enterId: 'Enter invoice ID',
  recent: 'Recent invoices',
  chooseRecent: 'Select an invoice',
  loadingRecent: 'Loading recent invoices…',
  noRecent: 'There are no recent invoices.',
  recentUnavailable: 'Recent invoices could not be loaded.',
  retryRecent: 'Try again',
  findOlder: 'Find older invoices in the ledger',
};

const fa: Record<keyof typeof en, string> = {
  browseRecent: 'انتخاب از فاکتورهای اخیر',
  enterId: 'ورود شناسه فاکتور',
  recent: 'فاکتورهای اخیر',
  chooseRecent: 'یک فاکتور انتخاب کنید',
  loadingRecent: 'در حال بارگیری فاکتورهای اخیر…',
  noRecent: 'فاکتور اخیری وجود ندارد.',
  recentUnavailable: 'فاکتورهای اخیر بارگیری نشدند.',
  retryRecent: 'تلاش دوباره',
  findOlder: 'جست‌وجوی فاکتورهای قدیمی‌تر',
};

export function invoiceToolsText(key: keyof typeof en, locale: Locale): string {
  return (locale === 'fa' ? fa : en)[key];
}
