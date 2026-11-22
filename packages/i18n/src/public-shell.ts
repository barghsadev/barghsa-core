export const publicShellMessages = {
  fa: {
    language: 'تغییر زبان به انگلیسی',
    languageCode: 'EN',
    focusNavigation: 'ادامه پیمایش با صفحه‌کلید',
    authTitle: 'انرژی، در اختیار شما',
    authServiceSummary: 'خرید برق، بهینه‌سازی مصرف، انرژی خورشیدی و مشاوره در یک حساب.',
    appVersion: 'نسخه',
  },
  en: {
    language: 'Switch language to Persian',
    languageCode: 'FA',
    focusNavigation: 'Continue keyboard navigation',
    authTitle: 'Your energy, under control',
    authServiceSummary: 'Electricity, energy savings, solar and advice in one account.',
    appVersion: 'Version',
  },
};

export function publicShellText(
  key: keyof typeof publicShellMessages.en,
  locale: 'en' | 'fa'
): string {
  return publicShellMessages[locale][key];
}
