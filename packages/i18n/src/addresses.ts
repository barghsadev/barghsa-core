const en = {
  removalHistory:
    'This address will be removed from your saved list. Its record and addresses on existing orders will be retained.',
  profileRequired: 'Choose an active profile',
  profileRequiredHint: 'Open the dashboard to choose a profile before managing its addresses.',
  openDashboard: 'Open dashboard',
  details: 'Address details',
  streetExample: 'Street, building number, floor and unit',
  postalCodeFormat: 'Enter 10 digits, starting with a digit from 1 to 9.',
  provinceFirst: 'Select a province first',
  loadingCities: 'Loading cities…',
};
const fa: Record<keyof typeof en, string> = {
  removalHistory:
    'این آدرس از فهرست آدرس‌های ذخیره‌شده حذف می‌شود. سابقه آن و آدرس سفارش‌های قبلی حفظ خواهد شد.',
  profileRequired: 'یک پروفایل فعال انتخاب کنید',
  profileRequiredHint: 'برای مدیریت آدرس‌ها، در داشبورد یک پروفایل انتخاب کنید.',
  openDashboard: 'باز کردن داشبورد',
  details: 'جزئیات آدرس',
  streetExample: 'خیابان، پلاک، طبقه و واحد',
  postalCodeFormat: 'کد پستی باید ۱۰ رقمی باشد و با صفر شروع نشود.',
  provinceFirst: 'ابتدا استان را انتخاب کنید',
  loadingCities: 'در حال دریافت شهرها…',
};

export function addressesText(key: keyof typeof en, locale: 'fa' | 'en'): string {
  return (locale === 'fa' ? fa : en)[key];
}

const addressFieldsEn = {
  'settings.addresses.form.province': 'Province',
  'settings.addresses.form.provincePlaceholder': 'Select province',
  'settings.addresses.form.city': 'City',
  'settings.addresses.form.cityPlaceholder': 'Select city',
  'settings.addresses.form.fullAddress': 'Full Address',
  'settings.addresses.form.fullAddressPlaceholder': 'Enter your full address',
  'settings.addresses.form.postalCode': 'Postal Code',
  'settings.addresses.form.postalCodePlaceholder': '10-digit postal code',
  'settings.addresses.form.saving': 'Saving…',
  'settings.addresses.success.create': 'Address added successfully',
  'settings.addresses.error.create': 'Failed to add address',
};
const addressFieldsFa: Record<keyof typeof addressFieldsEn, string> = {
  'settings.addresses.form.province': 'استان',
  'settings.addresses.form.provincePlaceholder': 'استان را انتخاب کنید',
  'settings.addresses.form.city': 'شهر',
  'settings.addresses.form.cityPlaceholder': 'شهر را انتخاب کنید',
  'settings.addresses.form.fullAddress': 'آدرس کامل',
  'settings.addresses.form.fullAddressPlaceholder': 'آدرس خود را وارد کنید',
  'settings.addresses.form.postalCode': 'کد پستی',
  'settings.addresses.form.postalCodePlaceholder': 'کد پستی ۱۰ رقمی',
  'settings.addresses.form.saving': 'در حال ذخیره…',
  'settings.addresses.success.create': 'آدرس با موفقیت اضافه شد',
  'settings.addresses.error.create': 'خطا در افزودن آدرس',
};

export const addressFormMessages = { en: addressFieldsEn, fa: addressFieldsFa };

export function addressFormText(key: keyof typeof addressFieldsEn, locale: 'fa' | 'en'): string {
  return addressFormMessages[locale][key];
}
