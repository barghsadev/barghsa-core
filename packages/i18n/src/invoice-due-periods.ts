const en = {
  title: 'Default invoice due periods',
  description:
    'Set the payment period for new invoices. Existing invoice deadlines stay unchanged.',
  service: 'Service type',
  days: 'Days after issue',
  load: 'Reload settings',
  loading: 'Loading settings…',
  save: 'Save due period',
  saving: 'Saving…',
  saved: 'Default due period saved.',
  invalid: 'Enter a whole number of days from 1 to 365.',
  error: 'The setting could not be confirmed. Reload settings before trying again.',
  conflict: 'Another administrator changed this setting. Reload settings before saving.',
  denied: 'Sign in with finance configuration permission to change these settings.',
  verifyTitle: 'Confirm default due period',
  verifyDescription: 'Confirm your password to save this payment period for new invoices.',
};
const fa: Record<keyof typeof en, string> = {
  title: 'مهلت پیش‌فرض پرداخت فاکتور',
  description: 'مهلت پرداخت فاکتورهای جدید را تعیین کنید. سررسید فاکتورهای قبلی تغییر نمی‌کند.',
  service: 'نوع خدمت',
  days: 'تعداد روز پس از صدور',
  load: 'دریافت مجدد تنظیمات',
  loading: 'در حال دریافت تنظیمات…',
  save: 'ذخیره مهلت پرداخت',
  saving: 'در حال ذخیره…',
  saved: 'مهلت پیش‌فرض پرداخت ذخیره شد.',
  invalid: 'تعداد روز را به صورت عدد صحیح بین ۱ تا ۳۶۵ وارد کنید.',
  error: 'نتیجه تغییر تنظیمات تأیید نشد. پیش از تلاش مجدد، تنظیمات را دوباره دریافت کنید.',
  conflict: 'مدیر دیگری این تنظیم را تغییر داده است. پیش از ذخیره، تنظیمات را دوباره دریافت کنید.',
  denied: 'برای تغییر این تنظیمات با حساب دارای دسترسی تنظیمات مالی وارد شوید.',
  verifyTitle: 'تأیید مهلت پیش‌فرض پرداخت',
  verifyDescription: 'برای ذخیره این مهلت پرداخت برای فاکتورهای جدید، رمز عبور خود را تأیید کنید.',
};
export function tDuePeriods(key: keyof typeof en, locale: 'fa' | 'en'): string {
  return (locale === 'fa' ? fa : en)[key];
}
