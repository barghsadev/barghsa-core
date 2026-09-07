const messages = {
  en: { region: 'Application messages', close: 'Dismiss message' },
  fa: { region: 'پیام‌های برنامه', close: 'بستن پیام' },
} as const;

export function feedbackText(key: keyof typeof messages.en, locale: 'en' | 'fa'): string {
  return messages[locale][key];
}
