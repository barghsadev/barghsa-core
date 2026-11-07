const messages = {
  en: {
    charts: 'Charts and analytics',
    chartsDescription: 'Charts of electricity market data.',
    videos: 'Video uploads',
    videosDescription: 'Inspection footage and media management.',
  },
  fa: {
    charts: 'نمودارها و تحلیل‌ها',
    chartsDescription: 'نمودارهای داده‌های بازار برق.',
    videos: 'بارگذاری ویدیو',
    videosDescription: 'ویدیوهای بازدید و مدیریت رسانه‌ها.',
  },
} as const;

export function workspaceMedia(key: keyof typeof messages.en, locale: 'en' | 'fa'): string {
  return messages[locale][key];
}
