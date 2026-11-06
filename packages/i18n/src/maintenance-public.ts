import { lookup } from './lookup.js';

export const enPublicMaintenance: Record<string, string> = {
  title: 'Service temporarily unavailable',
  description: 'New requests are paused while the team works on this service.',
  until: 'Estimated return',
  support: 'Contact support',
  back: 'Return to dashboard',
};

export const faPublicMaintenance: Record<string, string> = {
  title: 'این خدمت موقتاً در دسترس نیست',
  description: 'ثبت درخواست جدید تا پایان بررسی کارشناسان متوقف شده است.',
  until: 'زمان تخمینی بازگشت',
  support: 'تماس با پشتیبانی',
  back: 'بازگشت به داشبورد',
};

export function tPublicMaintenance(key: string, locale: 'fa' | 'en'): string {
  return lookup(locale === 'fa' ? faPublicMaintenance : enPublicMaintenance, key) ?? key;
}
