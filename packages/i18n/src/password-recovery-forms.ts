import type { Locale } from './index.js';
const en = {
  requestInstructions:
    'Use the email or mobile number on your account to request a verification code.',
  activationInstructions: 'Enter the activation code from your invitation and choose a password.',
  usernameInvalid: 'Enter an email address or a valid mobile number.',
  codeInvalid: 'Enter all six digits of the verification code.',
  validationUnavailable: 'Validation is unavailable. Your entries are kept; try again.',
  uncertain:
    'The result is not confirmed. This request will not be sent again automatically. You can sign in to check your password or start a new recovery.',
  restart: 'Start a new recovery',
  activationCode: 'Activation code',
  activationUnconfirmed:
    'Activation could not be confirmed. Try signing in with the password you entered. If you cannot sign in, ask your administrator for a new link.',
} as const;
const fa: Record<keyof typeof en, string> = {
  requestInstructions:
    'برای دریافت کد تأیید، ایمیل یا شماره موبایل ثبت‌شده در حساب خود را وارد کنید.',
  activationInstructions: 'کد فعال‌سازی دعوت‌نامه را وارد کنید و رمز عبور بسازید.',
  usernameInvalid: 'ایمیل یا شماره موبایل معتبر وارد کنید.',
  codeInvalid: 'هر شش رقم کد تأیید را وارد کنید.',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. اطلاعات واردشده حفظ شده؛ دوباره تلاش کنید.',
  uncertain:
    'نتیجه تأیید نشده است. این درخواست خودکار دوباره ارسال نمی‌شود. می‌توانید برای بررسی رمز عبور وارد شوید یا بازیابی تازه‌ای شروع کنید.',
  restart: 'شروع بازیابی تازه',
  activationCode: 'کد فعال‌سازی',
  activationUnconfirmed:
    'فعال‌سازی تأیید نشد. با رمز واردشده ورود را امتحان کنید. اگر نتوانستید وارد شوید، از مدیر سامانه پیوند جدید بخواهید.',
};
export const passwordRecoveryDictionaries = { en, fa };
export function passwordRecoveryText(key: string, locale: Locale): string {
  return passwordRecoveryDictionaries[locale][key as keyof typeof en] ?? key;
}
