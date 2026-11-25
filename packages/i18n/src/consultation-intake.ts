const briefCopy = {
  en: {
    label: 'What would you like help with? (optional)',
    submittedBrief: 'Your description',
    help: 'Share your goal and one detail that matters, up to 2,000 characters.',
    example: 'Example: Cut power costs at our workshop.',
    afterSubmission:
      'Staff review your request and send a fee offer for you to accept before paying.',
    invalid: 'Enter up to 2,000 characters.',
    check: 'Check submission',
    checkHelp: 'Check whether your request was recorded so you can open it or finish sending it.',
    reenter: 'No receipt was found. Re-enter the description or leave it blank, then submit again.',
  },
  fa: {
    label: 'در چه زمینه‌ای به مشاوره نیاز دارید؟ (اختیاری)',
    submittedBrief: 'توضیحات شما',
    help: 'هدف خود و یک نکته مرتبط را تا ۲٬۰۰۰ نویسه وارد کنید.',
    example: 'مثال: چطور هزینه برق کارگاه را کم کنیم؟',
    afterSubmission:
      'کارشناس درخواست را بررسی می‌کند. پرداخت پس از پذیرش پیشنهاد هزینه انجام می‌شود.',
    invalid: 'حداکثر ۲٬۰۰۰ نویسه وارد کنید.',
    check: 'بررسی ثبت درخواست',
    checkHelp: 'وضعیت ثبت درخواست را بررسی کنید تا بتوانید آن را باز کنید یا ارسال را کامل کنید.',
    reenter:
      'رسید ثبت درخواست پیدا نشد. توضیحات را دوباره وارد کنید یا خالی بگذارید و دوباره ارسال کنید.',
  },
} as const;

export function tConsultationBrief(key: keyof typeof briefCopy.en, locale: 'en' | 'fa') {
  return briefCopy[locale][key];
}
