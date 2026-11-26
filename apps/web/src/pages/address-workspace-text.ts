const en = {
  removalHistory:
    'This address will be removed from your saved list. Its record and addresses on existing orders will be retained.',
  profileRequired: 'Choose an active profile',
  profileRequiredHint: 'Open the dashboard to choose a profile before managing its addresses.',
  openDashboard: 'Open dashboard',
  details: 'Address details',
  province: 'Search or choose a province',
  city: 'Search or choose a city',
  noMatch: 'No matching locations',
};

const fa: Record<keyof typeof en, string> = {
  removalHistory:
    'این آدرس از فهرست آدرس‌های ذخیره‌شده حذف می‌شود. سابقه آن و آدرس سفارش‌های قبلی حفظ خواهد شد.',
  profileRequired: 'یک پروفایل فعال انتخاب کنید',
  profileRequiredHint: 'برای مدیریت آدرس‌ها، در داشبورد یک پروفایل انتخاب کنید.',
  openDashboard: 'باز کردن داشبورد',
  details: 'جزئیات آدرس',
  province: 'جستجو یا انتخاب استان',
  city: 'جستجو یا انتخاب شهر',
  noMatch: 'موردی پیدا نشد',
};

export function addressWorkspaceText(key: keyof typeof en, locale: 'fa' | 'en') {
  return (locale === 'fa' ? fa : en)[key];
}
