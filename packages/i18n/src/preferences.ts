const en = {
  loadFailed: 'Could not load your preferences. Try again before making changes.',
  retry: 'Try again',
  unavailableChannel: 'Add and verify this contact in account settings to enable this channel.',
} as const;

const fa: Record<keyof typeof en, string> = {
  loadFailed: 'تنظیمات شما بارگذاری نشد. پیش از تغییر، دوباره تلاش کنید.',
  retry: 'تلاش دوباره',
  unavailableChannel: 'برای فعال‌سازی این روش، اطلاعات تماس را در تنظیمات حساب اضافه و تأیید کنید.',
};

export function preferencesText(key: keyof typeof en, locale: 'en' | 'fa'): string {
  return (locale === 'fa' ? fa : en)[key];
}
