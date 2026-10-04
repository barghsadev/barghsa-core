import type { Locale } from './app.js';
const en = {
  question: 'Enter a question from 1 to 1000 characters.',
  message: 'Enter a test message from 1 to 4000 characters.',
  agentId: 'Select a currently enabled agent.',
  slotKey: 'Select an available preview slot.',
  unavailable: 'Validation could not load. Your message is preserved; try again.',
  invalid: 'Check the highlighted chat fields.',
  edit: 'Edit question',
  retryHelp:
    'Your question is preserved. Retry to check the same request, or edit it to start a new request.',
  denied: 'Access to this conversation changed. Refresh the page to check your access.',
  wait: 'Try again in {seconds} seconds.',
  applied: 'Applied',
  blocked: 'Blocked',
  milliseconds: '{count} ms',
};
const fa: Record<keyof typeof en, string> = {
  question: 'پرسش خود را با ۱ تا ۱۰۰۰ نویسه وارد کنید.',
  message: 'پیام آزمایشی را با ۱ تا ۴۰۰۰ نویسه وارد کنید.',
  agentId: 'یک عامل فعال موجود را انتخاب کنید.',
  slotKey: 'یک جایگاه موجود برای پیش‌نمایش انتخاب کنید.',
  unavailable: 'اعتبارسنجی بارگیری نشد. پیام شما حفظ شده است؛ دوباره تلاش کنید.',
  invalid: 'فیلدهای مشخص‌شده گفت‌وگو را بررسی کنید.',
  edit: 'ویرایش پرسش',
  retryHelp:
    'پرسش شما حفظ شده است. برای بررسی همان درخواست دوباره تلاش کنید یا برای شروع درخواست تازه آن را ویرایش کنید.',
  denied: 'دسترسی به این گفت‌وگو تغییر کرده است. برای بررسی دسترسی صفحه را تازه‌سازی کنید.',
  wait: 'پس از {seconds} ثانیه دوباره تلاش کنید.',
  applied: 'اعمال شد',
  blocked: 'مسدود شد',
  milliseconds: '{count} میلی‌ثانیه',
};
export function assistantChatFormText(key: keyof typeof en, locale: Locale): string {
  return (locale === 'fa' ? fa : en)[key];
}
