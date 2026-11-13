import { lookup } from './lookup.js';
import type { Locale } from './index.js';

const fa: Record<string, string> = {
  'admin.retention.title': 'نگهداری داده‌های پایش',
  'admin.retention.description': 'مدت نگهداری گزارش‌ها، سنجه‌ها و ردگیری‌های پایش را تنظیم کنید.',
  'admin.retention.savedPolicy': 'سیاست ذخیره‌شده',
  'admin.retention.export': 'دانلود سیاست ذخیره‌شده',
  'admin.retention.applyHelp':
    'مسئول زیرساخت باید نسخهٔ ذخیره‌شده را روی سرویس‌های پایش اعمال و بررسی کند.',
  'admin.retention.legal': 'سوابق حسابرسی، امنیتی و مالی تابع سیاست نگهداری قانونی جداگانه‌اند.',
  'admin.retention.searchableLogsDays': 'گزارش‌های قابل جست‌وجو (روز)',
  'admin.retention.metricsArchiveDays': 'بایگانی سنجه‌های نمونه‌برداری‌شده (روز)',
  'admin.retention.ordinaryTracesDays': 'ردگیری‌های عادی (روز)',
  'admin.retention.priorityTracesDays': 'ردگیری‌های کند یا دارای خطا (روز)',
  'admin.retention.bounds': 'عدد صحیحی بین {min} و {max} وارد کنید.',
  'admin.retention.range':
    'مدت نگهداری ردگیری‌های کند یا دارای خطا باید حداقل برابر با ردگیری‌های عادی باشد.',
  'admin.retention.refresh': 'تازه‌سازی',
  'admin.retention.retry': 'تلاش دوباره',
  'admin.retention.loading': 'در حال دریافت سیاست نگهداری…',
  'admin.retention.readError': 'دریافت سیاست نگهداری انجام نشد.',
  'admin.retention.forbidden': 'اجازهٔ تغییر سیاست نگهداری را ندارید.',
  'admin.retention.readOnly': 'دسترسی شما به این تنظیمات فقط برای مشاهده است.',
  'admin.retention.save': 'ذخیرهٔ سیاست',
  'admin.retention.confirm': 'این مدت‌ها برای اعمال توسط مسئول زیرساخت ذخیره می‌شوند.',
  'admin.retention.working': 'در حال بررسی…',
  'admin.retention.saved': 'سیاست نگهداری ذخیره شد.',
  'admin.retention.stale': 'نسخهٔ ذخیره‌شده تغییر کرده است. پیش از ذخیره دوباره آن را بررسی کنید.',
  'admin.retention.unverified': 'ذخیره تأیید نشد. پیش از تلاش دوباره تنظیمات را تازه‌سازی کنید.',
  'admin.retention.validationUnavailable': 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
};

const en: Record<string, string> = {
  'admin.retention.title': 'Monitoring retention',
  'admin.retention.description': 'Set retention periods for operational logs, metrics, and traces.',
  'admin.retention.savedPolicy': 'Saved policy',
  'admin.retention.export': 'Download saved policy',
  'admin.retention.applyHelp':
    'An infrastructure operator applies and verifies the saved version on the monitoring services.',
  'admin.retention.legal':
    'Audit, security, and financial records follow their separate legal retention policy.',
  'admin.retention.searchableLogsDays': 'Searchable logs (days)',
  'admin.retention.metricsArchiveDays': 'Downsampled metrics archive (days)',
  'admin.retention.ordinaryTracesDays': 'Ordinary traces (days)',
  'admin.retention.priorityTracesDays': 'Error and slow traces (days)',
  'admin.retention.bounds': 'Enter a whole number between {min} and {max}.',
  'admin.retention.range': 'Keep error and slow traces at least as long as ordinary traces.',
  'admin.retention.refresh': 'Refresh',
  'admin.retention.retry': 'Try again',
  'admin.retention.loading': 'Loading retention policy…',
  'admin.retention.readError': 'The retention policy could not be loaded.',
  'admin.retention.forbidden': 'You do not have permission to change retention.',
  'admin.retention.readOnly': 'You have read-only access to these settings.',
  'admin.retention.save': 'Save policy',
  'admin.retention.confirm': 'Save these periods for the infrastructure operator to apply.',
  'admin.retention.working': 'Checking…',
  'admin.retention.saved': 'Retention policy saved.',
  'admin.retention.stale': 'The saved version changed. Review it before saving again.',
  'admin.retention.unverified':
    'The save could not be verified. Refresh the settings before trying again.',
  'admin.retention.validationUnavailable': 'Validation is unavailable. Try again.',
};

export function retentionText(key: string, locale: Locale) {
  const message = `admin.retention.${key}`;
  return lookup(locale === 'fa' ? fa : en, message) ?? message;
}
