const messages = {
  en: {
    next: 'Try again or contact support.',
    team: 'Responsible team: Barghsa support',
    support: 'Contact support',
  },
  fa: {
    next: 'دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.',
    team: 'تیم مسئول: پشتیبانی برقسا',
    support: 'تماس با پشتیبانی',
  },
} as const;
export function serviceFeedback(key: keyof typeof messages.en, locale: 'en' | 'fa'): string {
  return messages[locale][key];
}
