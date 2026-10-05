import type { Locale } from './app.js';
export const en: Record<string, string> = {
  usernameInvalid: 'Enter a valid email or international mobile number.',
  emailInvalid: 'Enter a valid email address.',
  mobileInvalid: 'Enter a valid international or Iranian mobile number.',
  otpInvalid: 'Enter the six-digit verification code.',
  validationUnavailable: 'Validation is unavailable. Please try again.',
  error: 'The request was rejected. Your entries are retained.',
  uncertain: 'This request could not be confirmed. Check your account before starting again.',
  mismatch: 'The current account does not confirm this request. Your entries are retained.',
  refresh: 'Refresh account',
  confirm: 'Check account confirmation',
  restart: 'Restart this request',
  restartHelp:
    'After checking the account, restart to request a new code. Existing codes may no longer work.',
  forbidden: 'Your account is no longer available. Sign in again.',
};
export const fa: Record<string, string> = {
  usernameInvalid: 'ایمیل یا شماره موبایل بین‌المللی معتبر وارد کنید.',
  emailInvalid: 'ایمیل معتبر وارد کنید.',
  mobileInvalid: 'شماره موبایل بین‌المللی یا ایرانی معتبر وارد کنید.',
  otpInvalid: 'کد تأیید شش‌رقمی را وارد کنید.',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
  error: 'درخواست رد شد. ورودی‌های شما حفظ شده‌اند.',
  uncertain: 'این درخواست تأیید نشد. پیش از شروع دوباره، حساب خود را بررسی کنید.',
  mismatch: 'حساب فعلی این درخواست را تأیید نمی‌کند. ورودی‌های شما حفظ شده‌اند.',
  refresh: 'تازه‌سازی حساب',
  confirm: 'بررسی تأیید حساب',
  restart: 'شروع دوباره این درخواست',
  restartHelp:
    'پس از بررسی حساب، برای دریافت کد جدید دوباره شروع کنید. کدهای قبلی ممکن است دیگر معتبر نباشند.',
  forbidden: 'حساب شما دیگر در دسترس نیست. دوباره وارد شوید.',
};
export function tAccountSettingsForms(key: string, locale: Locale = 'fa'): string {
  return (locale === 'fa' ? fa : en)[key] ?? key;
}
