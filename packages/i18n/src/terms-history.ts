import { lookup } from './lookup.js';
import type { Locale } from './app.js';
export const fa = {
  history: 'نسخه‌های منتشرشدهٔ شرایط استفاده',
  moreVersions: 'نمایش نسخه‌های قدیمی‌تر',
  historyError: 'دریافت نسخه‌های منتشرشده ممکن نشد. دوباره تلاش کنید.',
  historyEmpty: 'نسخهٔ منتشرشده‌ای برای نمایش وجود ندارد.',
};
export const en = {
  history: 'Published terms versions',
  moreVersions: 'Show older versions',
  historyError: 'Could not load published versions. Please try again.',
  historyEmpty: 'No published versions are available.',
};

/** Public history copy stays with the terms route, outside the auth entry. */
export function termsHistoryText(key: string, locale: Locale = 'fa'): string {
  return lookup(locale === 'fa' ? fa : en, key) ?? lookup(en, key) ?? key;
}
