import type { Locale } from './index.js';
const en = {
  unrecognizedDevice: 'Unrecognized device',
  newDeviceTitle: 'Sign-in from an unrecognized device',
  newDeviceBody:
    'A sign-in from an unrecognized device completed on your account. Review your sessions. If this was not you, contact support immediately.',
  sessionRevokedTitle: 'Sessions on your account were revoked',
  sessionRevokedBody:
    'One or more sessions on your account were revoked. If you did not request this, contact support immediately.',
  passwordChangedTitle: 'Your password changed',
  passwordChangedBody:
    'Your account password changed successfully. If you did not make this change, contact support immediately.',
  passwordRequired: 'Enter your current password.',
  invalidPassword: 'The password was not accepted. Check it and try again.',
  validationUnavailable: 'Validation is unavailable. Your password is kept; try again.',
  error: 'The request was not accepted. Your password is kept.',
  sourceChanged: 'The selected item is no longer available. Refresh the list before continuing.',
  uncertain: 'The result is not confirmed. Check the current security state before continuing.',
  check: 'Check current security state',
  checking: 'Checking security state…',
  checkFailed: 'The security state could not be checked. Try the check again.',
  stillPresent: 'The selected sessions or device trust remain. You can return to editing.',
  restart: 'Return to editing',
  confirmed: 'The requested security state is confirmed.',
  denied: 'Account access has changed. Reload this page to continue.',
  refresh: 'Refresh sessions',
  loading: 'Loading…',
} as const;
const fa: Record<keyof typeof en, string> = {
  unrecognizedDevice: 'دستگاه ناشناس',
  newDeviceTitle: 'ورود از دستگاه ناشناس',
  newDeviceBody:
    'ورود از دستگاه ناشناس به حساب شما انجام شد. نشست‌های خود را بررسی کنید. اگر این ورود کار شما نبوده، فوراً با پشتیبانی تماس بگیرید.',
  sessionRevokedTitle: 'نشست‌های حساب شما باطل شد',
  sessionRevokedBody:
    'یک یا چند نشست حساب شما باطل شد. اگر این کار را شما درخواست نکرده‌اید، فوراً با پشتیبانی تماس بگیرید.',
  passwordChangedTitle: 'رمز عبور شما تغییر کرد',
  passwordChangedBody:
    'رمز عبور حساب شما با موفقیت تغییر کرد. اگر این تغییر را شما انجام نداده‌اید، فوراً با پشتیبانی تماس بگیرید.',
  passwordRequired: 'رمز عبور فعلی خود را وارد کنید.',
  invalidPassword: 'رمز عبور پذیرفته نشد. آن را بررسی و دوباره تلاش کنید.',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. رمز عبور حفظ شده؛ دوباره تلاش کنید.',
  error: 'درخواست پذیرفته نشد. رمز عبور حفظ شده است.',
  sourceChanged: 'مورد انتخاب‌شده دیگر در دسترس نیست. پیش از ادامه فهرست را تازه‌سازی کنید.',
  uncertain: 'نتیجه تأیید نشده است. پیش از ادامه وضعیت فعلی امنیت را بررسی کنید.',
  check: 'بررسی وضعیت فعلی امنیت',
  checking: 'در حال بررسی وضعیت امنیت…',
  checkFailed: 'بررسی وضعیت امنیت ممکن نشد. دوباره بررسی کنید.',
  stillPresent:
    'نشست‌ها یا اعتماد به دستگاه انتخاب‌شده هنوز باقی است. می‌توانید به ویرایش برگردید.',
  restart: 'بازگشت به ویرایش',
  confirmed: 'وضعیت امنیت درخواستی تأیید شد.',
  denied: 'دسترسی حساب تغییر کرده است. برای ادامه صفحه را دوباره بارگذاری کنید.',
  refresh: 'تازه‌سازی نشست‌ها',
  loading: 'در حال بارگذاری…',
};
export const securitySettingsDictionaries = { en, fa };
export function securitySettingsText(key: string, locale: Locale): string {
  return securitySettingsDictionaries[locale][key as keyof typeof en] ?? key;
}
