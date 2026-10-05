import type { Locale } from './app.js';

export const en: Record<string, string> = {
  sourceHelp: 'Select an available template version or a document for this request.',
  sourceInvalid: 'Select an available contract source.',
  titleInvalid: 'Enter a contract title of 1–200 characters.',
  textInvalid: 'Enter contract terms of 1–60,000 characters within the 65,536-byte contract limit.',
  reasonInvalid: 'Enter a draft description of 1–1,000 characters.',
  valueHelp: 'State the full contract value separately from the initial invoice.',
  valueInvalid: 'Select fixed or variable commercial value.',
  amountInvalid:
    'Enter 0 or a whole IRR amount up to 9,223,372,036,854,775,807, without leading zeros.',
  variableInvalid: 'Describe how the amount is determined in 1–500 characters.',
  lineHelp: 'Initial invoice rows retain their order. VAT uses basis points (900 = 9%).',
  lineInvalid: 'Enter 1–100 complete invoice rows with a positive supported total.',
  descriptionInvalid: 'Enter an invoice description of 1–1,000 characters.',
  quantityInvalid: 'Enter a whole quantity from 1 to 2,147,483,647.',
  priceInvalid:
    'Enter 1–19 digits within the supported IRR amount. Zero and leading zeros are allowed.',
  vatInvalid: 'Enter whole VAT basis points from 0 to 10,000.',
  taxableInvalid: 'Choose whether this row is taxable.',
  uncertain: 'Contract issuance could not be confirmed. Retry the captured command before editing.',
  retryCaptured: 'Retry captured contract issuance',
  reloadOptions: 'Retry contract sources',
  validationUnavailable: 'Validation is unavailable. Please try again.',
};
export const fa: Record<string, string> = {
  sourceHelp: 'یک نسخه الگوی در دسترس یا سند مربوط به این درخواست را انتخاب کنید.',
  sourceInvalid: 'منبع در دسترس قرارداد را انتخاب کنید.',
  titleInvalid: 'عنوان قرارداد را با ۱ تا ۲۰۰ نویسه وارد کنید.',
  textInvalid: 'متن قرارداد را با ۱ تا ۶۰٬۰۰۰ نویسه و در محدوده ۶۵٬۵۳۶ بایت قرارداد وارد کنید.',
  reasonInvalid: 'شرح پیش‌نویس را با ۱ تا ۱٬۰۰۰ نویسه وارد کنید.',
  valueHelp: 'ارزش کامل قرارداد را جدا از فاکتور اولیه مشخص کنید.',
  valueInvalid: 'ارزش تجاری ثابت یا متغیر را انتخاب کنید.',
  amountInvalid:
    'صفر یا مبلغ صحیح ریالی تا ۹٬۲۲۳٬۳۷۲٬۰۳۶٬۸۵۴٬۷۷۵٬۸۰۷ را بدون صفر ابتدایی وارد کنید.',
  variableInvalid: 'روش تعیین مبلغ را با ۱ تا ۵۰۰ نویسه شرح دهید.',
  lineHelp: 'ترتیب ردیف‌های فاکتور اولیه حفظ می‌شود. نرخ مالیات بر حسب واحد پایه است (۹۰۰ = ۹٪).',
  lineInvalid: '۱ تا ۱۰۰ ردیف کامل فاکتور با مجموع مثبت در محدوده مجاز وارد کنید.',
  descriptionInvalid: 'شرح ردیف فاکتور را با ۱ تا ۱٬۰۰۰ نویسه وارد کنید.',
  quantityInvalid: 'تعداد صحیح بین ۱ تا ۲٬۱۴۷٬۴۸۳٬۶۴۷ وارد کنید.',
  priceInvalid: '۱ تا ۱۹ رقم در محدوده مبلغ مجاز ریالی وارد کنید. صفر و صفر ابتدایی مجاز است.',
  vatInvalid: 'نرخ مالیات صحیح بین صفر تا ۱۰٬۰۰۰ واحد پایه وارد کنید.',
  taxableInvalid: 'مشمول مالیات بودن ردیف را مشخص کنید.',
  uncertain: 'صدور قرارداد تأیید نشد. پیش از ویرایش، همان فرمان ثبت‌شده را دوباره ارسال کنید.',
  retryCaptured: 'ارسال دوباره فرمان صدور قرارداد',
  reloadOptions: 'تلاش دوباره برای منابع قرارداد',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
};
export function tSolarContract(key: string, locale: Locale = 'fa'): string {
  return (locale === 'fa' ? fa : en)[key] ?? key;
}
