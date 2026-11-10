export const publicShellMessages = {
  fa: {
    language: 'تغییر زبان به انگلیسی',
    languageCode: 'EN',
    focusNavigation: 'ادامه پیمایش با صفحه‌کلید',
    authEyebrow: 'انرژی، با دید روشن',
    authTitle: 'مدیریت انرژی.\nبا اطمینان بیشتر.',
    authNote: 'حساب کاربری شما، نقطه شروع خدمات ما.',
    appVersion: 'نسخه',
  },
  en: {
    language: 'Switch language to Persian',
    languageCode: 'FA',
    focusNavigation: 'Continue keyboard navigation',
    authEyebrow: 'A clearer view of energy',
    authTitle: 'Your energy.\nUnder control.',
    authNote: 'Your account is the starting point for our services.',
    appVersion: 'Version',
  },
};

export function publicShellText(
  key: keyof typeof publicShellMessages.en,
  locale: 'en' | 'fa'
): string {
  return publicShellMessages[locale][key];
}
