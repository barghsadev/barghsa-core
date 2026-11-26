const en = {
  choosePropertyForm: 'Choose property type',
  chooseStructuralFrame: 'Choose structural frame',
  completionDateFormat: 'Use the Gregorian calendar.',
  completionDateCalendar: 'Choose the date from the calendar.',
  completionDateManual: 'Enter date manually',
  completionDatePicker: 'Use calendar',
  buildingAgeUnderOne: 'Under one year old',
  unitsFormat: 'Use a whole number from 1 to 100,000.',
  areaExample: 'Example in square metres: 250.5.',
  areaFormat: 'Use 0.01–1,000,000 m², with up to two decimal places.',
  chooseSiteCategory: 'Choose site type',
  chooseInstallationSurface: 'Choose surface',
  chooseSiteRelationship: 'Choose your role',
  chooseSavedAddress: 'Choose a saved address',
  savedAddressUnavailable: 'The site address in this draft is unavailable.',
  descriptionExample: 'Mention shading or access restrictions that could affect installation.',
  chooseGridType: 'Choose a connection type.',
  offGridOutage:
    'Power may be available during grid outages, depending on the final system design and installed storage equipment.',
  billFormat: 'Enter the 6–13-digit identifier printed on your electricity bill.',
  acceptedTerms: 'Accepted terms',
};

const fa: Record<keyof typeof en, string> = {
  choosePropertyForm: 'انتخاب نوع ساختمان',
  chooseStructuralFrame: 'انتخاب نوع اسکلت',
  completionDateFormat: 'تاریخ میلادی را وارد کنید.',
  completionDateCalendar: 'تاریخ را از تقویم شمسی انتخاب کنید.',
  completionDateManual: 'ورود تاریخ میلادی',
  completionDatePicker: 'تقویم شمسی',
  buildingAgeUnderOne: 'عمر بنا کمتر از یک سال',
  unitsFormat: 'عددی صحیح بین ۱ تا ۱۰۰٬۰۰۰ وارد کنید.',
  areaExample: 'مثال: ۲۵۰٫۵ متر مربع.',
  areaFormat: 'مساحت را بین ۰٫۰۱ تا ۱٬۰۰۰٬۰۰۰ متر مربع، با حداکثر دو رقم اعشار وارد کنید.',
  chooseSiteCategory: 'انتخاب نوع محل',
  chooseInstallationSurface: 'انتخاب محل نصب',
  chooseSiteRelationship: 'انتخاب نسبت با محل',
  chooseSavedAddress: 'یک نشانی ذخیره‌شده انتخاب کنید',
  savedAddressUnavailable: 'نشانی محل در این پیش‌نویس در دسترس نیست.',
  descriptionExample: 'سایه‌اندازی یا محدودیت دسترسی مؤثر بر نصب را شرح دهید.',
  chooseGridType: 'نوع اتصال را انتخاب کنید.',
  offGridOutage:
    'امکان استفاده از برق هنگام قطعی شبکه به طراحی نهایی سامانه و تجهیزات ذخیره‌سازی نصب‌شده بستگی دارد.',
  billFormat: 'شناسه ۶ تا ۱۳ رقمی درج‌شده روی قبض برق را وارد کنید.',
  acceptedTerms: 'شرایط پذیرفته‌شده',
};

export function solarIntakeText(key: keyof typeof en, locale: 'en' | 'fa'): string {
  return (locale === 'fa' ? fa : en)[key];
}
