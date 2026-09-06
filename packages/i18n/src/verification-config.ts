const en = {
  title: 'Profile Verification',
  description: 'Choose how profile verification requests are handled.',
  loading: 'Loading verification configuration…',
  loadFailed: 'Could not load verification settings. Try again before making changes.',
  saveFailed: 'Could not confirm the change. Your selection is preserved.',
  saved: 'Verification mode updated.',
  save: 'Save Configuration',
  saving: 'Saving…',
  retry: 'Try again',
  DISABLED: 'No verification',
  DISABLED_description: 'Profiles do not require identity verification.',
  MANUAL: 'Manual verification',
  MANUAL_description: 'Staff review and verify profiles manually.',
  API: 'Automatic verification',
  API_description: 'Unavailable. No identity-verification provider is configured.',
} as const;

const fa: Record<keyof typeof en, string> = {
  title: 'احراز هویت پروفایل',
  description: 'روش رسیدگی به درخواست‌های احراز هویت پروفایل را انتخاب کنید.',
  loading: 'در حال بارگذاری تنظیمات احراز هویت…',
  loadFailed: 'تنظیمات احراز هویت بارگذاری نشد. پیش از تغییر، دوباره تلاش کنید.',
  saveFailed: 'تغییر تأیید نشد. انتخاب شما حفظ شده است.',
  saved: 'روش احراز هویت به‌روزرسانی شد.',
  save: 'ذخیره تنظیمات',
  saving: 'در حال ذخیره…',
  retry: 'تلاش دوباره',
  DISABLED: 'بدون احراز هویت',
  DISABLED_description: 'پروفایل‌ها به احراز هویت نیاز ندارند.',
  MANUAL: 'احراز هویت دستی',
  MANUAL_description: 'کارکنان پروفایل‌ها را بررسی و تأیید می‌کنند.',
  API: 'احراز هویت خودکار',
  API_description: 'در دسترس نیست. ارائه‌دهنده احراز هویت پیکربندی نشده است.',
};

export function verificationConfigText(key: keyof typeof en, locale: 'en' | 'fa'): string {
  return (locale === 'fa' ? fa : en)[key];
}
