import type { Locale } from './index.js';
// Service configuration copy stays with its route instead of shared customer downloads.
export const fa: Record<string, string> = {
  'admin.targets.refresh': 'تازه‌سازی زمان‌های هدف',
  'admin.targets.reset': 'بازگشت به زمان‌های فعلی',
  'admin.targets.stale':
    'زمان‌های ذخیره‌شده تغییر کرده‌اند. پیش‌نویس شما حفظ شده؛ پیش از ذخیره به زمان‌های فعلی بازگردید.',
  'admin.targets.title': 'زمان هدف پاسخ کارکنان',
  'admin.targets.note':
    'عبور از زمان هدف، هشدار داخلی برای کارکنان ایجاد می‌کند و به مشتری تعهد سطح خدمت نمی‌دهد. تغییر تنظیمات بر کارهای باز نیز اثر دارد.',
  'admin.targets.save': 'ذخیره زمان‌های هدف',
  'admin.targets.disabled': 'غیرفعال',
  'admin.targets.hours': 'ساعت',
  'admin.targets.enabled': 'فعال کردن هشدار',
  'admin.targets.range':
    'بین ۱ تا ۸۷۶۰ ساعت وارد کنید. هر روز برابر ۲۴ ساعت است. غیرفعال کردن، هشدارهای بعدی آن نوع کار را متوقف می‌کند.',
  'admin.targets.forbidden': 'اجازه مدیریت زمان‌های هدف را ندارید یا دسترسی شما تغییر کرده است.',
  'admin.teams.ticket': 'تیکت‌ها',
  'admin.teams.verification_case': 'پرونده‌های اصلاح هویت',
  'admin.teams.consultation': 'درخواست‌های مشاوره',
  'admin.consultation.responseHelp':
    'فقط درخواست‌های ثبت‌شده، در حال بررسی و با پیشنهاد پذیرفته‌شده منتظر پاسخ کارکنان هستند. انتظار برای اطلاعات مشتری، تصمیم درباره پیشنهاد، پرداخت و وضعیت‌های پایان‌یافته هشدار پاسخ ایجاد نمی‌کند.',
  'admin.targets.formTitle': 'ساعت هدف پاسخ',
  'admin.targets.pageTitle': 'زمان پاسخ و ارجاع هشدار',
  'admin.targets.confirm': 'این زمان‌های هدف ذخیره شوند؟',
  'admin.targets.invalid': 'عدد صحیحی بین ۱ تا ۸۷۶۰ ساعت وارد کنید.',
  'admin.targets.validationUnavailable': 'اعتبارسنجی بارگذاری نشد. پیش از ذخیره دوباره تلاش کنید.',
  'admin.targets.working': 'در حال بررسی…',
  'admin.targets.loading': 'در حال دریافت زمان‌های هدف…',
  'admin.targets.readError': 'زمان‌های هدف دریافت نشد. پیش‌نویس شما حفظ شده است.',
  'admin.targets.retry': 'دریافت دوباره زمان‌های هدف',
  'admin.targets.saved': 'تغییرات ذخیره شد.',
  'admin.targets.unverified':
    'پاسخ ذخیره تأیید نشد. پنجره را ببندید و پیش از ذخیره دوباره، تازه‌سازی کنید.',
  'admin.escalation.confirm': 'این زمان‌ها و کانال‌های ارجاع ذخیره شوند؟',
  'admin.escalation.invalid': 'عدد صحیحی بین ۱ تا ۸۷۶۰ ساعت وارد کنید.',
  'admin.escalation.validationUnavailable':
    'اعتبارسنجی بارگذاری نشد. پیش از ذخیره دوباره تلاش کنید.',
  'admin.escalation.working': 'در حال بررسی…',
  'admin.escalation.loading': 'در حال دریافت تنظیمات ارجاع…',
  'admin.escalation.readError': 'تنظیمات ارجاع دریافت نشد. پیش‌نویس شما حفظ شده است.',
  'admin.escalation.retry': 'دریافت دوباره تنظیمات ارجاع',
  'admin.escalation.saved': 'تغییرات ذخیره شد.',
  'admin.escalation.unverified':
    'پاسخ ذخیره تأیید نشد. پنجره را ببندید و پیش از ذخیره دوباره، تازه‌سازی کنید.',
  'admin.escalation.title': 'ارجاع هشدارهای پاسخ',
  'admin.escalation.formTitle': 'زمان و کانال ارجاع هشدار',
  'admin.escalation.note':
    'هشدار نخست به مسئول کار می‌رسد. سپس به سرپرست تیم (یا در نبود او به مدیران) و در مرحله بعد به مدیران ارجاع می‌شود. تغییرات بر کارهای باز اثر دارد و در سابقه تغییرات ثبت می‌شود.',
  'admin.escalation.refresh': 'تازه‌سازی تنظیمات ارجاع',
  'admin.escalation.reset': 'بازگشت به تنظیمات فعلی ارجاع',
  'admin.escalation.stale':
    'تنظیمات ذخیره‌شده ارجاع تغییر کرده است. پیش‌نویس شما حفظ شده؛ پیش از ذخیره به تنظیمات فعلی بازگردید.',
  'admin.escalation.save': 'ذخیره تنظیمات ارجاع',
  'admin.escalation.forbidden': 'اجازه مدیریت ارجاع هشدار را ندارید یا دسترسی شما تغییر کرده است.',
  'admin.escalation.level2': 'سرپرست تیم',
  'admin.escalation.level3': 'مدیران',
  'admin.escalation.hours': 'ساعت',
  'admin.escalation.enabled': 'فعال کردن ارجاع',
  'admin.escalation.disabled': 'غیرفعال',
  'admin.escalation.level2Help':
    'بین ۱ تا ۸۷۶۰ ساعت کامل پس از هشدار نخست. غیرفعال کردن، ارجاع بعدی به سرپرست تیم را متوقف می‌کند.',
  'admin.escalation.level3Help':
    'بین ۱ تا ۸۷۶۰ ساعت کامل پس از ارجاع به سرپرست. هشدارهای قبلی سرپرست حتی با غیرفعال بودن این مرحله می‌توانند به مدیران ارجاع شوند.',
  'admin.escalation.inApp': 'اعلان درون برنامه همیشه ارسال می‌شود.',
  'admin.escalation.email': 'ارسال ایمیل هم فعال باشد',
};
export const en: Record<string, string> = {
  'admin.targets.refresh': 'Refresh response targets',
  'admin.targets.reset': 'Reset to current targets',
  'admin.targets.stale':
    'Saved targets changed. Your draft is retained; reset to the current targets before saving.',
  'admin.targets.title': 'Staff response targets',
  'admin.targets.note':
    'Breached targets create internal staff alerts but do not promise a service level to customers. Changes also apply to existing open work.',
  'admin.targets.save': 'Save response targets',
  'admin.targets.disabled': 'Disabled',
  'admin.targets.hours': 'Hours',
  'admin.targets.enabled': 'Enable alerts',
  'admin.targets.range':
    'Enter 1 to 8,760 hours. One day is 24 hours. Disabling a work type stops its future target alerts.',
  'admin.targets.forbidden': 'You cannot manage response targets, or your access has changed.',
  'admin.teams.ticket': 'Tickets',
  'admin.teams.verification_case': 'Identity correction cases',
  'admin.teams.consultation': 'Consultation requests',
  'admin.consultation.responseHelp':
    'Only submitted, under review, and accepted-offer requests await staff responses. Waiting for customer information, an offer decision, payment, or a terminal outcome does not create response alerts.',
  'admin.targets.formTitle': 'Response target hours',
  'admin.targets.pageTitle': 'Response targets and escalation',
  'admin.targets.confirm': 'Save these response targets?',
  'admin.targets.invalid': 'Enter a whole number from 1 to 8,760 hours.',
  'admin.targets.validationUnavailable': 'Validation could not be loaded. Retry before saving.',
  'admin.targets.working': 'Checking…',
  'admin.targets.loading': 'Loading response targets…',
  'admin.targets.readError': 'Response targets could not be loaded. Your draft is kept.',
  'admin.targets.retry': 'Retry response targets',
  'admin.targets.saved': 'Changes saved.',
  'admin.targets.unverified':
    'The save acknowledgement could not be verified. Cancel and refresh before saving again.',
  'admin.escalation.confirm': 'Save these escalation delays and channels?',
  'admin.escalation.invalid': 'Enter a whole number from 1 to 8,760 hours.',
  'admin.escalation.validationUnavailable': 'Validation could not be loaded. Retry before saving.',
  'admin.escalation.working': 'Checking…',
  'admin.escalation.loading': 'Loading escalation policy…',
  'admin.escalation.readError': 'Escalation policy could not be loaded. Your draft is kept.',
  'admin.escalation.retry': 'Retry escalation policy',
  'admin.escalation.saved': 'Changes saved.',
  'admin.escalation.unverified':
    'The save acknowledgement could not be verified. Cancel and refresh before saving again.',
  'admin.escalation.title': 'Escalation alerts',
  'admin.escalation.formTitle': 'Escalation delays and channels',
  'admin.escalation.note':
    'Targets alert the assigned staff member first. Escalation then alerts the team lead (or administrators if unavailable), followed by administrators. Changes apply to open work and are recorded in the audit log.',
  'admin.escalation.refresh': 'Refresh escalation policy',
  'admin.escalation.reset': 'Reset to current escalation policy',
  'admin.escalation.stale':
    'Saved escalation settings changed. Your draft is retained; reset to the current policy before saving.',
  'admin.escalation.save': 'Save escalation policy',
  'admin.escalation.forbidden': 'You cannot manage escalation alerts, or your access has changed.',
  'admin.escalation.level2': 'Team lead',
  'admin.escalation.level3': 'Administrators',
  'admin.escalation.hours': 'Hours',
  'admin.escalation.enabled': 'Enable escalation',
  'admin.escalation.disabled': 'Disabled',
  'admin.escalation.level2Help':
    '1–8,760 whole hours after the first target alert. Disabling stops future escalation to the team lead.',
  'admin.escalation.level3Help':
    '1–8,760 whole hours after a team-lead escalation. Existing team-lead alerts can still escalate when the team-lead tier is disabled.',
  'admin.escalation.inApp': 'In-app notification is always included.',
  'admin.escalation.email': 'Also send email',
};
export function tServiceSettings(key: string, locale: Locale = 'fa'): string {
  return (locale === 'fa' ? fa : en)[key] ?? en[key] ?? key;
}
