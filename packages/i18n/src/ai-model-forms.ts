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
  connection: 'Provider connection',
  titleHint: 'Shown when staff choose a model.',
  modelNameHint: 'Use the exact model name from your provider.',
  requestPathHint: 'Path added to this URL',
  temperatureHint: 'Lower values make replies more consistent.',
  editModel: 'Edit model',
  authentication: 'Authentication',
  responseSettings: 'Response defaults',
  budgetLimits: 'Monthly limits',
  budgetPricing: 'Token pricing',
  tokenLimit: 'Token limit',
  costLimit: 'Cost limit (USD)',
  budgetUsage: 'Usage this month',
  budgetUsedTokens: 'Tokens used',
  budgetUsedCost: 'Estimated cost',
  budgetUsageHelp: 'Usage starts over at the beginning of each UTC month.',
  budgetUsageNone: 'Save at least one limit to start tracking usage for this model.',
  budgetPricingHelp: 'USD per million tokens. A cost limit requires both prices to be above zero.',
  budgetInputUsd: 'Input price',
  budgetOutputUsd: 'Output price',
  budgetReview: 'Monthly budget after saving',
  budgetNoLimit: 'No limit',
  budgetLimitReached:
    'A proposed limit is at or below this month’s usage. New requests may be blocked.',
  budgetRemove:
    'Saving with both limits blank removes the budget, its prices, and its tracked usage.',
  budgetNoSettings: 'Leave at least one limit set to save pricing and start tracking usage.',
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
  connection: 'اتصال به ارائه‌دهنده',
  titleHint: 'کارکنان مدل را با این نام انتخاب می‌کنند.',
  modelNameHint: 'شناسه دقیق مدل را از ارائه‌دهنده بگیرید.',
  requestPathHint: 'مسیر افزوده‌شده به این نشانی',
  temperatureHint: 'مقدار کمتر پاسخ‌ها را یکدست‌تر می‌کند.',
  editModel: 'ویرایش مدل',
  authentication: 'احراز هویت',
  responseSettings: 'پیش‌فرض‌های پاسخ',
  budgetLimits: 'سقف‌های ماهانه',
  budgetPricing: 'قیمت توکن',
  tokenLimit: 'سقف توکن',
  costLimit: 'سقف هزینه (دلار)',
  budgetUsage: 'مصرف این ماه',
  budgetUsedTokens: 'توکن مصرف‌شده',
  budgetUsedCost: 'هزینه برآوردشده',
  budgetUsageHelp: 'شمارش مصرف در آغاز هر ماه به وقت UTC از صفر شروع می‌شود.',
  budgetUsageNone: 'برای شروع ثبت مصرف این مدل، دست‌کم یک سقف تعیین و ذخیره کنید.',
  budgetPricingHelp:
    'به دلار آمریکا برای هر یک میلیون توکن. برای تعیین سقف هزینه، هر دو قیمت باید بیشتر از صفر باشند.',
  budgetInputUsd: 'قیمت ورودی',
  budgetOutputUsd: 'قیمت خروجی',
  budgetReview: 'بودجه ماهانه پس از ذخیره',
  budgetNoLimit: 'بدون سقف',
  budgetLimitReached:
    'یکی از سقف‌های پیشنهادی برابر با مصرف این ماه یا کمتر از آن است. ممکن است درخواست‌های جدید مسدود شوند.',
  budgetRemove: 'ذخیره با هر دو سقف خالی، بودجه، قیمت‌ها و مصرف ثبت‌شده آن را حذف می‌کند.',
  budgetNoSettings: 'برای ذخیره قیمت‌ها و شروع ثبت مصرف، دست‌کم یکی از سقف‌ها را تعیین کنید.',
};
export function aiModelFormText(key: keyof typeof en, locale: Locale): string {
  return (locale === 'fa' ? fa : en)[key];
}
