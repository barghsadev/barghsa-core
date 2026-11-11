import { lookup } from './lookup.js';

// Persisted as the safe public notice when the operator keeps the rationale private.
export const standardMaintenanceNotice = {
  fa: 'ثبت درخواست جدید تا پایان بررسی کارشناسان متوقف شده است.',
  en: 'New requests are paused while the team works on this service.',
} as const;

export function isStandardMaintenanceNotice(reason: { fa: string; en: string } | null): boolean {
  return reason?.fa === standardMaintenanceNotice.fa && reason.en === standardMaintenanceNotice.en;
}

export const enPublicMaintenance: Record<string, string> = {
  title: 'Service temporarily unavailable',
  description: standardMaintenanceNotice.en,
  until: 'Estimated return',
  support: 'Contact support',
  back: 'Return to dashboard',
};

export const faPublicMaintenance: Record<string, string> = {
  title: 'این خدمت موقتاً در دسترس نیست',
  description: standardMaintenanceNotice.fa,
  until: 'زمان تخمینی بازگشت',
  support: 'تماس با پشتیبانی',
  back: 'بازگشت به داشبورد',
};

export function tPublicMaintenance(key: string, locale: 'fa' | 'en'): string {
  return lookup(locale === 'fa' ? faPublicMaintenance : enPublicMaintenance, key) ?? key;
}
