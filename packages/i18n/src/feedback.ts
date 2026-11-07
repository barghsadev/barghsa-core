import { loadingText } from './loading-feedback.js';

const messages = {
  en: {
    region: 'Application messages',
    close: 'Dismiss message',
    errorTitle: 'Something went wrong',
    errorDescription: 'Please try again. If the problem persists, contact support.',
    chunkTitle: 'Failed to load this page',
    chunkDescription: 'Check your connection and try again.',
    retry: 'Try again',
    reload: 'Reload page',
    notFound: 'Page not found',
    notFoundDescription: 'Check the address or go back to the home page.',
    support: 'Contact support',
    home: 'Go home',
    details: 'Support details',
    reference: 'Reference',
  },
  fa: {
    region: 'پیام‌های برنامه',
    close: 'بستن پیام',
    errorTitle: 'خطایی رخ داد',
    errorDescription: 'دوباره تلاش کنید. اگر مشکل ادامه داشت، با پشتیبانی تماس بگیرید.',
    chunkTitle: 'بارگذاری صفحه ناموفق بود',
    chunkDescription: 'اتصال اینترنت خود را بررسی و دوباره تلاش کنید.',
    retry: 'تلاش دوباره',
    reload: 'بارگذاری دوباره صفحه',
    notFound: 'صفحه پیدا نشد',
    notFoundDescription: 'نشانی را بررسی کنید یا به صفحه اصلی برگردید.',
    support: 'تماس با پشتیبانی',
    home: 'صفحه اصلی',
    details: 'جزئیات برای پشتیبانی',
    reference: 'شناسه پیگیری',
  },
} as const;

export function feedbackText(
  key: keyof typeof messages.en | 'loading' | 'loadingAdmin',
  locale: 'en' | 'fa'
): string {
  return key === 'loading' || key === 'loadingAdmin'
    ? loadingText(key, locale)
    : messages[locale][key];
}
