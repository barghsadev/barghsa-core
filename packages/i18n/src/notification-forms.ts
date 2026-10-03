import type { Locale } from './app.js';
const en = {
  eventKey: 'Enter an event key without spaces, up to 100 characters.',
  channel: 'Select email, SMS or in-app delivery.',
  locale: 'Select Persian or English.',
  subject: 'Use up to 200 characters and only declared variables in the subject.',
  bodyTemplate: 'Enter a body with complete placeholders using only declared variables.',
  variables: 'Use variable names up to 100 characters and descriptions up to 500 characters.',
  timezone: 'Select a valid IANA timezone.',
  startHour: 'Enter a start time between 00:00 and 23:59.',
  endHour: 'Enter an end time after the start, allowing at least four hours.',
  validationUnavailable: 'Validation could not load. Try submitting again.',
  stale: 'Saved settings changed. Reset to the latest settings before saving.',
  uncertain: 'The save could not be verified. Refresh and reset before trying again.',
  reset: 'Reset to saved values',
  refresh: 'Refresh delivery settings',
  denied: 'You no longer have access to these delivery settings.',
};
const fa: Record<keyof typeof en, string> = {
  eventKey: 'کلید رویداد را بدون فاصله و حداکثر با ۱۰۰ نویسه وارد کنید.',
  channel: 'ارسال ایمیل، پیامک یا درون‌برنامه‌ای را انتخاب کنید.',
  locale: 'فارسی یا انگلیسی را انتخاب کنید.',
  subject: 'موضوع را حداکثر با ۲۰۰ نویسه و فقط با متغیرهای تعریف‌شده وارد کنید.',
  bodyTemplate: 'متن را با جای‌نگهدارهای کامل و فقط متغیرهای تعریف‌شده وارد کنید.',
  variables: 'نام متغیر حداکثر ۱۰۰ نویسه و توضیح آن حداکثر ۵۰۰ نویسه باشد.',
  timezone: 'یک منطقه زمانی معتبر IANA انتخاب کنید.',
  startHour: 'زمان شروع را بین ۰۰:۰۰ و ۲۳:۵۹ وارد کنید.',
  endHour: 'زمان پایان باید پس از شروع باشد و حداقل چهار ساعت فاصله داشته باشد.',
  validationUnavailable: 'اعتبارسنجی بارگیری نشد. دوباره ارسال کنید.',
  stale: 'تنظیمات ذخیره‌شده تغییر کرده است. پیش از ذخیره، آخرین تنظیمات را بازنشانی کنید.',
  uncertain: 'ذخیره تأیید نشد. پیش از تلاش دوباره، تازه‌سازی و بازنشانی کنید.',
  reset: 'بازنشانی به مقادیر ذخیره‌شده',
  refresh: 'تازه‌سازی تنظیمات ارسال',
  denied: 'دیگر به این تنظیمات ارسال دسترسی ندارید.',
};
export type NotificationFormKey = keyof typeof en;
export function notificationFormText(key: NotificationFormKey, locale: Locale): string {
  return (locale === 'fa' ? fa : en)[key];
}
