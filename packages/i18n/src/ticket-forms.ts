import type { Locale } from './app.js';
export const en: Record<string, string> = {
  subjectInvalid: 'Enter a subject of 1–200 characters.',
  bodyInvalid: 'Describe your request in 1–10,000 characters.',
  replyInvalid: 'Enter up to 10,000 characters or attach a file.',
  reasonInvalid: 'Enter a status reason of 1–2,000 characters.',
  categoryInvalid: 'Select an available category.',
  statusInvalid: 'Select an available ticket status.',
  priorityInvalid: 'Select an available priority.',
  profileInvalid: 'Select an available profile or general support.',
  recordInvalid: 'Select an available record for this profile.',
  assigneeInvalid: 'Select an available staff member.',
  teamInvalid: 'Select an available team or direct assignment.',
  filesInvalid: 'Choose up to five supported files within the size limit.',
  uncertain: 'This save could not be confirmed. Retry the captured request before editing.',
  retryOriginal: 'Retry captured ticket request',
  validationUnavailable: 'Validation is unavailable. Please try again.',
};
export const fa: Record<string, string> = {
  subjectInvalid: 'موضوع را با ۱ تا ۲۰۰ نویسه وارد کنید.',
  bodyInvalid: 'درخواست را با ۱ تا ۱۰٬۰۰۰ نویسه شرح دهید.',
  replyInvalid: 'حداکثر ۱۰٬۰۰۰ نویسه وارد کنید یا فایلی پیوست کنید.',
  reasonInvalid: 'دلیل تغییر وضعیت را با ۱ تا ۲٬۰۰۰ نویسه وارد کنید.',
  categoryInvalid: 'یک دسته‌بندی در دسترس انتخاب کنید.',
  statusInvalid: 'یک وضعیت در دسترس برای تیکت انتخاب کنید.',
  priorityInvalid: 'یک اولویت در دسترس انتخاب کنید.',
  profileInvalid: 'یک پروفایل در دسترس یا پشتیبانی عمومی انتخاب کنید.',
  recordInvalid: 'رکورد در دسترس همین پروفایل را انتخاب کنید.',
  assigneeInvalid: 'یک کارمند در دسترس انتخاب کنید.',
  teamInvalid: 'یک تیم در دسترس یا تخصیص مستقیم انتخاب کنید.',
  filesInvalid: 'حداکثر پنج فایل با قالب و حجم مجاز انتخاب کنید.',
  uncertain: 'این ذخیره تأیید نشد. پیش از ویرایش همان درخواست ثبت‌شده را دوباره ارسال کنید.',
  retryOriginal: 'ارسال دوباره درخواست تیکت ثبت‌شده',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
};
export function tTicketForms(key: string, locale: Locale = 'fa'): string {
  return (locale === 'fa' ? fa : en)[key] ?? key;
}
