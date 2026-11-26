import type { Locale } from './auth.js';
const en = {
  roleChangedTitle: 'Your team roles changed',
  roleChangedBody: 'Your roles at "{name}" changed to: {roles}.',
  roleRemoved: 'No team roles; access removed',
  roleManager: 'Manager',
  roleFinance: 'Finance',
  roleLegal: 'Legal',
  confirmationRequired: 'Confirm that you reviewed the consequences and retained records',
  passwordRequired: 'Enter your current password',
  passwordRejected: 'The current password was not accepted',
  validationUnavailable: 'Validation is unavailable. Please try again.',
  uncertain:
    'The result is not confirmed. Other changes are paused. Retry the original request to confirm its result.',
  retry: 'Retry the original request',
  changed: 'The closure review has changed. Refresh the review and confirm it again.',
  refresh: 'Refresh requests',
  clearChecks: 'Checks with no outstanding items ({count})',
  noRequests: 'Your export and closure requests will appear here.',
  activeProfile: 'Active profile',
  submittedNow: 'Just now',
  exportNext:
    'Prepare a copy of this profile’s data. Track progress and download it in Recent requests.',
  closureNext:
    'Support reviews the request first. Approval ends access to this profile. Financial and legal records are retained.',
  downloadBeforeClosure: 'Request and download any data export before closure is approved.',
  closureSubmitted: 'Follow progress and reply to support in the existing request.',
  openClosureRequest: 'View closure request',
  consequencesTitle: 'What closure changes',
  closureReady: 'Send your request to support for final review.',
  openClosureReview: 'Review profile closure',
  backToTicket: 'Back to support ticket',
  closureUnavailable: 'Profile closure review is unavailable for this ticket.',
  confirmationTitle: 'Confirm profile closure',
  confirmationHelp: 'Use your current password to authorize this change.',
  readyForConfirmation: 'Ready for confirmation',
  reviewChecks: 'Closure checks',
  blockedClosure: 'Resolve the outstanding items before closing this profile.',
  completedReview: 'Profile closed',
};
const fa: Record<keyof typeof en, string> = {
  roleChangedTitle: 'نقش‌های شما در تیم تغییر کرد',
  roleChangedBody: 'نقش‌های شما در «{name}» به این موارد تغییر کرد: {roles}.',
  roleRemoved: 'بدون نقش در تیم؛ دسترسی حذف شد',
  roleManager: 'مدیر',
  roleFinance: 'مالی',
  roleLegal: 'حقوقی',
  confirmationRequired: 'بررسی پیامدها و سوابق نگهداری‌شده را تأیید کنید',
  passwordRequired: 'رمز عبور فعلی خود را وارد کنید',
  passwordRejected: 'رمز عبور فعلی پذیرفته نشد',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
  uncertain:
    'نتیجه تأیید نشده است. تغییرات دیگر متوقف شده‌اند. برای تأیید نتیجه، همان درخواست اولیه را دوباره بفرستید.',
  retry: 'تلاش دوباره با همان درخواست',
  changed: 'اطلاعات بررسی بستن پروفایل تغییر کرده است. بررسی را تازه و دوباره تأیید کنید.',
  refresh: 'تازه‌سازی درخواست‌ها',
  clearChecks: 'بررسی‌های بدون مانع ({count})',
  noRequests: 'درخواست‌های دریافت داده و بستن پروفایل اینجا نمایش داده می‌شوند.',
  activeProfile: 'پروفایل فعال',
  submittedNow: 'همین حالا',
  exportNext:
    'نسخه‌ای از داده‌های این پروفایل آماده کنید. وضعیت آماده‌سازی و دریافت فایل را در درخواست‌های اخیر ببینید.',
  closureNext:
    'پشتیبانی ابتدا درخواست را بررسی می‌کند. پس از تأیید، دسترسی به این پروفایل پایان می‌یابد. سوابق مالی و حقوقی حفظ می‌شوند.',
  downloadBeforeClosure:
    'اگر به داده‌ها نیاز دارید، پیش از تأیید بستن پروفایل درخواست دهید و فایل را دریافت کنید.',
  closureSubmitted: 'وضعیت را از درخواست ثبت‌شده پیگیری کنید و همان‌جا به پشتیبانی پاسخ دهید.',
  openClosureRequest: 'مشاهده درخواست بستن پروفایل',
  consequencesTitle: 'پیامدهای بستن پروفایل',
  closureReady: 'درخواست را برای بررسی نهایی به پشتیبانی بفرستید.',
  openClosureReview: 'بررسی بستن پروفایل',
  backToTicket: 'بازگشت به تیکت پشتیبانی',
  closureUnavailable: 'بررسی بستن پروفایل برای این تیکت در دسترس نیست.',
  confirmationTitle: 'تأیید بستن پروفایل',
  confirmationHelp: 'برای تأیید این تغییر، رمز عبور فعلی خود را وارد کنید.',
  readyForConfirmation: 'آماده تأیید نهایی',
  reviewChecks: 'بررسی‌های بستن پروفایل',
  blockedClosure: 'پیش از بستن پروفایل، موارد باز را برطرف کنید.',
  completedReview: 'پروفایل بسته شد',
};
export function lifecycleFormText(key: keyof typeof en, locale: Locale): string {
  return (locale === 'fa' ? fa : en)[key];
}
export const lifecycleFormDictionaries = { en, fa };
