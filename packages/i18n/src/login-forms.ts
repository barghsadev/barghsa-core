import type { Locale } from './auth.js';
const en = {
  passwordRequired: 'Enter your password',
  codeInvalid: 'Enter the six-digit verification code',
  validationUnavailable: 'Validation is unavailable. Please try again.',
  uncertain:
    'The sign-in result is not confirmed. This request will not be sent again automatically. Start a new sign-in to continue.',
  restart: 'Start a new sign-in',
};
const fa: Record<keyof typeof en, string> = {
  passwordRequired: 'رمز عبور را وارد کنید',
  codeInvalid: 'کد تأیید شش‌رقمی را وارد کنید',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
  uncertain:
    'نتیجه ورود تأیید نشده است. این درخواست خودکار دوباره ارسال نمی‌شود. برای ادامه، ورود تازه‌ای شروع کنید.',
  restart: 'شروع ورود تازه',
};
export function loginFormText(key: keyof typeof en, locale: Locale): string {
  return (locale === 'fa' ? fa : en)[key];
}
export const loginFormDictionaries = { en, fa };
