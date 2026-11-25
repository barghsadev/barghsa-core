import { lookup } from './lookup.js';
import type { I18nDictionary, Locale } from './app.js';

export const fa: I18nDictionary = {
  'electricity.increaseForm.quantityInvalid': 'عدد صحیح مثبت با حداکثر ۱۹ رقم وارد کنید.',
  'electricity.increaseForm.backToOrder': 'بازگشت به سفارش برق',
  'electricity.increaseForm.openRequest': 'درخواست افزایش مقدار برق',
  'electricity.increaseForm.requestUnavailable':
    'در حال حاضر نمی‌توانید درخواست افزایش جدیدی برای این سفارش ثبت کنید.',
  'electricity.increaseForm.quantityRange':
    'مقداری بیشتر از مقدار فعلی و در محدوده مجاز نمایش‌داده‌شده انتخاب کنید.',
  'electricity.increaseForm.validationUnavailable': 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
  'electricity.increaseForm.uncertain':
    'نتیجه تأیید نشد. پیش از تغییر، درخواست ثبت‌شده را دوباره ارسال کنید.',
  'electricity.increaseForm.retryCaptured': 'ارسال دوباره درخواست ثبت‌شده',
  'electricity.increaseForm.documentFingerprint': 'شناسه اعتبارسنجی فایل الحاقیه',
  'electricity.increaseForm.preserved':
    'اگر درخواست نیاز به اصلاح داشته باشد، مقدار واردشده حفظ می‌شود.',
  'electricity.increaseForm.signingUncertain':
    'امضا تأیید نشد. پیش از تازه‌سازی، همان امضا را دوباره ارسال کنید.',
  'electricity.increase.title': 'درخواست افزایش مقدار برق',
  'electricity.increase.loading': 'در حال دریافت وضعیت درخواست…',
  'electricity.increase.retry': 'تلاش دوباره',
  'electricity.increase.requested': 'مقدار درخواستی',
  'electricity.increase.reason': 'دلیل تصمیم',
  'electricity.increase.amendment': 'الحاقیه افزایش مقدار',
  'electricity.increase.increment': 'مقدار افزوده',
  'electricity.increase.earliest': 'زودترین شروع',
  'electricity.increase.end': 'پایان دوره',
  'electricity.increase.priceRule':
    'مبلغ تعدیل پس از امضا بر پایه فاکتور اولیه پرداخت‌شده و تغییرات قیمت نهایی‌شده، متناسب با مقدار افزوده و بخش باقی‌مانده هر دوره محاسبه می‌شود.',
  'electricity.increase.activationRule':
    'افزایش مقدار فقط پس از امضای شما و پرداخت کامل فاکتور تعدیل و زودتر نبودن از تاریخ شروع اعمال می‌شود.',
  'electricity.increase.adjustment': 'مبلغ فاکتور تعدیل در زمان امضا',
  'electricity.increase.reviewTitle': 'بررسی مالی پیش از امضای الحاقیه',
  'electricity.increase.contractId': 'شناسه قرارداد',
  'electricity.increase.originalInvoice': 'فاکتور اولیه پرداخت‌شده',
  'electricity.increase.paidBasis': 'مبلغ مبنای پرداخت‌شده',
  'electricity.increase.period': 'دوره تحویل',
  'electricity.increase.baseShare': 'سهم قیمت اولیه',
  'electricity.increase.priceChange': 'سهم تغییر قیمت',
  'electricity.increase.reviewUnavailable':
    'بررسی مالی معتبر در دسترس نیست. صفحه را دوباره بارگذاری کنید.',
  'electricity.increase.priceBegins': 'شروع دوره قیمت‌گذاری و اعمال افزایش',
  'electricity.increase.agree': 'الحاقیه، مبلغ تعدیل و شرایط اعمال افزایش را بررسی و قبول می‌کنم.',
  'electricity.increase.sign': 'امضای الحاقیه و صدور فاکتور',
  'electricity.increase.payInvoice': 'مشاهده یا پرداخت فاکتور تعدیل',
  'electricity.increase.cancelledInvoice': 'مشاهده فاکتور تعدیل لغوشده',
  'electricity.increase.noPaymentDue':
    'این فاکتور لغو شد و پرداختی برای افزایش منقضی‌شده لازم نیست.',
  'electricity.increase.financeFollowUp':
    'رسید یا مبلغ پرداخت‌شده این درخواست منقضی‌شده نیازمند بررسی مالی است.',
  'electricity.increase.signFailed':
    'امضای الحاقیه انجام نشد. مبلغ و وضعیت قرارداد را دوباره بررسی کنید.',
  'electricity.increase.status.pending': 'در انتظار بررسی کارکنان',
  'electricity.increase.status.rejected': 'درخواست رد شد',
  'electricity.increase.status.approved': 'درخواست تأیید شد',
  'electricity.increase.status.awaiting_signature': 'در انتظار امضای الحاقیه',
  'electricity.increase.status.awaiting_payment': 'در انتظار پرداخت تعدیل',
  'electricity.increase.status.awaiting_effective_date':
    'پرداخت کامل شد؛ در انتظار تاریخ شروع الحاقیه',
  'electricity.increase.status.effective': 'افزایش اعمال شد',
  'electricity.increase.status.expired': 'درخواست منقضی شد',
  'electricity.increase.limit': 'حداکثر مقدار مجاز',
  'electricity.increase.currentTotal': 'مقدار فعلی',
  'electricity.increase.quantity': 'مقدار کل جدید (کیلووات‌ساعت)',
  'electricity.increase.future':
    'درخواست فقط برای بخش آینده دوره تحویل بررسی می‌شود. مبلغ گذشته تغییر نمی‌کند.',
  'electricity.increase.stepup': 'برای ثبت درخواست، تأیید امنیتی لازم است.',
  'electricity.increase.security': 'تنظیمات امنیتی',
  'electricity.increase.failed': 'ثبت درخواست انجام نشد. مقدار و وضعیت قرارداد را بررسی کنید.',
  'electricity.increase.submit': 'ثبت درخواست افزایش',
};
export const en: I18nDictionary = {
  'electricity.increaseForm.quantityInvalid': 'Enter a positive whole number of at most 19 digits.',
  'electricity.increaseForm.backToOrder': 'Back to electricity order',
  'electricity.increaseForm.openRequest': 'Request an electricity increase',
  'electricity.increaseForm.requestUnavailable':
    'A new increase request is currently unavailable for this order.',
  'electricity.increaseForm.quantityRange':
    'Choose a quantity above the current amount and within the displayed limit.',
  'electricity.increaseForm.validationUnavailable': 'Validation is unavailable. Try again.',
  'electricity.increaseForm.uncertain':
    'The result could not be confirmed. Retry the captured request before changing it.',
  'electricity.increaseForm.retryCaptured': 'Retry captured request',
  'electricity.increaseForm.documentFingerprint': 'Amendment file fingerprint',
  'electricity.increaseForm.preserved': 'Your quantity is kept if the request needs correction.',
  'electricity.increaseForm.signingUncertain':
    'The signature could not be confirmed. Retry the same signature before refreshing.',
  'electricity.increase.title': 'Request more electricity',
  'electricity.increase.loading': 'Loading request status…',
  'electricity.increase.retry': 'Try again',
  'electricity.increase.requested': 'Requested total',
  'electricity.increase.reason': 'Decision reason',
  'electricity.increase.amendment': 'Quantity increase amendment',
  'electricity.increase.increment': 'Additional quantity',
  'electricity.increase.earliest': 'Earliest start',
  'electricity.increase.end': 'Delivery period ends',
  'electricity.increase.priceRule':
    'The adjustment uses the paid original invoice and finalized price changes, prorated for the added quantity over each remaining eligible period at signature.',
  'electricity.increase.activationRule':
    'The increase takes effect only after your signature and full adjustment payment, no earlier than its start date.',
  'electricity.increase.adjustment': 'Adjustment invoice amount at signature',
  'electricity.increase.reviewTitle': 'Financial review before signing',
  'electricity.increase.contractId': 'Contract ID',
  'electricity.increase.originalInvoice': 'Paid original invoice',
  'electricity.increase.paidBasis': 'Paid price basis',
  'electricity.increase.period': 'Delivery period',
  'electricity.increase.baseShare': 'Original price share',
  'electricity.increase.priceChange': 'Price change share',
  'electricity.increase.reviewUnavailable':
    'The financial review is unavailable. Reload the page to review current values.',
  'electricity.increase.priceBegins': 'Pricing and activation start',
  'electricity.increase.agree':
    'I have reviewed and accept the amendment, adjustment amount, and activation terms.',
  'electricity.increase.sign': 'Sign amendment and issue invoice',
  'electricity.increase.payInvoice': 'View or pay adjustment invoice',
  'electricity.increase.cancelledInvoice': 'View cancelled adjustment invoice',
  'electricity.increase.noPaymentDue':
    'This invoice was cancelled; no payment is due for the expired increase.',
  'electricity.increase.financeFollowUp':
    'A receipt or confirmed payment on this expired request needs finance review.',
  'electricity.increase.signFailed':
    'Could not sign the amendment. Review the amount and contract status again.',
  'electricity.increase.status.pending': 'Awaiting staff review',
  'electricity.increase.status.rejected': 'Request declined',
  'electricity.increase.status.approved': 'Request approved',
  'electricity.increase.status.awaiting_signature': 'Awaiting amendment signature',
  'electricity.increase.status.awaiting_payment': 'Awaiting adjustment payment',
  'electricity.increase.status.awaiting_effective_date':
    'Payment complete; awaiting amendment start date',
  'electricity.increase.status.effective': 'Increase effective',
  'electricity.increase.status.expired': 'Request expired',
  'electricity.increase.limit': 'Maximum allowed total',
  'electricity.increase.currentTotal': 'Current total',
  'electricity.increase.quantity': 'New total quantity (kWh)',
  'electricity.increase.future':
    'The request applies only to future delivery. Past charges stay unchanged.',
  'electricity.increase.stepup': 'Security confirmation is required to submit this request.',
  'electricity.increase.security': 'Security settings',
  'electricity.increase.failed':
    'Could not submit the request. Check the amount and contract status.',
  'electricity.increase.submit': 'Submit increase request',
};

export function t(key: string, locale: Locale = 'fa'): string {
  return lookup(locale === 'fa' ? fa : en, key) ?? lookup(en, key) ?? key;
}
