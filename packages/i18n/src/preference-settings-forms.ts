import type { Locale } from './app.js';
export const en: Record<string, string> = {
  savedToast: 'Settings saved.',
  rejectedToast: 'Save rejected.',
  uncertainToast: 'Save could not be confirmed.',
  loading: 'Loading…',
  channelInvalid: 'Choose an available notification channel.',
  consentInvalid: 'Choose whether to receive marketing messages.',
  timezoneInvalid: 'Choose a timezone from the offered list.',
  validationUnavailable: 'Validation is unavailable. Please try again.',
  error: 'The request was rejected. Your choices are retained.',
  uncertain: 'This save could not be confirmed. Check the saved settings before trying again.',
  mismatch: 'The saved settings do not confirm this save. Your choices are retained.',
  refresh: 'Refresh saved settings',
  confirm: 'Check saved settings',
  restart: 'Return to editing',
  restartHelp:
    'Checking does not send another save. Return to editing to review your choices before saving again.',
  forbidden: 'These settings are no longer available. Reload the page after checking your access.',
};
export const fa: Record<string, string> = {
  savedToast: 'تنظیمات ذخیره شد.',
  rejectedToast: 'ذخیره رد شد.',
  uncertainToast: 'ذخیره تأیید نشد.',
  loading: 'در حال بارگذاری…',
  channelInvalid: 'یک کانال اعلان در دسترس انتخاب کنید.',
  consentInvalid: 'انتخاب کنید که پیام‌های بازاریابی را دریافت کنید یا نه.',
  timezoneInvalid: 'یک منطقه زمانی از فهرست انتخاب کنید.',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
  error: 'درخواست رد شد. انتخاب‌های شما حفظ شده‌اند.',
  uncertain: 'ذخیره تأیید نشد. پیش از تلاش دوباره، تنظیمات ذخیره‌شده را بررسی کنید.',
  mismatch: 'تنظیمات ذخیره‌شده این ذخیره را تأیید نمی‌کنند. انتخاب‌های شما حفظ شده‌اند.',
  refresh: 'تازه‌سازی تنظیمات ذخیره‌شده',
  confirm: 'بررسی تنظیمات ذخیره‌شده',
  restart: 'بازگشت به ویرایش',
  restartHelp:
    'بررسی، ذخیره دیگری ارسال نمی‌کند. برای بازبینی انتخاب‌ها پیش از ذخیره دوباره، به ویرایش بازگردید.',
  forbidden: 'این تنظیمات دیگر در دسترس نیستند. پس از بررسی دسترسی، صفحه را دوباره بارگذاری کنید.',
};
export function tPreferenceSettingsForms(key: string, locale: Locale = 'fa') {
  return (locale === 'fa' ? fa : en)[key] ?? key;
}
