const en = {
  overview: 'Manage your account, display and communication preferences.',
  account: 'Account settings',
  display: 'Language and display',
  loadFailed: 'Could not load your preferences. Try again before making changes.',
  retry: 'Try again',
  unavailableChannel: 'Add and verify this contact in account settings to enable this channel.',
  alwaysOn: 'Always on',
  securityAlerts: 'Security alerts usually use all enabled channels.',
} as const;

const fa: Record<keyof typeof en, string> = {
  overview: 'حساب کاربری، نمایش و روش‌های ارتباط با برقسا را تنظیم کنید.',
  account: 'تنظیمات حساب کاربری',
  display: 'زبان و نمایش',
  loadFailed: 'تنظیمات شما بارگذاری نشد. پیش از تغییر، دوباره تلاش کنید.',
  retry: 'تلاش دوباره',
  unavailableChannel: 'برای فعال‌سازی این روش، اطلاعات تماس را در تنظیمات حساب اضافه و تأیید کنید.',
  alwaysOn: 'همیشه فعال',
  securityAlerts: 'اعلان‌های امنیتی معمولاً از همه روش‌های فعال ارسال می‌شوند.',
};

export function preferencesText(key: keyof typeof en, locale: 'en' | 'fa'): string {
  return (locale === 'fa' ? fa : en)[key];
}
