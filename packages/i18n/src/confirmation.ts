const messages = {
  en: {
    confirm: 'Confirm',
    cancel: 'Cancel',
    phrase: 'CONFIRM',
    typePhrase: 'Type CONFIRM to authorize this action.',
    acknowledge:
      'I understand the reviewed amounts, consequences and applicable cancellation/refund rules.',
    toman: 'toman',
    recorded: 'Update recorded',
    unconfirmed: 'The outcome is unconfirmed. Check the current status before trying again.',
  },
  fa: {
    confirm: 'تأیید',
    cancel: 'انصراف',
    phrase: 'تأیید',
    typePhrase: 'برای اجازه انجام این اقدام، عبارت «تأیید» را وارد کنید.',
    acknowledge: 'مبالغ بررسی‌شده، پیامدها و قوانین مربوط به لغو و بازپرداخت را درک می‌کنم.',
    toman: 'تومان',
    recorded: 'به‌روزرسانی ثبت شد',
    unconfirmed: 'نتیجه هنوز تأیید نشده است. پیش از تلاش دوباره وضعیت فعلی را بررسی کنید.',
  },
} as const;

export function confirmationText(key: keyof typeof messages.en, locale: 'fa' | 'en'): string {
  return messages[locale][key];
}
