const messages = {
  en: {
    region: 'Application messages',
    close: 'Dismiss message',
    loading: 'Loading page',
    loadingAdmin: 'Loading admin dashboard',
    errorTitle: 'Something went wrong',
    errorDescription: 'Please try again. If the problem persists, contact support.',
    chunkTitle: 'Failed to load this page',
    chunkDescription: 'Check your connection and try again.',
    retry: 'Try again',
    support: 'Contact support',
    home: 'Go home',
  },
  fa: {
    region: 'پیام‌های برنامه',
    close: 'بستن پیام',
    loading: 'در حال بارگذاری صفحه',
    loadingAdmin: 'در حال بارگذاری پنل مدیریت',
    errorTitle: 'خطایی رخ داد',
    errorDescription: 'دوباره تلاش کنید. اگر مشکل ادامه داشت، با پشتیبانی تماس بگیرید.',
    chunkTitle: 'بارگذاری صفحه ناموفق بود',
    chunkDescription: 'اتصال اینترنت خود را بررسی و دوباره تلاش کنید.',
    retry: 'تلاش دوباره',
    support: 'تماس با پشتیبانی',
    home: 'صفحه اصلی',
  },
} as const;

export function feedbackText(key: keyof typeof messages.en, locale: 'en' | 'fa'): string {
  return messages[locale][key];
}
