const en = {
  invalidHistory: 'Invalid TOS history response.',
  historyFailed: 'Failed to load TOS versions',
  retry: 'Retry',
};
const fa: Record<keyof typeof en, string> = {
  invalidHistory: 'پاسخ تاریخچه شرایط معتبر نیست.',
  historyFailed: 'بارگذاری تاریخچه شرایط انجام نشد.',
  retry: 'تلاش دوباره',
};
export const adminTosText = (locale: 'fa' | 'en') => (locale === 'fa' ? fa : en);
