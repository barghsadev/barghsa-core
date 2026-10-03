import type { Locale } from './app.js';
const en = {
  label: 'Enter a name between 1 and 120 characters.',
  host: 'Enter an SMTP host up to 253 characters.',
  port: 'Enter a whole port number from 1 to 65535.',
  security: 'Select TLS or STARTTLS.',
  username: 'Use up to 255 characters for the username.',
  passwordMessage: 'Use up to 2048 characters for the password.',
  connectionTimeout: 'Enter a whole timeout from 1 to 600 seconds.',
  commandTimeout: 'Enter a whole timeout from 1 to 600 seconds.',
  fromName: 'Use up to 255 characters for the sender name.',
  fromEmail: 'Enter a valid sender email up to 320 characters.',
  replyTo: 'Enter a valid reply email up to 320 characters, or leave it empty.',
  apiKeyMessage:
    'Enter an API key up to 1024 characters. Leave it empty when editing to keep the saved key.',
  sendingDomain: 'Use up to 253 characters for the sending domain.',
  sender: 'Enter a sender line up to 64 characters.',
  timeout: 'Enter a whole timeout from 1 to 300 seconds.',
  throughput: 'Enter a whole sending limit from 1 to 10000.',
  credit: 'Enter a whole credit threshold from 0 to 1000000000.',
  mappings:
    'Use available events, unique event/language pairs, positive template IDs and unique variable/parameter names.',
  validationUnavailable: 'Validation could not load. Try submitting again.',
  uncertain: 'The save could not be verified. Refresh providers and reset before trying again.',
  reset: 'Reset provider draft',
};
const fa: Record<keyof typeof en, string> = {
  label: 'نام را با ۱ تا ۱۲۰ نویسه وارد کنید.',
  host: 'میزبان SMTP را حداکثر با ۲۵۳ نویسه وارد کنید.',
  port: 'شماره درگاه را به صورت عدد صحیح از ۱ تا ۶۵۵۳۵ وارد کنید.',
  security: 'TLS یا STARTTLS را انتخاب کنید.',
  username: 'نام کاربری حداکثر ۲۵۵ نویسه باشد.',
  passwordMessage: 'گذرواژه حداکثر ۲۰۴۸ نویسه باشد.',
  connectionTimeout: 'زمان اتصال را به صورت عدد صحیح از ۱ تا ۶۰۰ ثانیه وارد کنید.',
  commandTimeout: 'زمان فرمان را به صورت عدد صحیح از ۱ تا ۶۰۰ ثانیه وارد کنید.',
  fromName: 'نام فرستنده حداکثر ۲۵۵ نویسه باشد.',
  fromEmail: 'ایمیل معتبر فرستنده را حداکثر با ۳۲۰ نویسه وارد کنید.',
  replyTo: 'ایمیل پاسخ معتبر را حداکثر با ۳۲۰ نویسه وارد کنید یا خالی بگذارید.',
  apiKeyMessage:
    'کلید API را حداکثر با ۱۰۲۴ نویسه وارد کنید. هنگام ویرایش برای حفظ کلید ذخیره‌شده خالی بگذارید.',
  sendingDomain: 'دامنه ارسال حداکثر ۲۵۳ نویسه باشد.',
  sender: 'خط فرستنده را حداکثر با ۶۴ نویسه وارد کنید.',
  timeout: 'زمان انتظار را به صورت عدد صحیح از ۱ تا ۳۰۰ ثانیه وارد کنید.',
  throughput: 'سقف ارسال را به صورت عدد صحیح از ۱ تا ۱۰۰۰۰ وارد کنید.',
  credit: 'آستانه اعتبار را به صورت عدد صحیح از ۰ تا ۱۰۰۰۰۰۰۰۰۰ وارد کنید.',
  mappings:
    'رویدادهای موجود، زوج‌های یکتای رویداد و زبان، شناسه مثبت قالب و نام‌های یکتای متغیر و پارامتر را وارد کنید.',
  validationUnavailable: 'اعتبارسنجی بارگیری نشد. دوباره ارسال کنید.',
  uncertain: 'ذخیره تأیید نشد. پیش از تلاش دوباره، تأمین‌کنندگان را تازه‌سازی و بازنشانی کنید.',
  reset: 'بازنشانی پیش‌نویس تأمین‌کننده',
};
export type ProviderFormKey = keyof typeof en;
export function providerFormText(key: ProviderFormKey, locale: Locale): string {
  return (locale === 'fa' ? fa : en)[key];
}
