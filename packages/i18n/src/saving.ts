import { lookup } from './lookup.js';

const en: Record<string, string> = {
  title: 'Power-saving plans',
  introduction:
    'Explore plans, compatible equipment, and the agreement that applies to new orders.',
  loading: 'Loading saving plans…',
  error: 'Saving plans could not be loaded.',
  retry: 'Try again',
  empty: 'No saving plans are available yet.',
  available: 'Available',
  unavailable: 'Unavailable',
  planPrice: 'Plan price',
  equipment: 'Compatible equipment',
  equipmentPrice: 'Equipment price',
  agreement: 'Current agreement',
  noAgreement: 'An agreement has not been published yet.',
  unpriced: 'Price unavailable',
  inactive: 'Inactive',
};
const fa: Record<string, string> = {
  title: 'طرح‌های صرفه‌جویی برق',
  introduction: 'طرح‌ها، تجهیزات سازگار و توافق‌نامه مربوط به سفارش‌های جدید را بررسی کنید.',
  loading: 'در حال بارگذاری طرح‌های صرفه‌جویی…',
  error: 'بارگذاری طرح‌های صرفه‌جویی انجام نشد.',
  retry: 'دوباره تلاش کنید',
  empty: 'هنوز طرح صرفه‌جویی در دسترس نیست.',
  available: 'در دسترس',
  unavailable: 'در دسترس نیست',
  planPrice: 'قیمت طرح',
  equipment: 'تجهیزات سازگار',
  equipmentPrice: 'قیمت تجهیزات',
  agreement: 'توافق‌نامه جاری',
  noAgreement: 'هنوز توافق‌نامه‌ای منتشر نشده است.',
  unpriced: 'قیمت موجود نیست',
  inactive: 'غیرفعال',
};

export function tSaving(key: string, locale: 'fa' | 'en') {
  return lookup(locale === 'fa' ? fa : en, key) ?? key;
}
