import type { Locale } from './app.js';
export const en: Record<string, string> = {
  reasonHelp: 'Explain this version change in 1–1,000 characters.',
  reasonInvalid: 'Enter a change description of 1–1,000 characters.',
  titleInvalid: 'Enter a title for the new contract.',
  textInvalid: 'Enter terms for the new contract.',
  profileInvalid: 'Select an available profile.',
  orderInvalid: 'Select an available order for this profile and service.',
  valueInvalid: 'Select a supported contract value.',
  amountHelp: 'Use a whole IRR amount from 0 to 9,223,372,036,854,775,807.',
  amountInvalid: 'Enter a valid whole IRR amount.',
  descriptionHelp: 'Describe the variable value in 1–500 characters.',
  descriptionInvalid: 'Enter a variable value description of 1–500 characters.',
  contentInvalid: 'Keep nonempty contract content within 64 KiB.',
  invoiceInvalid: 'Enter a valid invoice ID or leave it empty.',
  startInvalid: 'Enter a valid local service start time.',
  endInvalid: 'Enter a valid local end time after the service start.',
  dateHelp: 'Times use your account timezone. An unchanged time keeps its original instant.',
  uncertain: 'This save could not be confirmed. Retry the captured command before editing.',
  retryCaptured: 'Retry captured contract save',
  validationUnavailable: 'Validation is unavailable. Please try again.',
};
export const fa: Record<string, string> = {
  reasonHelp: 'تغییر این نسخه را با ۱ تا ۱٬۰۰۰ نویسه شرح دهید.',
  reasonInvalid: 'شرح تغییرات را با ۱ تا ۱٬۰۰۰ نویسه وارد کنید.',
  titleInvalid: 'عنوان قرارداد جدید را وارد کنید.',
  textInvalid: 'شرایط قرارداد جدید را وارد کنید.',
  profileInvalid: 'یک پروفایل در دسترس انتخاب کنید.',
  orderInvalid: 'سفارش در دسترس همین پروفایل و خدمت را انتخاب کنید.',
  valueInvalid: 'یک نوع مبلغ پشتیبانی‌شده انتخاب کنید.',
  amountHelp: 'مبلغ صحیح ریالی از ۰ تا ۹٬۲۲۳٬۳۷۲٬۰۳۶٬۸۵۴٬۷۷۵٬۸۰۷ وارد کنید.',
  amountInvalid: 'مبلغ صحیح و معتبر ریالی وارد کنید.',
  descriptionHelp: 'مبلغ متغیر را با ۱ تا ۵۰۰ نویسه شرح دهید.',
  descriptionInvalid: 'شرح مبلغ متغیر را با ۱ تا ۵۰۰ نویسه وارد کنید.',
  contentInvalid: 'محتوای غیرخالی قرارداد باید حداکثر ۶۴ کیبی‌بایت باشد.',
  invoiceInvalid: 'شناسه معتبر صورتحساب وارد کنید یا خالی بگذارید.',
  startInvalid: 'زمان محلی معتبر شروع خدمت را وارد کنید.',
  endInvalid: 'زمان محلی معتبر پایان را پس از شروع خدمت وارد کنید.',
  dateHelp:
    'زمان‌ها از منطقه زمانی حساب استفاده می‌کنند. زمان ویرایش‌نشده همان لحظه اصلی را نگه می‌دارد.',
  uncertain: 'این ذخیره تأیید نشد. پیش از ویرایش همان فرمان ثبت‌شده را دوباره ارسال کنید.',
  retryCaptured: 'ارسال دوباره ذخیره قرارداد ثبت‌شده',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
};
export function tContractAuthoring(key: string, locale: Locale = 'fa'): string {
  return (locale === 'fa' ? fa : en)[key] ?? key;
}
