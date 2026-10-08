import { tWorkspace as adminWorkspaceText } from './workspace-admin.js';
import { lookup } from './lookup.js';
import { t as workspaceText } from './workspace.js';
import type { I18nDictionary, Locale } from './app.js';

export const fa: I18nDictionary = {
  'electricity.priceForm.contractInvalid': 'شناسه معتبر قرارداد را وارد کنید.',
  'electricity.priceForm.contractHelp':
    'شناسه قرارداد برق را برای مشاهده و بررسی تغییر قیمت وارد کنید.',
  'electricity.priceForm.percentageInvalid':
    'درصد غیرصفر با حداکثر دو رقم اعشار وارد کنید. کاهش باید کمتر از ۱۰۰ درصد باشد.',
  'electricity.priceForm.dateInvalid': 'تاریخ و زمان معتبر را انتخاب کنید.',
  'electricity.priceForm.dateHelp': 'تاریخ برای دوره آینده تحویل بررسی می‌شود.',
  'electricity.priceForm.reasonInvalid': 'دلیل باید بین ۱ تا ۱٬۰۰۰ نویسه باشد.',
  'electricity.priceForm.reasonHelp': 'این دلیل به مشتری نمایش داده می‌شود.',
  'electricity.priceForm.basisInvalid': 'مبنای قراردادی باید بین ۱ تا ۲٬۰۰۰ نویسه باشد.',
  'electricity.priceForm.basisHelp': 'بند یا مبنای قراردادی این تغییر را بنویسید.',
  'electricity.priceForm.validationUnavailable': 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
  'electricity.priceForm.uncertain':
    'نتیجه تأیید نشد. پیش از تغییر، همان اقدام قیمت ثبت‌شده را دوباره ارسال کنید.',
  'electricity.priceForm.retryCaptured': 'ارسال دوباره اقدام قیمت ثبت‌شده',
  'electricity.priceForm.preserved':
    'اگر فیلدی نیاز به اصلاح داشته باشد، سایر داده‌های شما حفظ می‌شود.',
};
export const en: I18nDictionary = {
  'electricity.priceForm.contractInvalid': 'Enter a valid contract ID.',
  'electricity.priceForm.contractHelp':
    'Enter an electricity contract ID to view and review price adjustments.',
  'electricity.priceForm.percentageInvalid':
    'Enter a nonzero percentage with at most two decimals. A decrease must be less than 100%.',
  'electricity.priceForm.dateInvalid': 'Choose a valid date and time.',
  'electricity.priceForm.dateHelp':
    'The effective date is checked against the future delivery period.',
  'electricity.priceForm.reasonInvalid': 'Enter a reason of 1 to 1,000 characters.',
  'electricity.priceForm.reasonHelp': 'This reason is disclosed to the customer.',
  'electricity.priceForm.basisInvalid': 'Enter a contractual basis of 1 to 2,000 characters.',
  'electricity.priceForm.basisHelp': 'State the contract clause or basis for this change.',
  'electricity.priceForm.validationUnavailable': 'Validation is unavailable. Try again.',
  'electricity.priceForm.uncertain':
    'The result could not be confirmed. Retry the captured price action before changing it.',
  'electricity.priceForm.retryCaptured': 'Retry captured price action',
  'electricity.priceForm.preserved': 'Your other entries are kept if a field needs correction.',
};
export function t(key: string, locale: Locale = 'fa'): string {
  return lookup(locale === 'fa' ? fa : en, key) ?? lookup(en, key) ?? workspaceText(key, locale);
}

