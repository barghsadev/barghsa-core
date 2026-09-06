const en = {
  loadFailed: 'Could not load your preferences. Try again before making changes.',
  retry: 'Try again',
} as const;

const fa: Record<keyof typeof en, string> = {
  loadFailed: 'تنظیمات شما بارگذاری نشد. پیش از تغییر، دوباره تلاش کنید.',
  retry: 'تلاش دوباره',
};

export function preferencesText(key: keyof typeof en, locale: 'en' | 'fa'): string {
  return (locale === 'fa' ? fa : en)[key];
}
