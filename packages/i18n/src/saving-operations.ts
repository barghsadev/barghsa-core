import type { Locale } from './app.js';

export const en: Record<string, string> = {
  reasonInvalid: 'Enter a rejection reason of 1 to 1,000 characters.',
  explanationInvalid: 'Enter a stage explanation of 1 to 1,000 characters.',
  handoverInvalid: 'Enter handover details of 1 to 1,000 characters.',
  rejectionHelp:
    'Explain the rejection in at most 1,000 characters. Approval preserves this draft.',
  explanationHelp:
    'Explain the stage action in at most 1,000 characters. The customer can read it.',
  handoverHelp: 'Completion requires handover details. Skipping this optional stage does not.',
  checking: 'Checking the current order and financial review…',
  validationUnavailable: 'Validation is unavailable. Try again.',
  uncertain: 'This action could not be confirmed. Retry the captured command before editing.',
  retryCaptured: 'Retry captured staff action',
  missing: 'This order is unavailable.',
};

export const fa: Record<string, string> = {
  reasonInvalid: 'دلیل رد باید بین ۱ تا ۱٬۰۰۰ نویسه باشد.',
  explanationInvalid: 'توضیح مرحله باید بین ۱ تا ۱٬۰۰۰ نویسه باشد.',
  handoverInvalid: 'جزئیات تحویل باید بین ۱ تا ۱٬۰۰۰ نویسه باشد.',
  rejectionHelp: 'دلیل رد را در حداکثر ۱٬۰۰۰ نویسه بنویسید. تأیید، این پیش‌نویس را حفظ می‌کند.',
  explanationHelp: 'اقدام مرحله را در حداکثر ۱٬۰۰۰ نویسه توضیح دهید. مشتری می‌تواند آن را بخواند.',
  handoverHelp: 'تکمیل به جزئیات تحویل نیاز دارد. رد کردن این مرحله اختیاری به آن نیاز ندارد.',
  checking: 'در حال بررسی سفارش و اطلاعات مالی…',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
  uncertain: 'این اقدام تأیید نشد. پیش از ویرایش، همان فرمان ثبت‌شده را دوباره ارسال کنید.',
  retryCaptured: 'ارسال دوباره اقدام کارشناس ثبت‌شده',
  missing: 'این سفارش در دسترس نیست.',
};

export function tSavingOperations(key: string, locale: Locale = 'fa'): string {
  return (locale === 'fa' ? fa : en)[key] ?? key;
}
