import type { Locale } from './app.js';

const fa = {
  reasonHelp: 'دلیل تصمیم را برای سابقه سفارش در ۱ تا ۱٬۰۰۰ نویسه توضیح دهید.',
  reasonExample: 'مثلاً مشتری درخواست کرده پیش‌نویس بسته شود.',
  dismissDecision: 'بستن فرم تصمیم',
  financialReview: 'بررسی مالی',
  noWalletReturn: 'بازگشت وجهی برای این تصمیم ثبت نمی‌شود.',
  approvalRecorded: 'تأیید دوم ثبت شده است.',
  recoveryHelp: 'ابتدا وضعیت فعلی سفارش و بازپرداخت را دوباره بررسی کنید.',
};

const en = {
  reasonHelp: 'Explain the decision for the order record in 1–1,000 characters.',
  reasonExample: 'For example, the customer asked to close this draft.',
  dismissDecision: 'Close decision form',
  financialReview: 'Financial review',
  noWalletReturn: 'No wallet return is due for this decision.',
  approvalRecorded: 'Second approval is recorded.',
  recoveryHelp: 'Check the current order and refund status before confirming again.',
};

export function electricityDraftDecisionText(key: keyof typeof en, locale: Locale): string {
  return (locale === 'fa' ? fa : en)[key];
}
