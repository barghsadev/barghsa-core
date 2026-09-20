const en = {
  removalHistory:
    'This address will be removed from your saved list. Its record and addresses on existing orders will be retained.',
};
const fa: Record<keyof typeof en, string> = {
  removalHistory:
    'این آدرس از فهرست آدرس‌های ذخیره‌شده حذف می‌شود. سابقه آن و آدرس سفارش‌های قبلی حفظ خواهد شد.',
};

export function addressesText(key: keyof typeof en, locale: 'fa' | 'en'): string {
  return (locale === 'fa' ? fa : en)[key];
}
