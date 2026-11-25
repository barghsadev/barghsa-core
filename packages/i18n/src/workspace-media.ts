const messages = {
  en: {
    charts: 'Charts and analytics',
    chartsDescription: 'Electricity market charts are unavailable in this workspace.',
    electricityServices: 'Electricity services',
    videos: 'Video uploads',
    videosDescription:
      'Find inspection instructions and supported documents on your solar request.',
    solarRequests: 'Solar requests',
  },
  fa: {
    charts: 'نمودارها و تحلیل‌ها',
    chartsDescription: 'نمودارهای بازار برق در این محیط در دسترس نیستند.',
    electricityServices: 'خدمات برق',
    videos: 'بارگذاری ویدیو',
    videosDescription: 'راهنمای بازدید و مدارک قابل ثبت را در درخواست خورشیدی خود ببینید.',
    solarRequests: 'درخواست‌های خورشیدی',
  },
} as const;

export function workspaceMedia(key: keyof typeof messages.en, locale: 'en' | 'fa'): string {
  return messages[locale][key];
}
