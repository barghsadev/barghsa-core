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
};
export function lifecycleFormText(key: keyof typeof en, locale: Locale): string {
  return (locale === 'fa' ? fa : en)[key];
}
export const lifecycleFormDictionaries = { en, fa };
