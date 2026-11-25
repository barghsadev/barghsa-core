const en = {
  'display.pending': 'Time unavailable',
  'display.invalid': 'Invalid timestamp',
  'error.load': 'Failed to load timezone',
  retry: 'Try again',
} as const;

const fa: Record<keyof typeof en, string> = {
  'display.pending': 'زمان در دسترس نیست',
  'display.invalid': 'زمان نامعتبر',
  'error.load': 'خطا در بارگذاری منطقه زمانی',
  retry: 'تلاش دوباره',
};

export const timezoneDisplayMessages = { en, fa };

export function timezoneDisplayText(key: keyof typeof en, locale: 'en' | 'fa'): string {
  return timezoneDisplayMessages[locale][key];
}
