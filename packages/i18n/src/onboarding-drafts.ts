import { lookup } from './lookup.js';
export type Locale = 'fa' | 'en';
export const fa = {
  title: 'پروفایل‌های ناتمام',
  help: 'پروفایل ناتمام خود را ادامه دهید یا از بخش زیر یک پروفایل جدید بسازید.',
  INDIVIDUAL: 'پروفایل حقیقی',
  LEGAL: 'پروفایل حقوقی',
  saved: 'آخرین ذخیره',
  created: 'تاریخ ایجاد',
  resume: 'ادامه فرم',
  restart: 'شروع دوباره فرم',
  start: 'تکمیل فرم',
  expired: 'مهلت پیش‌نویس تمام شده است. فرم را از ابتدا تکمیل کنید؛ پروفایل شما حفظ می‌شود.',
  loading: 'در حال دریافت پروفایل‌های ناتمام…',
  error: 'دریافت پروفایل‌های ناتمام ناموفق بود. دوباره تلاش کنید.',
  denied: 'دسترسی شما تغییر کرده است. دوباره وارد حساب شوید.',
  retry: 'تلاش دوباره',
  more: 'پروفایل‌های بیشتر',
};
export const en: Record<keyof typeof fa, string> = {
  title: 'Unfinished profiles',
  help: 'Resume an unfinished profile or create a new profile below.',
  INDIVIDUAL: 'Personal profile',
  LEGAL: 'Company profile',
  saved: 'Last saved',
  created: 'Created',
  resume: 'Resume form',
  restart: 'Restart form',
  start: 'Complete form',
  expired: 'This draft expired. Fill in the form again; your profile is kept.',
  loading: 'Loading unfinished profiles…',
  error: 'Could not load unfinished profiles. Please retry.',
  denied: 'Your access changed. Sign in again.',
  retry: 'Retry',
  more: 'More profiles',
};
export function t(key: keyof typeof fa, locale: Locale = 'fa') {
  return lookup(locale === 'fa' ? fa : en, key) ?? key;
}
