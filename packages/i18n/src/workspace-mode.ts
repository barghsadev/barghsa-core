const fa = {
  toStaff: 'رفتن به حالت کارکنان',
  toCustomer: 'رفتن به حالت مشتری',
  denied: 'تغییر حالت ناموفق بود. دوباره تلاش کنید.',
  check: 'بررسی حالت فعلی',
};

const en: Record<keyof typeof fa, string> = {
  toStaff: 'Switch to staff',
  toCustomer: 'Switch to customer',
  denied: 'Could not switch mode. Please try again.',
  check: 'Check current mode',
};

export function workspaceModeText(key: keyof typeof fa, locale: 'fa' | 'en') {
  return (locale === 'fa' ? fa : en)[key];
}
