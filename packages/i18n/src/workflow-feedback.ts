const messages = {
  en: {
    waiting: 'Waiting for Barghsa',
    responseUnknown: 'A response time is not available yet. Contact support to follow up.',
    submissionUnknown: 'Submission time is unavailable. Contact support to follow up.',
    submitted: 'Submitted',
  },
  fa: {
    waiting: 'در انتظار برقسا',
    responseUnknown: 'زمان پاسخ هنوز مشخص نیست. برای پیگیری با پشتیبانی تماس بگیرید.',
    submissionUnknown: 'زمان ثبت در دسترس نیست. برای پیگیری با پشتیبانی تماس بگیرید.',
    submitted: 'زمان ثبت',
  },
} as const;

export function workflowFeedback(key: keyof typeof messages.en, locale: 'en' | 'fa'): string {
  return messages[locale][key];
}
