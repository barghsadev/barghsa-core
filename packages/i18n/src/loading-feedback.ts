const messages = {
  en: { loading: 'Loading page', loadingAdmin: 'Loading admin dashboard' },
  fa: { loading: 'در حال بارگذاری صفحه', loadingAdmin: 'در حال بارگذاری پنل مدیریت' },
} as const;
export function loadingText(key: keyof typeof messages.en, locale: 'en' | 'fa'): string {
  return messages[locale][key];
}
