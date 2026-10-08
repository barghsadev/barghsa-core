const dictionary = {
  fa: {
    title: 'دستیار تلگرام',
    scope:
      'پاسخ‌ها فقط از منابع دانشی منتشرشده تهیه می‌شوند. دستیار به اطلاعات سفارش‌ها و حساب شما دسترسی ندارد.',
    unavailable: 'اتصال تلگرام هنوز در این محیط آماده نیست.',
    connect: 'اتصال حساب تلگرام',
    open: 'باز کردن گفت‌وگوی خصوصی تلگرام',
    code: 'کد شش‌رقمی ارسال‌شده در تلگرام',
    confirm: 'تأیید اتصال',
    revoke: 'قطع اتصال',
    refresh: 'بررسی وضعیت',
    pending:
      'پیوند را در تلگرام باز کنید و کد خصوصی را در این صفحه وارد کنید. این پیوند ده دقیقه اعتبار دارد.',
    claimed: 'حساب خصوصی تلگرام آماده تأیید است.',
    linked: 'حساب تلگرام متصل است.',
    otherProfile: 'این اتصال مربوط به نمایه دیگری است. برای تغییر نمایه، دوباره متصل شوید.',
    error: 'انجام این درخواست ممکن نشد. وضعیت را بررسی کنید و دوباره تلاش کنید.',
    requestUnknown: 'نتیجه درخواست تأیید نشده است. پیش از اقدام بعدی، وضعیت را بررسی کنید.',
    relinkRequired:
      'احراز هویت دوباره نشست تازه‌ای ایجاد کرد. برای دریافت کد جدید، اتصال را از نو آغاز کنید.',
    invalidCode: 'کد معتبر نیست یا پیوند منقضی شده است.',
    privateCode:
      'کد تأیید اتصال تلگرام شما: {code}\nاین کد را فقط در صفحه امنیت حساب برقسا وارد کنید و به دیگران ندهید.',
    knowledge: 'پاسخ بر اساس منابع دانشی منتشرشده',
    sources: 'منابع',
    version: 'نسخه برقسا: {version}',
    deliveryUnknown: 'نتیجه ارسال اخیر نامشخص است. ارسال خودکار تکرار نمی‌شود.',
    deliveryFailed: 'ارسال اخیر کامل نشد. می‌توانید پرسش تازه‌ای ارسال کنید.',
  },
  en: {
    title: 'Telegram assistant',
    scope:
      'Answers use published knowledge only. The assistant cannot read your orders or account data.',
    unavailable: 'Telegram linking is not available in this environment yet.',
    connect: 'Link Telegram account',
    open: 'Open private Telegram chat',
    code: 'Six-digit code sent in Telegram',
    confirm: 'Confirm link',
    revoke: 'Unlink account',
    refresh: 'Check status',
    pending:
      'Open the link in Telegram and enter the private code on this page. The link expires in ten minutes.',
    claimed: 'The private Telegram account is ready to confirm.',
    linked: 'Telegram account linked.',
    otherProfile: 'This link belongs to another profile. Link again to change the profile.',
    error: 'This request could not be completed. Check the status and try again.',
    requestUnknown: 'The request outcome is not confirmed. Check status before another action.',
    relinkRequired:
      'Reauthentication created a new session. Start a new link to receive a fresh code.',
    invalidCode: 'The code is invalid or the link has expired.',
    privateCode:
      'Your Telegram linking code: {code}\nEnter it only on the Barghsa account security page. Do not share it.',
    knowledge: 'Answer from published knowledge',
    sources: 'Sources',
    version: 'Barghsa version: {version}',
    deliveryUnknown: 'The latest send outcome is unknown. It will not be retried automatically.',
    deliveryFailed: 'The latest send did not complete. You can send a new question.',
  },
} as const;
export type TelegramTextKey = keyof typeof dictionary.en;
export function telegramText(key: TelegramTextKey, locale: 'fa' | 'en') {
  return dictionary[locale][key];
}
