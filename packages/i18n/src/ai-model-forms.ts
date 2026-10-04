import type { Locale } from './app.js';
const en = {
  list: 'AI model table',
  title: 'Enter a model title from 1 to 120 characters.',
  providerType: 'Select an available model provider.',
  baseUrl:
    'Enter an HTTP or HTTPS base URL without credentials, a query or a fragment, up to 500 characters.',
  modelName: 'Enter a provider model name from 1 to 200 characters.',
  maxTokens: 'Enter a whole response limit from 1 to 4096 tokens.',
  temperature: 'Enter a temperature from 0 to 2.',
  apiTokenMessage:
    'Enter a replacement token up to 4000 characters, or explicitly clear it. Re-enter or clear a saved token when changing the destination.',
  tokenChoice:
    'Choose whether to keep, replace or clear the saved token. A changed destination requires replacing or clearing it.',
  monthlyTokenLimit: 'Enter a whole monthly limit from 1 to 1000000000 tokens, or leave it empty.',
  monthlyCostUsd:
    'Enter a monthly USD limit from 0.000001 to 1000000 with at most six decimal places, or leave it empty.',
  inputPriceUsd:
    'Enter an input price from 0 to 1000 USD with at most six decimal places. A cost limit requires a positive price.',
  outputPriceUsd:
    'Enter an output price from 0 to 1000 USD with at most six decimal places. A cost limit requires a positive price.',
  unavailable: 'Validation could not load. Your entries are preserved; try again.',
  invalid: 'Check the highlighted model settings.',
  changed: 'Saved model settings changed. Your entries are preserved; reset before continuing.',
  uncertain: 'The save could not be verified. Refresh models and reset before saving again.',
  reset: 'Reset model draft',
};
const fa: Record<keyof typeof en, string> = {
  list: 'جدول مدل‌های هوش مصنوعی',
  title: 'عنوان مدل را با ۱ تا ۱۲۰ نویسه وارد کنید.',
  providerType: 'یک ارائه‌دهنده موجود مدل را انتخاب کنید.',
  baseUrl:
    'نشانی پایه HTTP یا HTTPS بدون اطلاعات ورود، پارامتر پرس‌وجو یا قطعه، حداکثر با ۵۰۰ نویسه وارد کنید.',
  modelName: 'نام مدل ارائه‌دهنده را با ۱ تا ۲۰۰ نویسه وارد کنید.',
  maxTokens: 'سقف پاسخ را به صورت عدد صحیح از ۱ تا ۴۰۹۶ توکن وارد کنید.',
  temperature: 'دمای پاسخ را از ۰ تا ۲ وارد کنید.',
  apiTokenMessage:
    'کلید جایگزین را حداکثر با ۴۰۰۰ نویسه وارد کنید یا آن را صریحاً پاک کنید. هنگام تغییر مقصد، کلید ذخیره‌شده را دوباره وارد یا پاک کنید.',
  tokenChoice:
    'حفظ، جایگزینی یا پاک‌کردن کلید ذخیره‌شده را انتخاب کنید. تغییر مقصد به جایگزینی یا پاک‌کردن نیاز دارد.',
  monthlyTokenLimit:
    'سقف ماهانه را به صورت عدد صحیح از ۱ تا ۱۰۰۰۰۰۰۰۰۰ توکن وارد کنید یا خالی بگذارید.',
  monthlyCostUsd:
    'سقف ماهانه دلار را از ۰٫۰۰۰۰۰۱ تا ۱۰۰۰۰۰۰ با حداکثر شش رقم اعشار وارد کنید یا خالی بگذارید.',
  inputPriceUsd:
    'قیمت ورودی را از ۰ تا ۱۰۰۰ دلار با حداکثر شش رقم اعشار وارد کنید. سقف هزینه به قیمت مثبت نیاز دارد.',
  outputPriceUsd:
    'قیمت خروجی را از ۰ تا ۱۰۰۰ دلار با حداکثر شش رقم اعشار وارد کنید. سقف هزینه به قیمت مثبت نیاز دارد.',
  unavailable: 'اعتبارسنجی بارگیری نشد. داده‌های شما حفظ شده است؛ دوباره تلاش کنید.',
  invalid: 'تنظیمات مشخص‌شده مدل را بررسی کنید.',
  changed:
    'تنظیمات ذخیره‌شده مدل تغییر کرده است. داده‌های شما حفظ شده است؛ پیش از ادامه بازنشانی کنید.',
  uncertain: 'ذخیره تأیید نشد. پیش از ذخیره دوباره، مدل‌ها را تازه‌سازی و بازنشانی کنید.',
  reset: 'بازنشانی پیش‌نویس مدل',
};
export function aiModelFormText(key: keyof typeof en, locale: Locale): string {
  return (locale === 'fa' ? fa : en)[key];
}
