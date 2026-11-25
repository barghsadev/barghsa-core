import { timezoneDisplayMessages } from './timezone-display.js';

const en = {
  ...timezoneDisplayMessages.en,
  title: 'Timezone Settings',
  description: 'Select your timezone. All date and time displays will use this setting.',
  preview: 'Current time in selected timezone:',
  default: 'Default: Iran (UTC+3:30)',
  saving: 'Saving…',
  success: 'Timezone updated successfully',
  'error.save': 'Failed to save timezone settings',
  'error.invalid': 'Invalid timezone',
  searchPlaceholder: 'Search timezone…',
  showCurrentTime: 'Show current time',
  savedZone: 'Saved time zone',
} as const;

const fa: Record<keyof typeof en, string> = {
  ...timezoneDisplayMessages.fa,
  title: 'تنظیمات منطقه زمانی',
  description:
    'منطقه زمانی خود را انتخاب کنید. تمام نمایش‌های تاریخ و ساعت بر اساس این تنظیم خواهد بود.',
  preview: 'زمان فعلی در منطقه زمانی انتخاب شده:',
  default: 'پیش‌فرض: ایران (UTC+3:30)',
  saving: 'در حال ذخیره…',
  success: 'منطقه زمانی با موفقیت به‌روزرسانی شد',
  'error.save': 'خطا در ذخیره تنظیمات منطقه زمانی',
  'error.invalid': 'منطقه زمانی نامعتبر است',
  searchPlaceholder: 'جستجوی منطقه زمانی…',
  showCurrentTime: 'نمایش ساعت فعلی',
  savedZone: 'منطقه زمانی ذخیره‌شده',
};

export function timezoneText(key: keyof typeof en, locale: 'en' | 'fa'): string {
  return (locale === 'fa' ? fa : en)[key];
}

const persianCities: Readonly<Record<string, string>> = {
  'Asia/Tehran': 'تهران',
  'Europe/Istanbul': 'استانبول',
  'Asia/Istanbul': 'استانبول',
  'Asia/Dubai': 'دبی',
  'Asia/Baghdad': 'بغداد',
  'Asia/Kabul': 'کابل',
  'Asia/Riyadh': 'ریاض',
  'Asia/Tokyo': 'توکیو',
  'Europe/London': 'لندن',
  'Europe/Berlin': 'برلین',
  'Europe/Paris': 'پاریس',
  'America/New_York': 'نیویورک',
  'America/Toronto': 'تورنتو',
  UTC: 'زمان هماهنگ جهانی',
};
export function timezoneCityName(zone: string, locale: 'en' | 'fa'): string {
  return locale === 'fa' ? (persianCities[zone] ?? '') : '';
}