export const adminFA: I18nDictionary = {
  'admin.electricityPrice.directory': 'تاریخچه تعدیل قیمت برق',
  'admin.electricityPrice.statusLabel': 'وضعیت',
  'admin.electricityPrice.history': 'زمان‌های ثبت',
  'admin.electricityPrice.proposedAt': 'انتشار',
  'admin.electricityPrice.finalizedAt': 'نهایی‌سازی',
  'admin.electricityPrice.cancelledAt': 'لغو',
  'admin.electricityPrice.terms': 'دلیل و مبنای قراردادی',
  'admin.electricityPrice.actions': 'عملیات',
  'admin.electricityPrice.viewCalculation': 'مشاهده محاسبه',
  'admin.electricityPrice.closeCalculation': 'بستن محاسبه',
  'admin.electricityPrice.calculationDescription':
    'محاسبه مالی ثبت‌شده، فاکتورهای مبنا و بازه‌های تحویل واجد شرایط را بررسی کنید.',
  'admin.electricityPrice.noInvoice': 'فاکتور تعدیل صادر نشده است.',
  'admin.electricityPrice.refundCredit': 'بازپرداخت بستانکاری از فاکتور پرداخت‌شده',
  'admin.electricityPrice.charge': 'افزایش هزینه',
  'admin.electricityPrice.credit': 'کاهش هزینه',
  'admin.electricityPrice.basisPrice': 'بهای مبنا',
  'admin.electricityPrice.source.original_invoice': 'صورتحساب اولیه',
  'admin.electricityPrice.source.quantity_increase': 'افزایش مقدار برق',
  'admin.electricityPrice.source.price_adjustment': 'تعدیل قیمت قبلی',
  'admin.electricityPrice.dateZone': 'زمان ورودی به تقویم میلادی در منطقه زمانی حساب',
  'admin.electricityPrice.description':
    'پیشنهاد قیمت آینده را برای مشتری منتشر کنید، سپس فاکتور افزایش یا بستانکاری را صادر کنید.',
  'admin.electricityPrice.contractId': 'شناسه قرارداد برق',
  'admin.electricityPrice.open': 'باز کردن قرارداد',
  'admin.electricityPrice.refresh': 'تازه‌سازی',
  'admin.electricityPrice.retry': 'تلاش دوباره',
  'admin.electricityPrice.listTitle': 'فهرست تعدیل قیمت برق',
  'admin.electricityPrice.empty': 'تعدیل قیمتی ثبت نشده است.',
  'admin.electricityPrice.loading': 'در حال دریافت قرارداد…',
  'admin.electricityPrice.load': 'دریافت قرارداد یا تغییرات قیمت ممکن نشد.',
  'admin.electricityPrice.save': 'ثبت پیشنهاد ممکن نشد. اطلاعات و تاریخ را بررسی کنید.',
  'admin.electricityPrice.reviewError': 'محاسبه و بررسی پیشنهاد ممکن نشد. اطلاعات را تازه کنید.',
  'admin.electricityPrice.reviewTitle': 'بررسی مالی تغییر قیمت برق',
  'admin.electricityPrice.reviewProposal': 'بررسی محاسبه پیشنهاد',
  'admin.electricityPrice.reviewLoading': 'در حال محاسبه قیمت و آماده‌سازی بررسی…',
  'admin.electricityPrice.publishConfirm':
    'مبالغ محاسبه‌شده را پیش از انتشار برای مشتری تأیید کنید.',
  'admin.electricityPrice.profileId': 'شناسه پروفایل',
  'admin.electricityPrice.originalInvoice': 'صورتحساب اولیه',
  'admin.electricityPrice.versionId': 'نسخه قرارداد',
  'admin.electricityPrice.termStarts': 'شروع دوره تحویل',
  'admin.electricityPrice.basisComponent': 'جزء مبنای قیمت',
  'admin.electricityPrice.forbidden': 'دسترسی لازم یا تأیید هویت دوباره وجود ندارد.',
  'admin.electricityPrice.termEnds': 'پایان دوره تحویل',
  'admin.electricityPrice.newProposal': 'پیشنهاد جدید',
  'admin.electricityPrice.percentage': 'درصد تغییر قیمت',
  'admin.electricityPrice.percentageHelp':
    'برای کاهش قیمت از عدد منفی استفاده کنید. دقت تا دو رقم اعشار است.',
  'admin.electricityPrice.effective': 'شروع اثرگذاری',
  'admin.electricityPrice.reason': 'دلیل',
  'admin.electricityPrice.basis': 'مبنای قراردادی',
  'admin.electricityPrice.publish': 'انتشار برای مشتری',
  'admin.electricityPrice.resolveProposal':
    'پیشنهاد باز را نهایی یا لغو کنید تا بتوانید پیشنهاد دیگری منتشر کنید.',
  'admin.electricityPrice.waitForIncrease': 'ابتدا درخواست افزایش مقدار برق را تعیین تکلیف کنید.',
  'admin.electricityPrice.notEligible':
    'این قرارداد در حال حاضر دوره آینده واجد شرایط برای تغییر قیمت ندارد.',
  'admin.electricityPrice.adjustment': 'تغییر قیمت',
  'admin.electricityPrice.status.proposed': 'منتشرشده',
  'admin.electricityPrice.status.finalized': 'نهایی‌شده',
  'admin.electricityPrice.status.cancelled': 'لغوشده',
  'admin.electricityPrice.oldFuture': 'بهای قبلی بخش آینده',
  'admin.electricityPrice.newFuture': 'بهای جدید بخش آینده',
  'admin.electricityPrice.amount': 'تغییر خالص',
  'admin.electricityPrice.invoice': 'فاکتور تعدیل',
  'admin.electricityPrice.finalize': 'نهایی‌سازی و صدور تعدیل',
  'admin.electricityPrice.finalizePermission': 'برای صدور تعدیل، مجوز قرارداد و فاکتور لازم است.',
  'admin.electricityPrice.finalizeConfirm':
    'جزئیات منتشرشده و مبلغ را بررسی کنید. این اقدام فاکتور افزایش یا بستانکاری صادر می‌کند.',
  'admin.electricityPrice.cancel': 'لغو پیشنهاد',
  'admin.electricityPrice.cancelConfirm': 'پیشنهاد برای مشتری لغو می‌شود و فاکتوری صادر نمی‌شود.',
  'admin.electricityPrice.conflict':
    'قرارداد یا مبنای قیمت تغییر کرده است. اطلاعات را تازه‌سازی کنید.',
};
export const adminEN: I18nDictionary = {
  'admin.electricityPrice.directory': 'Electricity price adjustment history',
  'admin.electricityPrice.statusLabel': 'Status',
  'admin.electricityPrice.history': 'Recorded dates',
  'admin.electricityPrice.proposedAt': 'Published',
  'admin.electricityPrice.finalizedAt': 'Finalized',
  'admin.electricityPrice.cancelledAt': 'Cancelled',
  'admin.electricityPrice.terms': 'Reason and contractual basis',
  'admin.electricityPrice.actions': 'Actions',
  'admin.electricityPrice.viewCalculation': 'View calculation',
  'admin.electricityPrice.closeCalculation': 'Close calculation',
  'admin.electricityPrice.calculationDescription':
    'Review the saved financial calculation, source invoices and eligible delivery periods.',
  'admin.electricityPrice.noInvoice': 'No adjustment invoice has been issued.',
  'admin.electricityPrice.refundCredit': 'Refund credit from the paid invoice',
  'admin.electricityPrice.charge': 'Cost increase',
  'admin.electricityPrice.credit': 'Cost decrease',
  'admin.electricityPrice.basisPrice': 'Price basis',
  'admin.electricityPrice.source.original_invoice': 'Initial invoice',
  'admin.electricityPrice.source.quantity_increase': 'Quantity increase',
  'admin.electricityPrice.source.price_adjustment': 'Earlier price adjustment',
  'admin.electricityPrice.dateZone': 'Gregorian input in the account timezone',
  'admin.electricityPrice.description':
    'Publish a future price proposal for the customer, then issue the charge or credit.',
  'admin.electricityPrice.contractId': 'Electricity contract ID',
  'admin.electricityPrice.open': 'Open contract',
  'admin.electricityPrice.refresh': 'Refresh',
  'admin.electricityPrice.retry': 'Try again',
  'admin.electricityPrice.listTitle': 'Electricity price adjustment list',
  'admin.electricityPrice.empty': 'No price adjustments have been recorded.',
  'admin.electricityPrice.loading': 'Loading contract…',
  'admin.electricityPrice.load': 'Could not load this contract or its price history.',
  'admin.electricityPrice.save': 'Could not publish the proposal. Check the details and date.',
  'admin.electricityPrice.reviewError':
    'Could not price or review this proposal. Refresh and retry.',
  'admin.electricityPrice.reviewTitle': 'Electricity price financial review',
  'admin.electricityPrice.reviewProposal': 'Review calculated proposal',
  'admin.electricityPrice.reviewLoading': 'Calculating the price for review…',
  'admin.electricityPrice.publishConfirm':
    'Confirm the calculated amounts before publishing them to the customer.',
  'admin.electricityPrice.profileId': 'Profile reference',
  'admin.electricityPrice.originalInvoice': 'Initial invoice',
  'admin.electricityPrice.versionId': 'Contract version',
  'admin.electricityPrice.termStarts': 'Delivery period starts',
  'admin.electricityPrice.basisComponent': 'Price basis component',
  'admin.electricityPrice.forbidden':
    'Required permission or recent identity verification is missing.',
  'admin.electricityPrice.termEnds': 'Delivery period ends',
  'admin.electricityPrice.newProposal': 'New proposal',
  'admin.electricityPrice.percentage': 'Price change percentage',
  'admin.electricityPrice.percentageHelp':
    'Use a negative number for a decrease. Up to two decimal places.',
  'admin.electricityPrice.effective': 'Effective from',
  'admin.electricityPrice.reason': 'Reason',
  'admin.electricityPrice.basis': 'Contractual basis',
  'admin.electricityPrice.publish': 'Publish for customer',
  'admin.electricityPrice.resolveProposal':
    'Finalize or cancel the open proposal before publishing another.',
  'admin.electricityPrice.waitForIncrease': 'Resolve the open electricity quantity increase first.',
  'admin.electricityPrice.notEligible':
    'This contract has no eligible future delivery period for a price change.',
  'admin.electricityPrice.adjustment': 'Price change',
  'admin.electricityPrice.status.proposed': 'Published',
  'admin.electricityPrice.status.finalized': 'Finalized',
  'admin.electricityPrice.status.cancelled': 'Cancelled',
  'admin.electricityPrice.oldFuture': 'Previous future-period price',
  'admin.electricityPrice.newFuture': 'New future-period price',
  'admin.electricityPrice.amount': 'Net change',
  'admin.electricityPrice.invoice': 'Adjustment invoice',
  'admin.electricityPrice.finalize': 'Finalize and issue adjustment',
  'admin.electricityPrice.finalizePermission':
    'Finalization requires contract and invoice permissions.',
  'admin.electricityPrice.finalizeConfirm':
    'Check the disclosed terms and amount. This issues a charge invoice or credit note.',
  'admin.electricityPrice.cancel': 'Cancel proposal',
  'admin.electricityPrice.cancelConfirm':
    'The customer will see the cancelled proposal. No invoice will be issued.',
  'admin.electricityPrice.conflict':
    'The contract or price basis changed. Refresh and review it again.',
};
export function adminText(key: string, locale: Locale = 'fa'): string {
  return (
    lookup(locale === 'fa' ? adminFA : adminEN, key) ??
    lookup(adminEN, key) ??
    adminWorkspaceText(key, locale)
  );
}
