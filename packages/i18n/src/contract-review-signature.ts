import type { Locale } from './app.js';
export const en: Record<string, string> = {
  reasonHelp:
    'Explain the requested changes in 1–1,000 characters. Publishing does not use this draft.',
  reasonInvalid: 'Enter a change request reason of 1–1,000 characters.',
  documentHelp: 'Select an approved copy linked to this contract version.',
  documentInvalid: 'Select an eligible approved document.',
  acknowledgementInvalid: 'Confirm that the selected copy is the signed contract.',
  uncertain:
    'This contract action could not be confirmed. Retry the captured command before editing.',
  retryCaptured: 'Retry captured contract action',
  validationUnavailable: 'Validation is unavailable. Please try again.',
};
export const fa: Record<string, string> = {
  reasonHelp:
    'تغییرات درخواستی را با ۱ تا ۱٬۰۰۰ نویسه شرح دهید. انتشار از این پیش‌نویس استفاده نمی‌کند.',
  reasonInvalid: 'دلیل درخواست تغییرات را با ۱ تا ۱٬۰۰۰ نویسه وارد کنید.',
  documentHelp: 'نسخه تأییدشده مرتبط با این نسخه قرارداد را انتخاب کنید.',
  documentInvalid: 'سند تأییدشده واجد شرایط را انتخاب کنید.',
  acknowledgementInvalid: 'تأیید کنید که نسخه انتخاب‌شده قرارداد امضاشده است.',
  uncertain: 'این اقدام قرارداد تأیید نشد. پیش از ویرایش همان فرمان ثبت‌شده را دوباره ارسال کنید.',
  retryCaptured: 'ارسال دوباره اقدام قرارداد ثبت‌شده',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
};
export function tContractReviewSignature(key: string, locale: Locale = 'fa'): string {
  return (locale === 'fa' ? fa : en)[key] ?? key;
}
