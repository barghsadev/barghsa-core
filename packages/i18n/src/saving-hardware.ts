import type { Locale } from './app.js';

export const en: Record<string, string> = {
  hardwareInvalid: 'Choose a different available device.',
  hardwareHelp:
    'Choose a replacement device. Review any additional charge or credit before confirming.',
  reasonInvalid: 'Enter a reason of 1 to 1,000 characters.',
  hardwareReasonHelp: 'Explain the hardware change in at most 1,000 characters.',
  cancellationReasonHelp:
    'Explain why this unpaid upgrade should be cancelled in at most 1,000 characters.',
  hardwareReasonExample: 'Example: The replacement fits the installation site.',
  cancellationReasonExample: 'Example: The customer declined the price difference.',
  currentDevice: 'Current equipment',
  replacementDevice: 'Replacement equipment',
  pendingDevice: 'Equipment awaiting payment',
  changePrompt: 'Explain why the equipment needs to be replaced.',
  cancelPrompt: 'Explain why this pending upgrade should be cancelled.',
  cancellationReason: 'Reason for cancelling the upgrade',
  chargeOutcome: 'The replacement is reserved until the additional invoice is paid.',
  creditOutcome: 'The lower price is recorded as a credit note.',
  expectedCredit: 'Credit if confirmed',
  samePrice: 'Same price',
  checking: 'Checking the current order and financial review…',
  validationUnavailable: 'Validation is unavailable. Try again.',
  uncertain: 'This change could not be confirmed. Retry the captured command before editing.',
  retryCaptured: 'Retry captured hardware change',
  retryCancellation: 'Retry captured upgrade cancellation',
  missing: 'This order is unavailable.',
};

export const fa: Record<string, string> = {
  hardwareInvalid: 'یک دستگاه موجود دیگر انتخاب کنید.',
  hardwareHelp: 'دستگاه جایگزین را انتخاب کنید. پیش از تأیید، هزینه اضافی یا اعتبار را بررسی کنید.',
  reasonInvalid: 'دلیل باید بین ۱ تا ۱٬۰۰۰ نویسه باشد.',
  hardwareReasonHelp: 'دلیل تغییر دستگاه را در حداکثر ۱٬۰۰۰ نویسه بنویسید.',
  cancellationReasonHelp: 'دلیل لغو این ارتقای پرداخت‌نشده را در حداکثر ۱٬۰۰۰ نویسه بنویسید.',
  hardwareReasonExample: 'مثال: دستگاه جایگزین برای محل نصب مناسب است.',
  cancellationReasonExample: 'مثال: مشتری مابه‌التفاوت را نپذیرفت.',
  currentDevice: 'تجهیزات فعلی',
  replacementDevice: 'تجهیزات جایگزین',
  pendingDevice: 'تجهیزات در انتظار پرداخت',
  changePrompt: 'توضیح دهید چرا تجهیزات باید تعویض شوند.',
  cancelPrompt: 'توضیح دهید چرا این ارتقای پرداخت‌نشده باید لغو شود.',
  cancellationReason: 'دلیل لغو ارتقا',
  chargeOutcome: 'تجهیز جایگزین تا پرداخت فاکتور مابه‌التفاوت رزرو می‌ماند.',
  creditOutcome: 'کاهش قیمت به‌صورت سند بستانکاری ثبت می‌شود.',
  expectedCredit: 'اعتبار در صورت تأیید',
  samePrice: 'بدون تغییر قیمت',
  checking: 'در حال بررسی سفارش و اطلاعات مالی…',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
  uncertain: 'این تغییر تأیید نشد. پیش از ویرایش، همان فرمان ثبت‌شده را دوباره ارسال کنید.',
  retryCaptured: 'ارسال دوباره تغییر دستگاه ثبت‌شده',
  retryCancellation: 'ارسال دوباره لغو ارتقای ثبت‌شده',
  missing: 'این سفارش در دسترس نیست.',
};

export function tSavingHardware(key: string, locale: Locale = 'fa'): string {
  return (locale === 'fa' ? fa : en)[key] ?? key;
}
