import { t as appText } from './app.js';
import { lookup } from './lookup.js';

const fa: Record<string, string> = {
  'team.loading': 'در حال بارگذاری تیم…',
  'team.loadError': 'بارگذاری تیم انجام نشد. دوباره تلاش کنید.',
  'team.selectLegal': 'برای مدیریت تیم، یک پروفایل حقوقی انتخاب کنید.',
  'team.transfers': 'درخواست‌های انتقال مالکیت',
  'team.noTransfers': 'درخواست انتقال مالکیت در انتظاری وجود ندارد.',
  'team.incoming': 'برای پذیرش مالکیت دعوت شده‌اید.',
  'team.outgoing': 'در انتظار پذیرش مالک جدید. تا زمان پذیرش، مالکیت شما حفظ می‌شود.',
  'team.accept': 'پذیرش مالکیت',
  'team.decline': 'رد درخواست',
  'team.cancelTransfer': 'لغو انتقال',
  'team.acceptWarning':
    'با پذیرش، مالکیت به شما منتقل و نشست‌های هر دو مالک بسته می‌شود. باید دوباره وارد شوید.',
  'team.decisionWarning': 'این درخواست پایان می‌یابد. مالکیت مالک فعلی حفظ می‌شود.',
  'team.invite': 'دعوت عضو تیم',
  'team.invitePreview': 'دعوت {username} به عنوان {role} برای {entity}.',
  'team.legalEntity': 'پروفایل حقوقی',
  'team.agent': 'نام یا نام کاربری',
  'team.status': 'وضعیت',
  'team.actions': 'عملیات',
  'team.username': 'ایمیل یا شماره موبایل',
  'team.role': 'نقش',
  'team.roles': 'نقش‌ها',
  'team.sendInvite': 'ارسال دعوت‌نامه',
  'team.consent':
    'دسترسی فقط پس از پذیرش گیرنده آغاز می‌شود. دعوت‌نامه‌ها پس از هفت روز منقضی می‌شوند.',
  'team.invited': 'دعوت‌نامه ارسال شد. گیرنده باید برای عضویت آن را بپذیرد.',
  'team.members': 'اعضا و دعوت‌نامه‌ها',
  'team.empty': 'هنوز نماینده‌ای وجود ندارد. تیم خود را دعوت کنید.',
  'team.saveRoles': 'ذخیره نقش‌ها',
  'team.rolesWarning': 'نقش‌های انتخاب‌شده جایگزین دسترسی فعلی این عضو می‌شوند.',
  'team.remove': 'حذف عضو',
  'team.removeWarning': 'دسترسی این عضو بلافاصله حذف می‌شود. سوابق فعالیت او حفظ می‌شود.',
  'team.transfer': 'انتقال مالکیت',
  'team.transferWarning':
    'درخواست انتقال مالکیت برای {name} ارسال شود؟ تا زمان پذیرش، مالک باقی می‌مانید.',
  'team.transferSent': 'درخواست انتقال مالکیت برای {name} ارسال شد. گیرنده باید آن را بپذیرد.',
  'team.transferVerify':
    'ابتدا رمز عبور خود را تأیید کنید. سپس مالک جدید را از میان نمایندگان انتخاب کنید.',
  'team.selectOwner': 'انتخاب مالک جدید',
  'team.selectOwnerHint':
    'یکی از نمایندگان فعلی را انتخاب کنید. پیش از ارسال، درخواست را تأیید خواهید کرد.',
  'team.newOwner': 'مالک جدید',
  'team.continue': 'ادامه',
  'team.pending': 'در انتظار',
  'team.active': 'فعال',
  'team.joined': 'تاریخ عضویت',
  'team.withdraw': 'پس گرفتن دعوت‌نامه',
  'team.withdrawWarning': 'گیرنده دیگر نمی‌تواند این دعوت‌نامه را بپذیرد.',
  'team.saved': 'تغییر ذخیره شد.',
  'team.rateLimit': 'تعداد دعوت‌نامه‌ها بیش از حد مجاز است. بعداً دوباره تلاش کنید.',
};

const en: Record<string, string> = {
  'team.loading': 'Loading team…',
  'team.loadError': 'Could not load the team. Please retry.',
  'team.selectLegal': 'Select a legal profile to manage its team.',
  'team.transfers': 'Ownership requests',
  'team.noTransfers': 'No pending ownership requests.',
  'team.incoming': 'You have been invited to become the owner.',
  'team.outgoing': 'Waiting for the new owner to accept. You retain ownership until acceptance.',
  'team.accept': 'Accept ownership',
  'team.decline': 'Decline request',
  'team.cancelTransfer': 'Cancel transfer',
  'team.acceptWarning':
    'Accepting transfers ownership to you and signs both owners out. You will need to sign in again.',
  'team.decisionWarning': 'This ends the pending request. The current owner keeps ownership.',
  'team.invite': 'Invite a team member',
  'team.invitePreview': 'Invite {username} as {role} to {entity}.',
  'team.legalEntity': 'Legal profile',
  'team.agent': 'Name or username',
  'team.status': 'Status',
  'team.actions': 'Actions',
  'team.username': 'Email or mobile number',
  'team.role': 'Role',
  'team.roles': 'Roles',
  'team.sendInvite': 'Send invitation',
  'team.consent':
    'Access starts only after the recipient accepts. Invitations expire after seven days.',
  'team.invited': 'Invitation sent. The recipient must accept to join.',
  'team.members': 'Members and invitations',
  'team.empty': 'No agents yet. Invite your team.',
  'team.saveRoles': 'Save roles',
  'team.rolesWarning': 'The selected roles replace this member’s current access.',
  'team.remove': 'Remove member',
  'team.removeWarning':
    'This member immediately loses access. Their historical activity is preserved.',
  'team.transfer': 'Transfer ownership',
  'team.transferWarning':
    'Send an ownership request to {name}? You remain the owner until they accept.',
  'team.transferSent': 'Transfer request sent to {name}. They must accept.',
  'team.transferVerify':
    'Confirm your password first, then choose the new owner from the existing agents.',
  'team.selectOwner': 'Select the new owner',
  'team.selectOwnerHint':
    'Choose an existing agent. You will confirm the request before it is sent.',
  'team.newOwner': 'New owner',
  'team.continue': 'Continue',
  'team.pending': 'Pending',
  'team.active': 'Active',
  'team.joined': 'Joined',
  'team.withdraw': 'Withdraw invitation',
  'team.withdrawWarning': 'The recipient will no longer be able to accept this invitation.',
  'team.saved': 'Change saved.',
  'team.rateLimit': 'Too many invitations. Please try again later.',
};

export function t(key: string, locale: 'fa' | 'en' = 'fa'): string {
  return lookup(locale === 'fa' ? fa : en, key) ?? lookup(en, key) ?? appText(key, locale);
}
