import { lookup } from './lookup.js';
import { t } from './recovery.js';
import type { I18nDictionary, Locale } from './index.js';

const fa: I18nDictionary = {
  'auth.recovery.customerProfile': 'پروفایل مشتری',
  'auth.recovery.searchProfile': 'جست‌وجوی پروفایل',
  'auth.recovery.findProfile': 'جست‌وجو',
  'auth.recovery.profileSearchHelp': 'نام مشتری یا ایمیل یا موبایل ورود فعلی را وارد کنید.',
  'auth.recovery.profileSearchDenied':
    'جست‌وجوی پروفایل برای این حساب در دسترس نیست. می‌توانید شناسه را وارد کنید.',
  'auth.recovery.profileSearchFailed': 'پروفایل‌ها بارگیری نشدند. دوباره جست‌وجو کنید.',
  'auth.recovery.profileResults': 'پروفایل‌های پیدا شده',
  'auth.recovery.noProfiles': 'پروفایلی پیدا نشد.',
  'auth.recovery.refineProfileSearch':
    'برای یافتن پروفایل مورد نظر، عبارت جست‌وجو را دقیق‌تر کنید.',
  'auth.recovery.chooseProfile': 'یک پروفایل انتخاب کنید یا شناسه آن را وارد کنید.',
  'auth.recovery.enterProfileId': 'ورود با شناسه پروفایل',
  'auth.recovery.invalidProfileId': 'شناسه معتبر پروفایل را وارد کنید.',
  'auth.recovery.selectedProfile': 'پروفایل انتخاب‌شده',
  'auth.recovery.changeProfile': 'تغییر پروفایل',
  'auth.recovery.individualProfile': 'حقیقی',
  'auth.recovery.legalProfile': 'حقوقی',
  'auth.recovery.newLoginHelp': 'مثلاً name@example.com یا ۰۹۱۲۱۲۳۴۵۶۷.',
  'auth.recovery.invalidNewLogin': 'ایمیل یا شماره موبایل معتبر وارد کنید.',
  'auth.recovery.supportReferenceHelp': 'شماره تیکت یا مرجع پیگیری درخواست مشتری.',
  'auth.recovery.staffReviewNext':
    'بازبین مستقل مدارک را بررسی می‌کند. سپس مشتری تماس جدید را تأیید می‌کند.',
  'auth.recovery.backToRecoveryCase': 'بازگشت به پرونده',
  'auth.recovery.reviewCaseAction': 'بررسی هویت و تماس',
  'auth.recovery.reviewNotesTitle': 'ثبت یافته‌های بازبین',
  'auth.recovery.reviewUnavailable': 'در وضعیت فعلی امکان ثبت تصمیم بازبینی وجود ندارد.',
  'auth.recovery.recordReceiptsAction': 'ثبت رسیدهای اطلاع‌رسانی',
  'auth.recovery.completeCaseAction': 'تکمیل پرونده بازیابی',
  'auth.recovery.receiptsUnavailable': 'رسیدها پس از اجرای بازیابی ثبت می‌شوند.',
};

const en: I18nDictionary = {
  'auth.recovery.customerProfile': 'Customer profile',
  'auth.recovery.searchProfile': 'Search profiles',
  'auth.recovery.findProfile': 'Search',
  'auth.recovery.profileSearchHelp':
    'Enter the customer’s name or current login email or mobile number.',
  'auth.recovery.profileSearchDenied':
    'Profile search is unavailable for this account. You can enter the profile ID.',
  'auth.recovery.profileSearchFailed': 'Profiles could not be loaded. Search again to retry.',
  'auth.recovery.profileResults': 'Matching profiles',
  'auth.recovery.noProfiles': 'No matching profiles.',
  'auth.recovery.refineProfileSearch': 'Refine your search to find the profile.',
  'auth.recovery.chooseProfile': 'Select a profile or enter its ID.',
  'auth.recovery.enterProfileId': 'Enter a profile ID',
  'auth.recovery.invalidProfileId': 'Enter a valid profile ID.',
  'auth.recovery.selectedProfile': 'Selected profile',
  'auth.recovery.changeProfile': 'Change profile',
  'auth.recovery.individualProfile': 'Individual',
  'auth.recovery.legalProfile': 'Company',
  'auth.recovery.newLoginHelp': 'For example, name@example.com or +989121234567.',
  'auth.recovery.invalidNewLogin': 'Enter a valid email address or mobile number.',
  'auth.recovery.supportReferenceHelp':
    'Use the ticket number or support reference for this request.',
  'auth.recovery.staffReviewNext':
    'An independent reviewer checks the evidence before the customer verifies the new contact.',
  'auth.recovery.backToRecoveryCase': 'Back to recovery case',
  'auth.recovery.reviewCaseAction': 'Review identity and contact',
  'auth.recovery.reviewNotesTitle': 'Record your findings',
  'auth.recovery.reviewUnavailable': 'The current case status does not allow a review decision.',
  'auth.recovery.recordReceiptsAction': 'Record notice receipts',
  'auth.recovery.completeCaseAction': 'Complete recovery case',
  'auth.recovery.receiptsUnavailable': 'Notice receipts are recorded after recovery is applied.',
};

export function staffRecoveryText(key: string, locale: Locale = 'fa'): string {
  return lookup(locale === 'fa' ? fa : en, key) ?? t(key, locale);
}
