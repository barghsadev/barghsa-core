const messages = {
  en: {
    confirm: 'Confirm',
    cancel: 'Cancel',
    phrase: 'CONFIRM',
    typePhrase: 'Type CONFIRM to authorize this action.',
    acknowledge:
      'I understand the reviewed amounts, consequences and applicable cancellation/refund rules.',
    toman: 'toman',
    recorded: 'Update recorded',
    checkStatus: 'Check current status',
    unconfirmed: 'The outcome is unconfirmed. Check the current status before trying again.',
  },
  fa: {
    confirm: 'تأیید',
    cancel: 'انصراف',
    phrase: 'تأیید',
    typePhrase: 'برای اجازه انجام این اقدام، عبارت «تأیید» را وارد کنید.',
    acknowledge: 'مبالغ بررسی‌شده، پیامدها و قوانین مربوط به لغو و بازپرداخت را درک می‌کنم.',
    toman: 'تومان',
    recorded: 'به‌روزرسانی ثبت شد',
    checkStatus: 'بررسی وضعیت فعلی',
    unconfirmed: 'نتیجه هنوز تأیید نشده است. پیش از تلاش دوباره وضعیت فعلی را بررسی کنید.',
  },
} as const;

export function confirmationText(key: keyof typeof messages.en, locale: 'fa' | 'en'): string {
  return messages[locale][key];
}

export const stepUpMessages = {
  en: {
    'admin.stepUp.code': 'Six-digit verification code',
    'admin.stepUp.denied': 'Your session access has changed. Reload the page.',
    'admin.stepUp.expired': 'The code has expired. Request a new code.',
    'admin.stepUp.help':
      'We will send a one-time code to your registered contact. Verification continues this action.',
    'admin.stepUp.invalid': 'The code was not verified. Check it or request a new code.',
    'admin.stepUp.rateLimited': 'Too many requests. Please wait.',
    'admin.stepUp.required': 'Sensitive action requires re-authentication.',
    'admin.stepUp.resend': 'Send a new code',
    'admin.stepUp.retryAfter': 'Try again in {seconds} seconds.',
    'admin.stepUp.send': 'Send verification code',
    'admin.stepUp.sendFailed': 'The code could not be sent. Try again.',
    'admin.stepUp.sentEmail': 'A code was sent to your registered email.',
    'admin.stepUp.sentSms': 'A code was sent to your registered mobile number.',
    'admin.stepUp.unavailable': 'Verification is unavailable. Try again.',
    'admin.stepUp.verify': 'Verify code and continue',
    'admin.stepUp.working': 'Verifying…',
  },
  fa: {
    'admin.stepUp.code': 'کد تأیید شش‌رقمی',
    'admin.stepUp.denied': 'دسترسی این نشست تغییر کرده است. صفحه را دوباره بارگذاری کنید.',
    'admin.stepUp.expired': 'اعتبار کد تمام شده است. کد جدید بگیرید.',
    'admin.stepUp.help':
      'کد یک‌بارمصرف را به راه ارتباطی ثبت‌شده شما می‌فرستیم. پس از تأیید، همین اقدام انجام می‌شود.',
    'admin.stepUp.invalid': 'کد تأیید نشد. کد را بررسی کنید یا کد جدید بگیرید.',
    'admin.stepUp.rateLimited': 'درخواست‌ها بیش از حد مجاز است. کمی صبر کنید.',
    'admin.stepUp.required': 'این اقدام حساس نیاز به تأیید دوباره هویت دارد.',
    'admin.stepUp.resend': 'ارسال کد جدید',
    'admin.stepUp.retryAfter': 'پس از {seconds} ثانیه دوباره تلاش کنید.',
    'admin.stepUp.send': 'ارسال کد تأیید',
    'admin.stepUp.sendFailed': 'کد ارسال نشد. دوباره تلاش کنید.',
    'admin.stepUp.sentEmail': 'کد به ایمیل ثبت‌شده شما ارسال شد.',
    'admin.stepUp.sentSms': 'کد به شماره همراه ثبت‌شده شما ارسال شد.',
    'admin.stepUp.unavailable': 'تأیید هویت در دسترس نیست. دوباره تلاش کنید.',
    'admin.stepUp.verify': 'تأیید کد و ادامه',
    'admin.stepUp.working': 'در حال بررسی…',
  },
} as const;

type StepUpKey = keyof typeof stepUpMessages.en extends `admin.stepUp.${infer Key}` ? Key : never;

export function stepUpText(key: StepUpKey, locale: 'fa' | 'en'): string {
  return stepUpMessages[locale][`admin.stepUp.${key}`];
}
