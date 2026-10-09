import { lookup } from './lookup.js';
import type { I18nDictionary, Locale } from './app.js';
export const fa: I18nDictionary = {
  'electricity.increaseDecisionForm.dateInvalid':
    'زمان معتبر انتخاب کنید یا تاریخ را خالی بگذارید.',
  'electricity.increaseDecisionForm.reasonInvalid': 'دلیل باید بین ۱ تا ۱٬۰۰۰ نویسه باشد.',
  'electricity.increaseDecisionForm.reasonHelp':
    'تاریخ تأیید و دلیل رد مستقل هستند. تأیید از دلیل رد استفاده نمی‌کند.',
  'electricity.increaseDecisionForm.approvalReasonHelp':
    'دلیل تأیید را وارد کنید. این دلیل در تصمیم و اصلاحیه قرارداد ثبت می‌شود و با دلیل رد مستقل است.',
  'electricity.increaseDecisionForm.validationUnavailable':
    'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
  'electricity.increaseDecisionForm.uncertain':
    'نتیجه تأیید نشد. پیش از تغییر، همان تصمیم ثبت‌شده را دوباره ارسال کنید.',
  'electricity.increaseDecisionForm.retryCaptured': 'ارسال دوباره تصمیم ثبت‌شده',
};
export const en: I18nDictionary = {
  'electricity.increaseDecisionForm.dateInvalid':
    'Choose a valid date and time, or leave the date empty.',
  'electricity.increaseDecisionForm.reasonInvalid': 'Enter a reason of 1 to 1,000 characters.',
  'electricity.increaseDecisionForm.reasonHelp':
    'Approval date and rejection reason are independent. Approval does not use the rejection reason.',
  'electricity.increaseDecisionForm.approvalReasonHelp':
    'Enter the approval reason. It is saved with the decision and contract amendment, separately from the rejection reason.',
  'electricity.increaseDecisionForm.validationUnavailable': 'Validation is unavailable. Try again.',
  'electricity.increaseDecisionForm.uncertain':
    'The result could not be confirmed. Retry the captured decision before changing it.',
  'electricity.increaseDecisionForm.retryCaptured': 'Retry captured decision',
};
export function t(key: string, locale: Locale = 'fa'): string {
  return lookup(locale === 'fa' ? fa : en, key) ?? lookup(en, key) ?? key;
}
export const adminFA: I18nDictionary = {
  'admin.electricityIncreases.title': 'درخواست‌های افزایش برق',
  'admin.electricityIncreases.description': 'درخواست‌های افزایش مقدار قرارداد فعال را بررسی کنید.',
  'admin.electricityIncreases.refresh': 'تازه‌سازی',
  'admin.electricityIncreases.retry': 'تلاش دوباره',
  'admin.electricityIncreases.listTitle': 'فهرست درخواست‌های افزایش برق',
  'admin.electricityIncreases.pages': 'صفحه‌های درخواست افزایش',
  'admin.electricityIncreases.loading': 'در حال دریافت درخواست‌ها…',
  'admin.electricityIncreases.error': 'دریافت درخواست‌ها انجام نشد.',
  'admin.electricityIncreases.forbidden': 'اجازه مشاهده درخواست‌های افزایش را ندارید.',
  'admin.electricityIncreases.empty': 'درخواست افزایشی در انتظار بررسی نیست.',
  'admin.electricityIncreases.emptyExpired': 'درخواست افزایش منقضی‌شده‌ای وجود ندارد.',
  'admin.electricityIncreases.viewLabel': 'فیلتر درخواست‌های افزایش',
  'admin.electricityIncreases.pendingDirectory': 'فهرست درخواست‌های افزایش برق برای بررسی',
  'admin.electricityIncreases.expiredDirectory': 'فهرست افزایش‌های برق منقضی‌شده',
  'admin.electricityIncreases.created': 'زمان ثبت درخواست',
  'admin.electricityIncreases.actions': 'عملیات',
  'admin.electricityIncreases.reviewRequest': 'بررسی درخواست',
  'admin.electricityIncreases.finance': 'پیگیری مالی',
  'admin.electricityIncreases.dateZone': 'زمان ورودی به تقویم میلادی در منطقه زمانی حساب',
  'admin.electricityIncreases.pendingTab': 'در انتظار بررسی',
  'admin.electricityIncreases.expiredTab': 'منقضی‌شده',
  'admin.electricityIncreases.invoiceState': 'وضعیت فاکتور تعدیل',
  'admin.electricityIncreases.invoice.Draft': 'پیش‌نویس',
  'admin.electricityIncreases.invoice.Unpaid': 'پرداخت‌نشده',
  'admin.electricityIncreases.invoice.PaymentUnderReview': 'پرداخت در حال بررسی',
  'admin.electricityIncreases.invoice.PartiallyFunded': 'پرداخت ناقص',
  'admin.electricityIncreases.invoice.Paid': 'پرداخت‌شده',
  'admin.electricityIncreases.invoice.Overdue': 'سررسیدگذشته',
  'admin.electricityIncreases.invoice.Cancelled': 'لغوشده',
  'admin.electricityIncreases.invoice.PartiallyRefunded': 'بازپرداخت ناقص',
  'admin.electricityIncreases.invoice.Refunded': 'بازپرداخت‌شده',
  'admin.electricityIncreases.notIssued': 'صادر نشده',
  'admin.electricityIncreases.paidAmount': 'مبلغ پرداخت‌شده',
  'admin.electricityIncreases.financeFollowUp': 'نیازمند بررسی مالی و تعیین تکلیف پرداخت یا رسید',
  'admin.electricityIncreases.expiredClosed': 'منقضی‌شده؛ بدهی باز برای این افزایش وجود ندارد.',
  'admin.electricityIncreases.request': 'درخواست افزایش',
  'admin.electricityIncreases.contract': 'قرارداد',
  'admin.electricityIncreases.order': 'سفارش',
  'admin.electricityIncreases.quantity': 'مقدار قبلی و درخواستی',
  'admin.electricityIncreases.change': 'درصد افزایش',
  'admin.electricityIncreases.effective': 'شروع دوره واجد شرایط',
  'admin.electricityIncreases.end': 'پایان دوره',
  'admin.electricityIncreases.status': 'وضعیت قرارداد',
  'admin.electricityIncreases.state.Active': 'فعال',
  'admin.electricityIncreases.state.Completed': 'تکمیل‌شده',
  'admin.electricityIncreases.state.Cancelled': 'لغوشده',
  'admin.electricityIncreases.state.other': 'نیازمند بررسی',
  'admin.electricityIncreases.reason': 'دلیل رد',
  'admin.electricityIncreases.approvalReason': 'دلیل تأیید',
  'admin.electricityIncreases.approveDate': 'تاریخ شروع پیشنهادی (اختیاری)',
  'admin.electricityIncreases.approveDateHelp':
    'خالی بگذارید تا تاریخ دقیق در پیش‌نمایش تعیین شود. فقط تحویل آینده واجد شرایط است.',
  'admin.electricityIncreases.approve': 'تأیید و صدور الحاقیه',
  'admin.electricityIncreases.approveConfirm':
    'الحاقیه با شرایط ثبت‌شده صادر و برای مشتری نمایش داده شود؟',
  'admin.electricityIncreases.reject': 'رد درخواست',
  'admin.electricityIncreases.confirm': 'درخواست با این دلیل رد و به مشتری اطلاع داده شود؟',
  'admin.electricityIncreases.reviewLoading': 'در حال بررسی نتیجه تصمیم…',
  'admin.electricityIncreases.reviewError': 'بررسی نتیجه تصمیم انجام نشد. دوباره تلاش کنید.',
  'admin.electricityIncreases.reviewTitle': 'بررسی تصمیم افزایش برق',
  'admin.electricityIncreases.reviewConfirm': 'این نتیجه دقیق تأیید و ثبت شود؟',
  'admin.electricityIncreases.increment': 'مقدار افزوده',
  'admin.electricityIncreases.currentLimit': 'سقف افزایش فعلی',
  'admin.electricityIncreases.notApplicable': 'ندارد',
  'admin.electricityIncreases.originalInvoice': 'فاکتور اصلی',
  'admin.electricityIncreases.decisionOutcome': 'نتیجه این تصمیم',
  'admin.electricityIncreases.outcome.publish_amendment_for_customer_signature':
    'انتشار الحاقیه برای امضای مشتری؛ بدون فاکتور جدید در این مرحله',
  'admin.electricityIncreases.outcome.reject_without_adjustment':
    'رد درخواست؛ بدون فاکتور یا تغییر مقدار',
  'admin.electricityIncreases.signingChargeNotice':
    'مبلغ تعدیل در زمان امضای مشتری با قیمت‌های قطعی و دوره باقیمانده محاسبه می‌شود.',
  'admin.electricityIncreases.conflict': 'درخواست تغییر کرده است. صف را تازه‌سازی کنید.',
  'admin.electricityIncreases.more': 'درخواست‌های بیشتر',
};
export const adminEN: I18nDictionary = {
  'admin.electricityIncreases.title': 'Electricity increase requests',
  'admin.electricityIncreases.description':
    'Review requests to increase an active contract’s quantity.',
  'admin.electricityIncreases.refresh': 'Refresh',
  'admin.electricityIncreases.retry': 'Try again',
  'admin.electricityIncreases.listTitle': 'Electricity increase request list',
  'admin.electricityIncreases.pages': 'Increase request pages',
  'admin.electricityIncreases.loading': 'Loading requests…',
  'admin.electricityIncreases.error': 'Could not load requests.',
  'admin.electricityIncreases.forbidden': 'You cannot view increase requests.',
  'admin.electricityIncreases.empty': 'No increase requests await review.',
  'admin.electricityIncreases.emptyExpired': 'No expired increase requests.',
  'admin.electricityIncreases.viewLabel': 'Increase request filter',
  'admin.electricityIncreases.pendingDirectory': 'Electricity increase review directory',
  'admin.electricityIncreases.expiredDirectory': 'Expired electricity increase directory',
  'admin.electricityIncreases.created': 'Requested at',
  'admin.electricityIncreases.actions': 'Actions',
  'admin.electricityIncreases.reviewRequest': 'Review request',
  'admin.electricityIncreases.finance': 'Financial follow-up',
  'admin.electricityIncreases.dateZone': 'Gregorian input in the account timezone',
  'admin.electricityIncreases.pendingTab': 'Pending review',
  'admin.electricityIncreases.expiredTab': 'Expired',
  'admin.electricityIncreases.invoiceState': 'Adjustment invoice state',
  'admin.electricityIncreases.invoice.Draft': 'Draft',
  'admin.electricityIncreases.invoice.Unpaid': 'Unpaid',
  'admin.electricityIncreases.invoice.PaymentUnderReview': 'Payment under review',
  'admin.electricityIncreases.invoice.PartiallyFunded': 'Partially funded',
  'admin.electricityIncreases.invoice.Paid': 'Paid',
  'admin.electricityIncreases.invoice.Overdue': 'Overdue',
  'admin.electricityIncreases.invoice.Cancelled': 'Cancelled',
  'admin.electricityIncreases.invoice.PartiallyRefunded': 'Partially refunded',
  'admin.electricityIncreases.invoice.Refunded': 'Refunded',
  'admin.electricityIncreases.notIssued': 'Not issued',
  'admin.electricityIncreases.paidAmount': 'Confirmed payment',
  'admin.electricityIncreases.financeFollowUp': 'Finance must resolve this payment or receipt.',
  'admin.electricityIncreases.expiredClosed': 'Expired with no open adjustment balance.',
  'admin.electricityIncreases.request': 'Increase request',
  'admin.electricityIncreases.contract': 'Contract',
  'admin.electricityIncreases.order': 'Order',
  'admin.electricityIncreases.quantity': 'Original and requested quantity',
  'admin.electricityIncreases.change': 'Increase',
  'admin.electricityIncreases.effective': 'Eligible period starts',
  'admin.electricityIncreases.end': 'Period ends',
  'admin.electricityIncreases.status': 'Contract status',
  'admin.electricityIncreases.state.Active': 'Active',
  'admin.electricityIncreases.state.Completed': 'Completed',
  'admin.electricityIncreases.state.Cancelled': 'Cancelled',
  'admin.electricityIncreases.state.other': 'Needs review',
  'admin.electricityIncreases.reason': 'Reason for declining',
  'admin.electricityIncreases.approvalReason': 'Approval reason',
  'admin.electricityIncreases.approveDate': 'Proposed start date (optional)',
  'admin.electricityIncreases.approveDateHelp':
    'Leave blank to choose an exact date in the preview. Only future delivery is eligible.',
  'admin.electricityIncreases.approve': 'Approve and issue amendment',
  'admin.electricityIncreases.approveConfirm':
    'Issue the amendment with these terms and show it to the customer?',
  'admin.electricityIncreases.reject': 'Decline request',
  'admin.electricityIncreases.confirm':
    'Decline this request with the reason and notify the customer?',
  'admin.electricityIncreases.reviewLoading': 'Checking the decision outcome…',
  'admin.electricityIncreases.reviewError': 'The decision review could not be loaded. Try again.',
  'admin.electricityIncreases.reviewTitle': 'Electricity increase decision review',
  'admin.electricityIncreases.reviewConfirm': 'Confirm this exact outcome?',
  'admin.electricityIncreases.increment': 'Added quantity',
  'admin.electricityIncreases.currentLimit': 'Current increase limit',
  'admin.electricityIncreases.notApplicable': 'Not applicable',
  'admin.electricityIncreases.originalInvoice': 'Original invoice',
  'admin.electricityIncreases.decisionOutcome': 'This decision',
  'admin.electricityIncreases.outcome.publish_amendment_for_customer_signature':
    'Publish amendment for customer signature; no new invoice yet',
  'admin.electricityIncreases.outcome.reject_without_adjustment':
    'Decline request; no invoice or quantity change',
  'admin.electricityIncreases.signingChargeNotice':
    'The adjustment is calculated at customer signature from finalized prices and remaining delivery time.',
  'admin.electricityIncreases.conflict': 'The request changed. Refresh the queue.',
  'admin.electricityIncreases.more': 'More requests',
};
export function adminText(key: string, locale: Locale = 'fa'): string {
  return lookup(locale === 'fa' ? adminFA : adminEN, key) ?? lookup(adminEN, key) ?? key;
}
