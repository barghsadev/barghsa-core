const messages = {
  en: {
    loading: 'Loading page',
    loadingAdmin: 'Loading admin dashboard',
    readError: 'Could not load this information. Try again.',
    recordUnavailable: 'Record unavailable.',
    connectionRetry: 'Connection interrupted. Retrying the request…',
  },
  fa: {
    loading: 'در حال بارگذاری صفحه',
    loadingAdmin: 'در حال بارگذاری پنل مدیریت',
    readError: 'بارگذاری اطلاعات ناموفق بود. دوباره تلاش کنید.',
    recordUnavailable: 'این مورد در دسترس نیست.',
    connectionRetry: 'ارتباط قطع شد. درخواست دوباره ارسال می‌شود…',
  },
} as const;
export function loadingText(key: keyof typeof messages.en, locale: 'en' | 'fa'): string {
  return messages[locale][key];
}

const reloadMessages = {
  en: { chunkTitle: 'Failed to load this page', reload: 'Reload page' },
  fa: { chunkTitle: 'بارگذاری صفحه ناموفق بود', reload: 'بارگذاری دوباره صفحه' },
} as const;

export function reloadText(key: keyof typeof reloadMessages.en, locale: 'en' | 'fa'): string {
  return reloadMessages[locale][key];
}
