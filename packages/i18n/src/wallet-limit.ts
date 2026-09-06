const fa: Record<string, string> = {
  'admin.walletLimit.title': 'سقف شارژ آنلاین کیف پول',
  'admin.walletLimit.description':
    'سقف هر تراکنش شارژ آنلاین به ریال. مقدار صفر همه شارژهای آنلاین را مسدود می‌کند.',
  'admin.walletLimit.label': 'سقف هر تراکنش (ریال)',
  'admin.walletLimit.toman': '≈ {amount} تومان',
  'admin.walletLimit.warning':
    'تغییر این سقف فقط روی شارژهای آنلاین بعدی اثر می‌گذارد. تراکنش‌های در جریان با سقف زمان ثبت خود ادامه می‌یابند.',
  'admin.walletLimit.save': 'ذخیره',
  'admin.walletLimit.saving': 'در حال ذخیره…',
  'admin.walletLimit.saved': 'ذخیره شد',
  'admin.walletLimit.loading': 'در حال بارگذاری سقف شارژ آنلاین…',
  'admin.walletLimit.loadFailed': 'بارگذاری سقف شارژ آنلاین ناموفق بود',
  'admin.walletLimit.saveFailed': 'ذخیره سقف شارژ آنلاین ناموفق بود',
  'admin.walletLimit.invalid': 'سقف باید یک عدد صحیح بین ۰ و {max} باشد',
  'admin.walletLimit.reload': 'بارگذاری دوباره مقدار فعلی',
  'admin.walletLimit.current': 'سقف فعلی',
  'admin.walletLimit.version': 'نسخه پیکربندی: {version}',
  'admin.walletLimit.conflict':
    'سقف توسط ادمین دیگری به‌روز شده است. انصراف دهید، مقدار فعلی را دوباره بارگذاری کنید و پیش از ذخیره، تغییر خود را بررسی کنید.',
};
const en: Record<string, string> = {
  'admin.walletLimit.title': 'Online wallet top-up limit',
  'admin.walletLimit.description':
    'Per-transaction ceiling for online wallet top-ups, in IRR. A value of 0 blocks all online top-ups.',
  'admin.walletLimit.label': 'Per-transaction limit (IRR)',
  'admin.walletLimit.toman': '≈ {amount} Toman',
  'admin.walletLimit.warning':
    'Changing this limit affects all future online top-ups. In-flight submissions keep the ceiling that was enforced when they were created.',
  'admin.walletLimit.save': 'Save',
  'admin.walletLimit.saving': 'Saving…',
  'admin.walletLimit.saved': 'Saved',
  'admin.walletLimit.loading': 'Loading online top-up limit…',
  'admin.walletLimit.loadFailed': 'Failed to load the online top-up limit',
  'admin.walletLimit.saveFailed': 'Failed to save the online top-up limit',
  'admin.walletLimit.invalid': 'Limit must be an integer between 0 and {max}',
  'admin.walletLimit.reload': 'Reload current value',
  'admin.walletLimit.current': 'Current limit',
  'admin.walletLimit.version': 'Config version: {version}',
  'admin.walletLimit.conflict':
    'The limit was updated by another admin. Cancel, reload the current value and review your change before saving.',
};
export function tWalletLimit(key: string, locale: 'fa' | 'en'): string {
  return (locale === 'fa' ? fa : en)[key] ?? key;
}
