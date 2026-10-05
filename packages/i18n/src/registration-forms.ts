import type { Locale } from './index.js';
const dictionary = {
  en: {
    codeInvalid: 'Enter all six digits of the verification code.',
    validationUnavailable: 'Validation is unavailable. Your entries are kept; try again.',
    uncertain:
      'The result is not confirmed. This request will not be sent again automatically. You can sign in or start a new registration.',
    restart: 'Start a new registration',
  },
  fa: {
    codeInvalid: 'هر شش رقم کد تأیید را وارد کنید.',
    validationUnavailable: 'اعتبارسنجی در دسترس نیست. اطلاعات شما حفظ شده است؛ دوباره تلاش کنید.',
    uncertain:
      'نتیجه تأیید نشده است. این درخواست خودکار دوباره ارسال نمی‌شود. می‌توانید وارد شوید یا ثبت‌نام تازه‌ای شروع کنید.',
    restart: 'شروع ثبت‌نام تازه',
  },
};
export const registrationFormKeys = Object.keys(dictionary.en);
export function registrationFormText(key: string, locale: Locale): string {
  return dictionary[locale][key as keyof typeof dictionary.en] ?? key;
}
