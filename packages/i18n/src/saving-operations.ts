import type { Locale } from './app.js';

export const en: Record<string, string> = {
  reasonInvalid: 'Enter a rejection reason of 1 to 1,000 characters.',
  explanationInvalid: 'Enter a stage explanation of 1 to 1,000 characters.',
  handoverInvalid: 'Enter handover details of 1 to 1,000 characters.',
  decisionTitle: 'Review the order',
  rejectionReason: 'Reason for rejection',
  rejectionHelp: 'Required to reject. Up to 1,000 characters.',
  explanationHelp:
    'Explain the stage action in at most 1,000 characters. The customer can read it.',
  handoverHelp: 'Enter these details when completing handover.',
  handoverExample: 'Example: Meter and accessories delivered to the customer.',
  stageProgress: 'Stage progress',
  checking: 'Checking the current order and financial review…',
  validationUnavailable: 'Validation is unavailable. Try again.',
  uncertain: 'This action could not be confirmed. Retry the captured command before editing.',
  retryCaptured: 'Retry captured staff action',
  missing: 'This order is unavailable.',
  backToOrder: 'Back to saving order',
  actionUnavailable: 'This action is unavailable at the current stage of the order.',
  rejectionPrompt: 'Explain what prevents the order from proceeding.',
  rejectionNotice: 'The review shows the invoice and refund impact before you confirm.',
  noteLimit: 'Up to 1,000 characters.',
  noteVisible: 'The customer can read this note. Up to 1,000 characters.',
  request_confirmationPrompt: 'Record what was confirmed with the customer.',
  product_deliveryPrompt: 'Record what was delivered, when, and who received it.',
  installation_and_document_uploadPrompt:
    'Summarize the installation and identify the documents on file.',
  equipment_handoverPrompt: 'Record the handover outcome or explain why it was skipped.',
  process_completionPrompt: 'Summarize the completed work and any follow-up for the customer.',
};

export const fa: Record<string, string> = {
  reasonInvalid: 'دلیل رد باید بین ۱ تا ۱٬۰۰۰ نویسه باشد.',
  explanationInvalid: 'توضیح مرحله باید بین ۱ تا ۱٬۰۰۰ نویسه باشد.',
  handoverInvalid: 'جزئیات تحویل باید بین ۱ تا ۱٬۰۰۰ نویسه باشد.',
  decisionTitle: 'بررسی سفارش',
  rejectionReason: 'دلیل رد سفارش',
  rejectionHelp: 'برای رد سفارش الزامی است. حداکثر ۱٬۰۰۰ نویسه.',
  explanationHelp: 'اقدام مرحله را در حداکثر ۱٬۰۰۰ نویسه توضیح دهید. مشتری می‌تواند آن را بخواند.',
  handoverHelp: 'برای تکمیل مرحله، جزئیات تحویل را وارد کنید.',
  handoverExample: 'مثال: کنتور و لوازم جانبی به مشتری تحویل داده شد.',
  stageProgress: 'پیشرفت مراحل',
  checking: 'در حال بررسی سفارش و اطلاعات مالی…',
  validationUnavailable: 'اعتبارسنجی در دسترس نیست. دوباره تلاش کنید.',
  uncertain: 'این اقدام تأیید نشد. پیش از ویرایش، همان فرمان ثبت‌شده را دوباره ارسال کنید.',
  retryCaptured: 'ارسال دوباره اقدام کارشناس ثبت‌شده',
  missing: 'این سفارش در دسترس نیست.',
  backToOrder: 'بازگشت به سفارش صرفه‌جویی',
  actionUnavailable: 'این اقدام در وضعیت فعلی سفارش در دسترس نیست.',
  rejectionPrompt: 'توضیح دهید چه مشکلی مانع ادامه سفارش است.',
  rejectionNotice: 'پیش از تأیید، اثر رد سفارش بر صورتحساب و بازپرداخت را بررسی می‌کنید.',
  noteLimit: 'حداکثر ۱٬۰۰۰ نویسه.',
  noteVisible: 'مشتری این یادداشت را می‌بیند. حداکثر ۱٬۰۰۰ نویسه.',
  request_confirmationPrompt: 'مواردی را که با مشتری تأیید شده‌اند ثبت کنید.',
  product_deliveryPrompt: 'بنویسید چه اقلامی، چه زمانی و به چه کسی تحویل داده شدند.',
  installation_and_document_uploadPrompt: 'خلاصه نصب را بنویسید و مدارک ثبت‌شده را مشخص کنید.',
  equipment_handoverPrompt: 'نتیجه تحویل تجهیزات یا دلیل رد شدن از این مرحله را ثبت کنید.',
  process_completionPrompt: 'کارهای انجام‌شده و هر پیگیری باقی‌مانده برای مشتری را خلاصه کنید.',
};

export function tSavingOperations(key: string, locale: Locale = 'fa'): string {
  return (locale === 'fa' ? fa : en)[key] ?? key;
}
