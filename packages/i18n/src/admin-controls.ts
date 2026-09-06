const en = {
  dismissError: 'Dismiss error',
  provinceSearch: 'Search provinces',
  statusFilter: 'Filter by status',
} as const;

const fa: Record<keyof typeof en, string> = {
  dismissError: 'بستن پیام خطا',
  provinceSearch: 'جستجوی استان‌ها',
  statusFilter: 'فیلتر وضعیت',
};

export function adminControlsText(key: keyof typeof en, locale: 'en' | 'fa'): string {
  return (locale === 'fa' ? fa : en)[key];
}
