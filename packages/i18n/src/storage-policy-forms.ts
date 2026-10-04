const en = {
  endpoint: 'Use an HTTP(S) origin without credentials, a path or query.',
  region: 'Enter a region of 1–128 characters.',
  bucket: 'Enter a bucket name of 1–255 characters.',
  accessKeyId: 'Use an access key of at most 256 characters with a matching secret, or clear both.',
  secretAccessKey:
    'Use a matching secret of at most 4,096 characters. Re-enter it when changing the storage location.',
  forcePathStyle: 'Choose the storage path style.',
  privateEndpointUrl: 'Use an HTTP(S) origin without credentials, a path or query.',
  publicEndpointUrl: 'Use an HTTP(S) origin without credentials, a path or query.',
  clearSecret: 'Choose whether to clear the saved secret.',
  hours: 'Enter a whole number of hours from 1 to 168.',
  extensions: 'Select at least one deployment-permitted format.',
  size: 'Enter a size within the deployment limit that equals a whole number of bytes.',
  unavailable: 'Validation could not load. Your entries are preserved; try again.',
  invalid: 'Check the highlighted fields. Your entries are preserved.',
  changed: 'The saved settings changed. Your entries are preserved; reset before continuing.',
  unverified: 'The saved result could not be verified. Reload and reset before continuing.',
  reset: 'Reset to saved settings',
};
const fa: Record<keyof typeof en, string> = {
  endpoint: 'مبدأ HTTP یا HTTPS را بدون اطلاعات ورود، مسیر یا پارامتر وارد کنید.',
  region: 'منطقه را با ۱ تا ۱۲۸ نویسه وارد کنید.',
  bucket: 'نام باکت را با ۱ تا ۲۵۵ نویسه وارد کنید.',
  accessKeyId:
    'کلید دسترسی حداکثر ۲۵۶ نویسه و کلید محرمانه متناظر را وارد کنید، یا هر دو را پاک کنید.',
  secretAccessKey:
    'کلید محرمانه متناظر با حداکثر ۴۰۹۶ نویسه وارد کنید. هنگام تغییر محل ذخیره‌سازی آن را دوباره وارد کنید.',
  forcePathStyle: 'سبک مسیر ذخیره‌سازی را انتخاب کنید.',
  privateEndpointUrl: 'مبدأ HTTP یا HTTPS را بدون اطلاعات ورود، مسیر یا پارامتر وارد کنید.',
  publicEndpointUrl: 'مبدأ HTTP یا HTTPS را بدون اطلاعات ورود، مسیر یا پارامتر وارد کنید.',
  clearSecret: 'وضعیت پاک کردن کلید محرمانه ذخیره‌شده را انتخاب کنید.',
  hours: 'تعداد ساعت را به‌صورت عدد صحیح بین ۱ تا ۱۶۸ وارد کنید.',
  extensions: 'حداقل یک قالب مجاز در استقرار را انتخاب کنید.',
  size: 'اندازه‌ای در محدوده استقرار و معادل تعداد صحیح بایت وارد کنید.',
  unavailable: 'اعتبارسنجی بارگذاری نشد. ورودی‌های شما حفظ شده است؛ دوباره تلاش کنید.',
  invalid: 'فیلدهای مشخص‌شده را بررسی کنید. ورودی‌های شما حفظ شده است.',
  changed:
    'تنظیمات ذخیره‌شده تغییر کرده است. ورودی‌های شما حفظ شده است؛ پیش از ادامه بازنشانی کنید.',
  unverified: 'نتیجه ذخیره تأیید نشد. برای ادامه بازخوانی و بازنشانی کنید.',
  reset: 'بازنشانی به تنظیمات ذخیره‌شده',
};
export const storagePolicyFormText = (key: keyof typeof en, locale: 'fa' | 'en') =>
  (locale === 'fa' ? fa : en)[key];
