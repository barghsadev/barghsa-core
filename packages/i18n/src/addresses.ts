const en = {
  removalHistory:
    'This address will be removed from your saved list. Its record and addresses on existing orders will be retained.',
  profileRequired: 'Choose an active profile',
  profileRequiredHint: 'Open the dashboard to choose a profile before managing its addresses.',
  openDashboard: 'Open dashboard',
};
const fa: Record<keyof typeof en, string> = {
  removalHistory:
    'این آدرس از فهرست آدرس‌های ذخیره‌شده حذف می‌شود. سابقه آن و آدرس سفارش‌های قبلی حفظ خواهد شد.',
  profileRequired: 'یک پروفایل فعال انتخاب کنید',
  profileRequiredHint: 'برای مدیریت آدرس‌ها، در داشبورد یک پروفایل انتخاب کنید.',
  openDashboard: 'باز کردن داشبورد',
};

export function addressesText(key: keyof typeof en, locale: 'fa' | 'en'): string {
  return (locale === 'fa' ? fa : en)[key];
}
