import { lookup } from './lookup.js';
import { tWorkspace } from './workspace-crm.js';
import type { I18nDictionary, Locale } from './app.js';

const fa: I18nDictionary = {
  'crm.legal.formSections': 'بخش‌های اطلاعات حقوقی',
  'crm.legal.registrationDetails': 'ثبت شرکت',
  'crm.legal.companyContact': 'تماس و نشانی شرکت',
  'crm.legal.representativeDetails': 'مشخصات نماینده',
  'crm.legal.representativeAddress': 'نشانی نماینده',
  'crm.address.locationDetails': 'استان و شهر',
  'crm.address.postalDetails': 'نشانی و کد پستی',
  'crm.address.fullExample': 'خیابان، کوچه، پلاک و واحد را وارد کنید.',
  'crm.corrections.changeDetails': 'اطلاعات مورد اصلاح',
  'crm.corrections.attachments': 'مدارک پشتیبان',
  'crm.evidence.changeFiles': 'تغییر انتخاب مدارک',
  'crm.evidence.selectedFiles': 'مدارک انتخاب‌شده',
  'crm.evidence.removeFile': 'حذف مدرک {name}',
  'crm.evidence.checkFile': 'این فایل را بررسی کنید',
  'crm.corrections.reasonExample': 'مثلاً اشتباه تایپی در پروفایل.',
  'crm.corrections.reviewDecision': 'تصمیم بازبین',
  'crm.corrections.decision': 'تصمیم',
  'crm.corrections.caseDetails': 'جزئیات درخواست',
  'crm.corrections.reviewUnavailable': 'در وضعیت فعلی یا با سطح دسترسی شما امکان ثبت تصمیم نیست.',
  'crm.corrections.decision.Under Review': 'شروع بررسی',
  'crm.corrections.decision.Approved': 'تأیید اصلاح',
  'crm.corrections.decision.Rejected': 'رد درخواست',
  'crm.corrections.decisionHelp.Under Review': 'درخواست را وارد مرحله بررسی کنید.',
  'crm.corrections.decisionHelp.Approved': 'مقدار درخواستی را در پروفایل ثبت کنید.',
  'crm.corrections.decisionHelp.Rejected': 'مقدار فعلی حفظ می‌شود.',
  'crm.corrections.optionalNote': 'یادداشت بازبین (اختیاری)',
  'crm.corrections.rejectionNote': 'دلیل رد درخواست',
  'crm.corrections.rejectionExample': 'مثلاً نام مندرج در مدرک با مقدار درخواستی متفاوت است.',
  'crm.corrections.noteExample': 'نتیجه بررسی مدارک و دلیل تصمیم را ثبت کنید.',
  'crm.profile.edit.contactDetails': 'نام نمایشی و اطلاعات تماس',
  'crm.profile.action.back': 'بازگشت به پروفایل',
  'crm.profile.action.account': 'حساب کاربری',
  'crm.profile.action.reason': 'دلیل اقدام',
  'crm.profile.action.review': 'مرور پیش از تأیید',
  'crm.profile.action.archiveChecks': 'تأیید اثرهای بایگانی',
  'crm.profile.action.archive.effect':
    'پروفایل از دسترس مشتری خارج می‌شود. سوابق کاری باز یا محدودیت مالکیت ممکن است مانع بایگانی شوند.',
  'crm.profile.action.archive.example': 'مثلاً مشتری درخواست بسته شدن این پروفایل را داده است.',
  'crm.profile.action.force-password-change.effect':
    'همه نشست‌های فعال پایان می‌یابند و مشتری در ورود بعدی باید رمز عبور خود را تغییر دهد.',
  'crm.profile.action.force-password-change.example':
    'مثلاً مشتری افشای رمز عبور را گزارش کرده است.',
  'crm.profile.action.expire-sessions.effect':
    'همه نشست‌های فعال پایان می‌یابند و مشتری باید دوباره وارد حساب شود.',
  'crm.profile.action.expire-sessions.example': 'مثلاً مشتری گم شدن دستگاهی را گزارش کرده است.',
};

const en: I18nDictionary = {
  'crm.legal.formSections': 'Legal form sections',
  'crm.legal.registrationDetails': 'Company registration',
  'crm.legal.companyContact': 'Company contact and address',
  'crm.legal.representativeDetails': 'Representative details',
  'crm.legal.representativeAddress': 'Representative address details',
  'crm.address.locationDetails': 'Province and city',
  'crm.address.postalDetails': 'Street address and postal code',
  'crm.address.fullExample': 'Include the street, building number, and unit.',
  'crm.corrections.changeDetails': 'Requested identity change',
  'crm.corrections.attachments': 'Supporting evidence',
  'crm.evidence.changeFiles': 'Change evidence selection',
  'crm.evidence.selectedFiles': 'Selected evidence',
  'crm.evidence.removeFile': 'Remove evidence {name}',
  'crm.evidence.checkFile': 'Check this file',
  'crm.corrections.reasonExample': 'For example, a typo in the profile.',
  'crm.corrections.reviewDecision': 'Review decision',
  'crm.corrections.decision': 'Decision',
  'crm.corrections.caseDetails': 'Case details',
  'crm.corrections.reviewUnavailable':
    'A decision is unavailable for this case status or your permissions.',
  'crm.corrections.decision.Under Review': 'Start review',
  'crm.corrections.decision.Approved': 'Approve correction',
  'crm.corrections.decision.Rejected': 'Reject request',
  'crm.corrections.decisionHelp.Under Review': 'Move the request to review.',
  'crm.corrections.decisionHelp.Approved': 'Save the requested value on the profile.',
  'crm.corrections.decisionHelp.Rejected': 'Keep the current value.',
  'crm.corrections.optionalNote': 'Reviewer note (optional)',
  'crm.corrections.rejectionNote': 'Reason for rejection',
  'crm.corrections.rejectionExample':
    'For example, the name on the evidence differs from the requested value.',
  'crm.corrections.noteExample': 'Record what the evidence shows and why you chose this decision.',
  'crm.profile.edit.contactDetails': 'Display name and contact details',
  'crm.profile.action.back': 'Back to profile',
  'crm.profile.action.account': 'Customer account',
  'crm.profile.action.reason': 'Reason for action',
  'crm.profile.action.review': 'Review action',
  'crm.profile.action.archiveChecks': 'Confirm what archiving does',
  'crm.profile.action.archive.effect':
    'The customer will lose access to this profile. Open business records or ownership restrictions may prevent archiving.',
  'crm.profile.action.archive.example': 'For example, the customer asked to close this profile.',
  'crm.profile.action.force-password-change.effect':
    'All active sessions will end. The customer must change their password the next time they sign in.',
  'crm.profile.action.force-password-change.example':
    'For example, the customer reported that their password was exposed.',
  'crm.profile.action.expire-sessions.effect':
    'All active sessions will end. The customer will need to sign in again.',
  'crm.profile.action.expire-sessions.example': 'For example, the customer reported a lost device.',
};

export function tCrmForm(key: string, locale: Locale = 'fa'): string {
  return lookup(locale === 'fa' ? fa : en, key) ?? lookup(en, key) ?? tWorkspace(key, locale);
}
