const en = {
  title: 'Trusted devices',
  location: 'Approximate IP location',
  locationUnavailable: 'Unavailable',
  description:
    'Trust lasts up to 30 days after verification and applies to the recorded IP address. Staff verify each login.',
  refresh: 'Refresh',
  empty: 'No trusted devices.',
  loadError: 'Could not load trusted devices. Please try again.',
  revokeError: 'Trust removal was not confirmed. Please try again.',
  current: 'This device',
  remove: 'Remove trust',
  removed: 'Device trust removed.',
  confirm:
    'Remove trust for this device? Its next login will require a verification code. Existing sessions will stay signed in.',
  trustedAt: 'Trusted since',
  unknownIp: 'Unknown',
} as const;

const fa: Record<keyof typeof en, string> = {
  title: 'دستگاه‌های مورد اعتماد',
  location: 'موقعیت تقریبی IP',
  locationUnavailable: 'نامشخص',
  description:
    'اعتماد پس از تأیید کد، تا ۳۰ روز و برای آدرس IP ثبت‌شده معتبر است. کارکنان در هر ورود کد تأیید وارد می‌کنند.',
  refresh: 'تازه‌سازی',
  empty: 'دستگاه مورد اعتمادی ثبت نشده است.',
  loadError: 'بارگذاری دستگاه‌های مورد اعتماد انجام نشد. دوباره تلاش کنید.',
  revokeError: 'حذف اعتماد تأیید نشد. دوباره تلاش کنید.',
  current: 'این دستگاه',
  remove: 'حذف اعتماد',
  removed: 'اعتماد به دستگاه حذف شد.',
  confirm:
    'اعتماد به این دستگاه حذف شود؟ ورود بعدی به کد تأیید نیاز دارد. نشست‌های فعلی همچنان فعال می‌مانند.',
  trustedAt: 'زمان تأیید اعتماد',
  unknownIp: 'نامشخص',
};

export type TrustedDeviceTextKey = keyof typeof en;

export function trustedDeviceText(key: TrustedDeviceTextKey, locale: 'en' | 'fa'): string {
  return (locale === 'fa' ? fa : en)[key];
}
