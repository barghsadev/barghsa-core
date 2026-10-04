import type { Locale } from './app.js';
export const en: Record<string, string> = {
  feeInvalid: 'Enter a positive whole IRR amount up to 9,223,372,036,854,775,807.',
  paidFeeInvalid:
    'Enter a positive whole IRR amount up to 9,223,372,036,854,775,807 that differs from the current fee.',
  scopeInvalid: 'Enter the scope in 1 to 4,000 characters.',
  deliverablesInvalid: 'Enter the deliverables in 1 to 4,000 characters.',
  deadlineInvalid: 'Enter a future deadline in your account timezone.',
  replacementReasonInvalid: 'Enter a replacement reason in 1 to 2,000 characters.',
  paidReasonInvalid: 'Enter an adjustment reason in 1 to 1,000 characters.',
  feeHelp: 'Use whole IRR. The customer reviews this offer before payment.',
  termsHelp: 'Describe the work in at most 4,000 characters.',
  deadlineHelp: 'The deadline uses your saved account timezone.',
  reasonHelp: 'Explain the change. This is separate from the staff decision reason.',
  checking: 'Checking the current request and financial review…',
  validationUnavailable: 'Validation is unavailable. Try again.',
  uncertain: 'This fee action could not be confirmed. Retry the captured command before editing.',
  retryCaptured: 'Retry captured fee action',
};
export const fa: Record<string, string> = {
  feeInvalid: 'مبلغ صحیح و مثبت ریال تا ۹٬۲۲۳٬۳۷۲٬۰۳۶٬۸۵۴٬۷۷۵٬۸۰۷ را وارد کنید.',
  paidFeeInvalid:
    'مبلغ صحیح و مثبت ریال تا ۹٬۲۲۳٬۳۷۲٬۰۳۶٬۸۵۴٬۷۷۵٬۸۰۷ و متفاوت با هزینه فعلی را وارد کنید.',
  scopeInvalid: 'شرح خدمات باید بین ۱ تا ۴٬۰۰۰ نویسه باشد.',
  deliverablesInvalid: 'خروجی‌ها باید بین ۱ تا ۴٬۰۰۰ نویسه باشند.',
  deadlineInvalid: 'مهلت آینده را در منطقه زمانی حساب خود وارد کنید.',
  replacementReasonInvalid: 'دلیل جایگزینی باید بین ۱ تا ۲٬۰۰۰ نویسه باشد.',
  paidReasonInvalid: 'دلیل تغییر هزینه باید بین ۱ تا ۱٬۰۰۰ نویسه باشد.',
  feeHelp: 'مبلغ را به ریال صحیح وارد کنید. مشتری پیش از پرداخت، این پیشنهاد را بررسی می‌کند.',
  termsHelp: 'کار را در حداکثر ۴٬۰۰۰ نویسه شرح دهید.',
  deadlineHelp: 'مهلت بر اساس منطقه زمانی ذخیره‌شده حساب شما است.',
  reasonHelp: 'دلیل تغییر را توضیح دهید. این پیش‌نویس از دلیل تصمیم کارکنان جدا است.',
  checking: 'در حال بررسی درخواست و اطلاعات مالی…',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
  uncertain: 'این اقدام مالی تأیید نشد. پیش از ویرایش، همان فرمان ثبت‌شده را دوباره ارسال کنید.',
  retryCaptured: 'ارسال دوباره اقدام مالی ثبت‌شده',
};
export function tConsultationFee(key: string, locale: Locale = 'fa'): string {
  return (locale === 'fa' ? fa : en)[key] ?? key;
}
