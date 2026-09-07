const en = {
  'display.pending': 'Time unavailable',
  'display.invalid': 'Invalid timestamp',
  title: 'Timezone Settings',
  description: 'Select your timezone. All date and time displays will use this setting.',
  preview: 'Current time in selected timezone:',
  default: 'Default: Iran (UTC+3:30)',
  saving: 'Saving…',
  success: 'Timezone updated successfully',
  'error.load': 'Failed to load timezone',
  retry: 'Try again',
  'error.save': 'Failed to save timezone settings',
  'error.invalid': 'Invalid timezone',
  searchPlaceholder: 'Search timezone…',
  showCurrentTime: 'Show current time',
} as const;

const fa: Record<keyof typeof en, string> = {
  'display.pending': 'زمان در دسترس نیست',
  'display.invalid': 'زمان نامعتبر',
  title: 'تنظیمات منطقه زمانی',
  description:
    'منطقه زمانی خود را انتخاب کنید. تمام نمایش‌های تاریخ و ساعت بر اساس این تنظیم خواهد بود.',
  preview: 'زمان فعلی در منطقه زمانی انتخاب شده:',
  default: 'پیش‌فرض: ایران (UTC+3:30)',
  saving: 'در حال ذخیره…',
  success: 'منطقه زمانی با موفقیت به‌روزرسانی شد',
  'error.load': 'خطا در بارگذاری منطقه زمانی',
  retry: 'تلاش دوباره',
  'error.save': 'خطا در ذخیره تنظیمات منطقه زمانی',
  'error.invalid': 'منطقه زمانی نامعتبر است',
  searchPlaceholder: 'جستجوی منطقه زمانی…',
  showCurrentTime: 'نمایش ساعت فعلی',
};

export function timezoneText(key: keyof typeof en, locale: 'en' | 'fa'): string {
  return (locale === 'fa' ? fa : en)[key];
}
