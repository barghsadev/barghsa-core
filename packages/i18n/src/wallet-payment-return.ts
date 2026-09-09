const fa: Record<string, string> = {
  'wallet.return.title': 'نتیجه پرداخت آنلاین',
  'wallet.return.description': 'برای بررسی نتیجه پرداخت در درگاه، دکمه زیر را بزنید.',
  'wallet.return.check': 'بررسی پرداخت',
  'wallet.return.checking': 'در حال بررسی پرداخت…',
  'wallet.return.credited': 'پرداخت تأیید شد و مبلغ به کیف پول اضافه شد.',
  'wallet.return.unpaid': 'درگاه هنوز پرداخت را تأیید نکرده است. می‌توانید دوباره بررسی کنید.',
  'wallet.return.auth':
    'ابتدا در برگه جدید وارد حساب شوید، سپس به این صفحه برگردید و پرداخت را دوباره بررسی کنید.',
  'wallet.return.login': 'ورود در برگه جدید',
  'wallet.return.error': 'بررسی پرداخت انجام نشد. دوباره تلاش کنید.',
};
const en: Record<string, string> = {
  'wallet.return.title': 'Online payment result',
  'wallet.return.description': 'Check the payment result with the payment provider.',
  'wallet.return.check': 'Check payment',
  'wallet.return.checking': 'Checking payment…',
  'wallet.return.credited': 'Payment confirmed and added to your wallet.',
  'wallet.return.unpaid': 'The provider has not confirmed payment. You can check again.',
  'wallet.return.auth': 'Sign in in a new tab, then return here and check the payment again.',
  'wallet.return.login': 'Sign in in a new tab',
  'wallet.return.error': 'Payment could not be checked. Please try again.',
};
export function tWalletPaymentReturn(key: string, locale: 'fa' | 'en'): string {
  const messages = locale === 'fa' ? fa : en;
  return Object.hasOwn(messages, key) ? messages[key]! : key;
}
