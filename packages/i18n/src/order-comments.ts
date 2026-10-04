import type { Locale } from './app.js';

export const en: Record<string, string> = {
  bodyInvalid: 'Enter a message of 1 to 10,000 characters.',
  bodyHelp: 'Write your message in at most 10,000 characters.',
  visibilityInvalid: 'Choose who can see this message.',
  visibilityHelp: 'Internal messages are visible only to staff.',
  validationUnavailable: 'Validation is unavailable. Try again.',
  checking: 'Checking message…',
  uncertain: 'The result could not be confirmed. Retry the captured comment before changing it.',
  retryCaptured: 'Retry captured comment',
  retryLoad: 'Reload comments',
  forbidden: 'You cannot access comments on this order.',
  missing: 'Comments on this order are unavailable.',
};

export const fa: Record<string, string> = {
  bodyInvalid: 'پیام باید بین ۱ تا ۱۰٬۰۰۰ نویسه باشد.',
  bodyHelp: 'پیام خود را در حداکثر ۱۰٬۰۰۰ نویسه بنویسید.',
  visibilityInvalid: 'مخاطب پیام را انتخاب کنید.',
  visibilityHelp: 'پیام داخلی فقط برای کارکنان نمایش داده می‌شود.',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
  checking: 'در حال بررسی پیام…',
  uncertain: 'نتیجه ارسال تأیید نشد. پیش از تغییر، همان پیام را دوباره ارسال کنید.',
  retryCaptured: 'ارسال دوباره پیام ثبت‌شده',
  retryLoad: 'بارگذاری دوباره پیام‌ها',
  forbidden: 'دسترسی به پیام‌های این سفارش ندارید.',
  missing: 'پیام‌های این سفارش در دسترس نیست.',
};

export function tOrderComments(key: string, locale: Locale = 'fa'): string {
  return (locale === 'fa' ? fa : en)[key] ?? key;
}
