const en = {
  streetExample: 'Street, building number, floor and unit',
  postalCodeFormat: 'Enter 10 digits, starting with a digit from 1 to 9.',
  provinceFirst: 'Select a province first',
  loadingCities: 'Loading cities…',
  clearProvince: 'Clear province',
  clearCity: 'Clear city',
};
const fa: Record<keyof typeof en, string> = {
  streetExample: 'خیابان، پلاک، طبقه و واحد',
  postalCodeFormat: 'کد پستی باید ۱۰ رقمی باشد و با صفر شروع نشود.',
  provinceFirst: 'ابتدا استان را انتخاب کنید',
  loadingCities: 'در حال دریافت شهرها…',
  clearProvince: 'پاک کردن استان',
  clearCity: 'پاک کردن شهر',
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
