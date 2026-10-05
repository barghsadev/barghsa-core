import type { Locale } from './app.js';
export const en: Record<string, string> = {
  titleInvalid: 'Enter a title of up to 50 characters.',
  firstNameInvalid: 'Enter a first name of 1–100 characters.',
  lastNameInvalid: 'Enter a last name of 1–100 characters.',
  nationalIdInvalid: 'Enter a valid national ID.',
  legalNameInvalid: 'Enter a company name of 1–200 characters.',
  nationalIdentifierInvalid: 'Enter a valid company national identifier.',
  provinceIdInvalid: 'Select an available province.',
  cityIdInvalid: 'Select an available city in this province.',
  fullAddressInvalid: 'Enter an address of 1–500 characters.',
  postalCodeInvalid: 'Enter a valid ten-digit postal code.',
  validationUnavailable: 'Validation is unavailable. Please try again.',
  uncertain: 'This save could not be confirmed. Review the captured request before editing.',
  retryOriginal: 'Retry captured settings request',
  refreshConfirmation: 'Refresh confirmation',
  resetCapture: 'Reset captured save',
  confirmationMismatch:
    'The current saved values do not confirm this request. Your draft is retained.',
  error: 'The request could not be completed. Your draft is retained.',
  forbidden: 'This profile is no longer available for this action.',
  refreshProfile: 'Refresh profile',
};
export const fa: Record<string, string> = {
  titleInvalid: 'عنوان را با حداکثر ۵۰ نویسه وارد کنید.',
  firstNameInvalid: 'نام را با ۱ تا ۱۰۰ نویسه وارد کنید.',
  lastNameInvalid: 'نام خانوادگی را با ۱ تا ۱۰۰ نویسه وارد کنید.',
  nationalIdInvalid: 'کد ملی معتبر وارد کنید.',
  legalNameInvalid: 'نام شرکت را با ۱ تا ۲۰۰ نویسه وارد کنید.',
  nationalIdentifierInvalid: 'شناسه ملی معتبر شرکت را وارد کنید.',
  provinceIdInvalid: 'یک استان در دسترس انتخاب کنید.',
  cityIdInvalid: 'یک شهر در دسترس از همین استان انتخاب کنید.',
  fullAddressInvalid: 'آدرس را با ۱ تا ۵۰۰ نویسه وارد کنید.',
  postalCodeInvalid: 'کد پستی معتبر ده‌رقمی وارد کنید.',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
  uncertain: 'این ذخیره تأیید نشد. پیش از ویرایش، درخواست ثبت‌شده را بررسی کنید.',
  retryOriginal: 'ارسال دوباره درخواست تنظیمات ثبت‌شده',
  refreshConfirmation: 'بررسی دوباره تأیید',
  resetCapture: 'آزاد کردن ذخیره ثبت‌شده',
  confirmationMismatch:
    'مقادیر ذخیره‌شده فعلی این درخواست را تأیید نمی‌کنند. پیش‌نویس شما حفظ شده است.',
  error: 'درخواست انجام نشد. پیش‌نویس شما حفظ شده است.',
  forbidden: 'این پروفایل دیگر برای این اقدام در دسترس نیست.',
  refreshProfile: 'تازه‌سازی پروفایل',
};
export function tSettingsForms(key: string, locale: Locale = 'fa'): string {
  return (locale === 'fa' ? fa : en)[key] ?? key;
}
