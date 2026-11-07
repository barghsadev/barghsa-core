const messages = {
  en: {
    today: 'Today',
    yesterday: 'Yesterday',
    week: 'This week',
    older: 'Older',
    datesUnavailable: 'Date groups are unavailable. Notifications remain available below.',
    retry: 'Try again',
    ungrouped: 'Notifications',
  },
  fa: {
    today: 'امروز',
    yesterday: 'دیروز',
    week: 'این هفته',
    older: 'قدیمی‌تر',
    datesUnavailable: 'گروه‌بندی تاریخ در دسترس نیست. اعلان‌ها در ادامه قابل مشاهده‌اند.',
    retry: 'تلاش دوباره',
    ungrouped: 'اعلان‌ها',
  },
} as const;

export function notificationFeedback(key: keyof typeof messages.en, locale: 'en' | 'fa'): string {
  return messages[locale][key];
}
