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
  cleanupLoading: 'Loading the incomplete upload cleanup policy…',
  cleanupLoadError: 'The incomplete upload cleanup policy could not be loaded.',
  cleanupInvalidPolicy:
    'Cleanup is paused because the saved age is invalid. Enter and save a valid age to resume cleanup.',
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
  cleanupLoading: 'در حال دریافت سیاست پاک‌سازی بارگذاری‌های ناتمام…',
  cleanupLoadError: 'دریافت سیاست پاک‌سازی بارگذاری‌های ناتمام انجام نشد.',
  cleanupInvalidPolicy:
    'پاک‌سازی متوقف شده است چون مدت ذخیره‌شده نامعتبر است. برای ادامه، مدت معتبری وارد و ذخیره کنید.',
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

const recoveryEn = {
  recoveryTitle: 'Restore storage settings',
  recoveryLoading: 'Loading previous storage versions…',
  recoveryReadError: 'Storage recovery history could not be loaded.',
  recoveryEmpty: 'No earlier storage settings are available to restore.',
  recoveryRevision: 'Version {version}',
  recoveryDraft: 'Recovery draft from version {version}',
  recoveryStage: 'Review version {version}',
  recoveryStageConfirm:
    'Prepare a draft of these connection settings. Live storage and credentials stay as they are.',
  recoveryActivate: 'Activate recovery draft',
  recoveryActivateConfirm:
    'Test the connection with the current credentials and activate these settings as a new version.',
  recoveryConflict: 'The active version or draft changed. Reload the recovery history.',
  recoveryLatest: 'Newer versions',
  recoveryOlder: 'Older versions',
  recoveryEndpoint: 'This revision uses an endpoint that is no longer approved.',
  recoveryReentry:
    'To change these locations, enter the settings and re-enter the secret in the storage form. Existing objects can prevent a location change.',
  recoveryLocationInUse: 'Existing storage objects prevent a location change.',
  recoveryOn: 'On',
  recoveryOff: 'Off',
};
const recoveryFa: Record<keyof typeof recoveryEn, string> = {
  recoveryTitle: 'بازیابی تنظیمات ذخیره‌سازی',
  recoveryLoading: 'در حال دریافت نسخه‌های پیشین ذخیره‌سازی…',
  recoveryReadError: 'دریافت سابقهٔ بازیابی ذخیره‌سازی انجام نشد.',
  recoveryEmpty: 'تنظیمات پیشینی برای بازیابی در دسترس نیست.',
  recoveryRevision: 'نسخهٔ {version}',
  recoveryDraft: 'پیش‌نویس بازیابی نسخهٔ {version}',
  recoveryStage: 'بررسی نسخهٔ {version}',
  recoveryStageConfirm:
    'از این تنظیمات اتصال پیش‌نویس بسازید. تنظیمات فعال و اطلاعات ورود فعلاً برقرار می‌مانند.',
  recoveryActivate: 'فعال‌سازی پیش‌نویس بازیابی',
  recoveryActivateConfirm:
    'اتصال با اطلاعات ورود فعلی آزموده می‌شود و این تنظیمات به‌عنوان نسخهٔ جدید فعال می‌شوند.',
  recoveryConflict: 'نسخهٔ فعال یا پیش‌نویس تغییر کرده است. سابقه را دوباره دریافت کنید.',
  recoveryLatest: 'نسخه‌های جدیدتر',
  recoveryOlder: 'نسخه‌های قدیمی‌تر',
  recoveryEndpoint: 'مبدأ اتصال این نسخه دیگر مجاز نیست.',
  recoveryReentry:
    'برای تغییر این محل‌ها، تنظیمات و کلید محرمانه را در فرم ذخیره‌سازی دوباره وارد کنید. وجود فایل می‌تواند مانع تغییر محل شود.',
  recoveryLocationInUse: 'وجود فایل‌های ذخیره‌شده مانع تغییر محل می‌شود.',
  recoveryOn: 'روشن',
  recoveryOff: 'خاموش',
};
export function storageRecoveryText(key: string, locale: 'fa' | 'en'): string | undefined {
  if (!Object.hasOwn(recoveryEn, key)) return undefined;
  return (locale === 'fa' ? recoveryFa : recoveryEn)[key as keyof typeof recoveryEn];
}
