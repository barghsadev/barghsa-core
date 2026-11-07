const messages = {
  en: {
    loading: 'Loading page',
    loadingAdmin: 'Loading admin dashboard',
    readError: 'Could not load this information. Try again.',
  },
  fa: {
    loading: 'در حال بارگذاری صفحه',
    loadingAdmin: 'در حال بارگذاری پنل مدیریت',
    readError: 'بارگذاری اطلاعات ناموفق بود. دوباره تلاش کنید.',
  },
} as const;
export function loadingText(key: keyof typeof messages.en, locale: 'en' | 'fa'): string {
  return messages[locale][key];
}
