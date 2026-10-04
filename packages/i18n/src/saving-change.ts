import type { Locale } from './app.js';

export const en: Record<string, string> = {
  customerHardwareInvalid: 'Choose an available device for this plan.',
  customerAddressInvalid: 'Choose an installation address from this profile.',
  customerUnchanged: 'Choose a different device or installation address.',
  customerHardwareHelp: 'Choose a device currently available for this plan.',
  customerAddressHelp: 'The installation address must belong to this profile.',
  customerChecking: 'Checking selections…',
  customerUncertain: 'The change could not be confirmed. Retry the captured change before editing.',
  customerRetryCaptured: 'Retry captured change',
  customerForbidden: 'You cannot change this order.',
  customerMissing: 'This order is unavailable.',
  validationUnavailable: 'Validation is unavailable. Try again.',
  customerReload: 'Reload available choices',
  staffAddressInvalid: 'Choose a different address from this profile.',
  staffReasonInvalid: 'Enter a reason of 1 to 1,000 characters.',
  staffAddressHelp: 'Choose the replacement installation address from this profile.',
  staffReasonHelp: 'Explain the address change in at most 1,000 characters.',
  staffChecking: 'Checking address change…',
  staffUncertain:
    'The address change could not be confirmed. Retry the captured amendment before editing.',
  staffRetryCaptured: 'Retry captured address amendment',
  staffForbidden: 'You cannot change this order address.',
  staffMissing: 'This order address is unavailable.',
};

export const fa: Record<string, string> = {
  customerHardwareInvalid: 'یک دستگاه موجود برای این طرح انتخاب کنید.',
  customerAddressInvalid: 'یک نشانی نصب از این پروفایل انتخاب کنید.',
  customerUnchanged: 'دستگاه یا نشانی نصب دیگری انتخاب کنید.',
  customerHardwareHelp: 'دستگاهی را انتخاب کنید که اکنون برای این طرح موجود است.',
  customerAddressHelp: 'نشانی نصب باید متعلق به این پروفایل باشد.',
  customerChecking: 'در حال بررسی انتخاب‌ها…',
  customerUncertain: 'تغییر تأیید نشد. پیش از ویرایش، همان تغییر ثبت‌شده را دوباره ارسال کنید.',
  customerRetryCaptured: 'ارسال دوباره تغییر ثبت‌شده',
  customerForbidden: 'دسترسی به تغییر این سفارش ندارید.',
  customerMissing: 'این سفارش در دسترس نیست.',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
  customerReload: 'بارگذاری دوباره گزینه‌های موجود',
  staffAddressInvalid: 'نشانی دیگری از این پروفایل انتخاب کنید.',
  staffReasonInvalid: 'دلیل باید بین ۱ تا ۱٬۰۰۰ نویسه باشد.',
  staffAddressHelp: 'نشانی نصب جایگزین را از این پروفایل انتخاب کنید.',
  staffReasonHelp: 'دلیل تغییر نشانی را در حداکثر ۱٬۰۰۰ نویسه بنویسید.',
  staffChecking: 'در حال بررسی تغییر نشانی…',
  staffUncertain: 'تغییر نشانی تأیید نشد. پیش از ویرایش، همان اصلاح ثبت‌شده را دوباره ارسال کنید.',
  staffRetryCaptured: 'ارسال دوباره اصلاح نشانی ثبت‌شده',
  staffForbidden: 'دسترسی به تغییر نشانی این سفارش ندارید.',
  staffMissing: 'نشانی این سفارش در دسترس نیست.',
};

export function tSavingChange(key: string, locale: Locale = 'fa'): string {
  return (locale === 'fa' ? fa : en)[key] ?? key;
}
