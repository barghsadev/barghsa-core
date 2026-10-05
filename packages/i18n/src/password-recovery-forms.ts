import type { Locale } from './index.js';
const en = {
  usernameInvalid: 'Enter an email address or a valid mobile number.',
  codeInvalid: 'Enter all six digits of the verification code.',
  validationUnavailable: 'Validation is unavailable. Your entries are kept; try again.',
  uncertain:
    'The result is not confirmed. This request will not be sent again automatically. You can sign in to check your password or start a new recovery.',
  restart: 'Start a new recovery',
} as const;
const fa: Record<keyof typeof en, string> = {
  usernameInvalid: 'ایمیل یا شماره موبایل معتبر وارد کنید.',
  codeInvalid: 'هر شش رقم کد تأیید را وارد کنید.',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. اطلاعات واردشده حفظ شده؛ دوباره تلاش کنید.',
  uncertain:
    'نتیجه تأیید نشده است. این درخواست خودکار دوباره ارسال نمی‌شود. می‌توانید برای بررسی رمز عبور وارد شوید یا بازیابی تازه‌ای شروع کنید.',
  restart: 'شروع بازیابی تازه',
};
export const passwordRecoveryDictionaries = { en, fa };
export function passwordRecoveryText(key: string, locale: Locale): string {
  return passwordRecoveryDictionaries[locale][key as keyof typeof en] ?? key;
}
