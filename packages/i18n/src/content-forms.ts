const en = {
  versionId: 'Enter a version ID of 1–50 characters.',
  contentFa: 'Enter the Persian terms content.',
  contentEn: 'Enter the English terms content.',
  name: 'Enter a template name of 1–200 characters.',
  description: 'Keep the description within 2,000 characters.',
  status: 'Choose an active or inactive template status.',
  validationUnavailable: 'Validation could not load. Your text is preserved; try again.',
  invalid: 'Check the highlighted fields. Your text is preserved.',
  changed:
    'The saved template changed. Your text is preserved; reload and reset before continuing.',
  unverified: 'The saved result could not be verified. Reload and reset before continuing.',
  reset: 'Reset to saved content',
};
const fa: Record<keyof typeof en, string> = {
  versionId: 'شناسه نسخه را با ۱ تا ۵۰ نویسه وارد کنید.',
  contentFa: 'محتوای فارسی شرایط استفاده را وارد کنید.',
  contentEn: 'محتوای انگلیسی شرایط استفاده را وارد کنید.',
  name: 'نام قالب را با ۱ تا ۲۰۰ نویسه وارد کنید.',
  description: 'توضیحات باید حداکثر ۲۰۰۰ نویسه باشد.',
  status: 'وضعیت فعال یا غیرفعال قالب را انتخاب کنید.',
  validationUnavailable: 'اعتبارسنجی بارگذاری نشد. متن شما حفظ شده است؛ دوباره تلاش کنید.',
  invalid: 'فیلدهای مشخص‌شده را بررسی کنید. متن شما حفظ شده است.',
  changed:
    'قالب ذخیره‌شده تغییر کرده است. متن شما حفظ شده است؛ برای ادامه بازخوانی و بازنشانی کنید.',
  unverified: 'نتیجه ذخیره تأیید نشد. برای ادامه بازخوانی و بازنشانی کنید.',
  reset: 'بازنشانی به محتوای ذخیره‌شده',
};
export const contentFormText = (key: keyof typeof en, locale: 'fa' | 'en') =>
  (locale === 'fa' ? fa : en)[key];
