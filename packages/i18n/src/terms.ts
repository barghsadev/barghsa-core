import { lookup } from './lookup.js';
import type { I18nDictionary, Locale } from './app.js';
export type { Locale } from './app.js';

export const fa: I18nDictionary = {
  'tos.page.title': 'قوانین استفاده',
  'tos.page.lastUpdated': 'آخرین به‌روزرسانی: {date}',
  'tos.page.loading': 'در حال بارگذاری قوانین...',
  'tos.page.error': 'متأسفانه در بارگذاری قوانین استفاده خطایی رخ داد',
  'tos.page.backToHome': 'بازگشت به صفحه اصلی',
  'tos.banner.text': 'قوانین استفاده به‌روزرسانی شده‌اند.',
  'tos.page.retry': 'دریافت دوباره شرایط',
  'tos.page.language': 'زبان شرایط استفاده',
  'tos.banner.review': 'مشاهده',
  'tos.banner.checkFailed': 'وضعیت پذیرش شرایط دریافت نشد.',
  'tos.banner.retry': 'بررسی دوباره پذیرش شرایط',
  'tos.modal.title': 'قوانین استفاده',
  'tos.modal.close': 'بستن',
  'tos.modal.accept': 'می‌پذیرم',
  'tos.modal.accepting': 'در حال ثبت...',
  'tos.modal.success': 'قوانین استفاده با موفقیت پذیرفته شد.',
  'tos.modal.error': 'خطا در پذیرش قوانین. لطفاً دوباره تلاش کنید.',
};
export const en: I18nDictionary = {
  'tos.page.title': 'Terms of Service',
  'tos.page.lastUpdated': 'Last updated: {date}',
  'tos.page.loading': 'Loading terms of service...',
  'tos.page.error': 'An error occurred while loading the terms of service',
  'tos.page.backToHome': 'Back to home',
  'tos.banner.text': 'Terms of Service have been updated.',
  'tos.page.retry': 'Retry loading terms',
  'tos.page.language': 'Terms language',
  'tos.banner.review': 'Review',
  'tos.banner.checkFailed': 'Could not check your terms acceptance status.',
  'tos.banner.retry': 'Retry terms check',
  'tos.modal.title': 'Terms of Service',
  'tos.modal.close': 'Close',
  'tos.modal.accept': 'I Accept',
  'tos.modal.accepting': 'Accepting...',
  'tos.modal.success': 'Terms of Service accepted successfully.',
  'tos.modal.error': 'Failed to accept Terms of Service. Please try again.',
};
export function t(key: string, locale: Locale = 'fa'): string {
  return lookup(locale === 'fa' ? fa : en, key) ?? lookup(en, key) ?? key;
}
