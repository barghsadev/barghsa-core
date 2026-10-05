import type { Locale } from './app.js';

export const en: Record<string, string> = {
  uncertain:
    'This paid consultation action could not be confirmed. Retry the captured command before editing.',
  retryCaptured: 'Retry captured consultation action',
};
export const fa: Record<string, string> = {
  uncertain:
    'این اقدام مشاوره پرداخت‌شده تأیید نشد. پیش از ویرایش، همان فرمان ثبت‌شده را دوباره ارسال کنید.',
  retryCaptured: 'ارسال دوباره اقدام مشاوره ثبت‌شده',
};
export function tConsultationResolution(key: string, locale: Locale = 'fa'): string {
  return (locale === 'fa' ? fa : en)[key] ?? key;
}
