import { lookup } from './lookup.js';
export type Locale = 'fa' | 'en';
export const fa = {
  'conversationIdentity.paymentActivity': 'نمایش نام در سوابق رسید پرداخت',
  'conversationIdentity.paymentActivityHelp':
    'افراد دارای دسترسی به فاکتور این نام را می‌بینند. با خاموش کردن این گزینه، نام از سوابق قبلی رسید هم پنهان می‌شود.',
  'conversationIdentity.activity': 'نمایش این نام در سوابق سفارش، قرارداد و مشاوره',
  'conversationIdentity.activityHelp':
    'افراد دارای دسترسی به این پرونده‌ها نام را می‌بینند. با خاموش کردن این گزینه، نام از سوابق قبلی هم پنهان می‌شود.',
  'conversationIdentity.sharingTitle': 'نمایش نام در سوابق',
  'conversationIdentity.sharingHelp':
    'در سوابق فقط نام نمایش داده می‌شود. تصویر در گفتگوهای پشتیبانی می‌ماند.',
  'conversationIdentity.sharingNameRequired':
    'برای انتخاب محل نمایش نام در سوابق، ابتدا نام نمایشی وارد کنید.',
  'conversationIdentity.choosePhoto': 'انتخاب تصویر',
  'conversationIdentity.title': 'نام و تصویر گفتگو',
  'conversationIdentity.description':
    'این نام و تصویر برای دیگر شرکت‌کنندگان در گفتگوهای پشتیبانی نمایش داده می‌شود. افزودن آن‌ها اختیاری است.',
  'conversationIdentity.name': 'نام نمایشی',
  'conversationIdentity.nameHelp': 'حداکثر ۸۰ نویسه. خالی بگذارید تا فقط نقش شما نمایش داده شود.',
  'conversationIdentity.photo': 'تصویر گفتگو',
  'conversationIdentity.photoHelp': 'یک تصویر PNG، JPG یا WebP، حداکثر ۲ مگابایت.',
  'conversationIdentity.remove': 'حذف تصویر',
  'conversationIdentity.discardPhoto': 'لغو انتخاب',
  'conversationIdentity.undoPhotoRemoval': 'بازگرداندن تصویر',
  'conversationIdentity.photoSaved': 'تصویر ذخیره‌شده',
  'conversationIdentity.photoEmpty': 'بدون تصویر',
  'conversationIdentity.photoRemovalPending': 'تصویر پس از ذخیره حذف می‌شود.',
  'conversationIdentity.fallback': 'کاربر',
  'conversationIdentity.saveAction': 'ذخیره',
  'conversationIdentity.saving': 'در حال ذخیره…',
  'conversationIdentity.cancel': 'انصراف',
  'conversationIdentity.loading': 'در حال دریافت…',
  'conversationIdentity.load': 'دریافت اطلاعات ناموفق بود. دوباره تلاش کنید.',
  'conversationIdentity.retry': 'تلاش دوباره',
  'conversationIdentity.save': 'ذخیره ناموفق بود. تغییرات شما برای تلاش دوباره حفظ شده است.',
  'conversationIdentity.unconfirmed':
    'نتیجهٔ ذخیره مشخص نشد. پیش از ذخیرهٔ دوباره، اطلاعات ذخیره‌شده را بررسی کنید.',
  'conversationIdentity.checkSaved': 'بررسی اطلاعات ذخیره‌شده',
  'conversationIdentity.checkFailed':
    'بررسی اطلاعات ذخیره‌شده ناموفق بود. تغییرات شما حفظ شده است. دوباره بررسی کنید.',
  'conversationIdentity.retrySave':
    'اطلاعات ذخیره‌شده با پیش‌نویس شما مطابقت ندارد. تغییرات را بررسی کنید و در صورت نیاز ذخیره کنید.',
  'conversationIdentity.conflict':
    'اطلاعات در جای دیگری تغییر کرده است. تغییرات خود را بررسی کنید و دوباره ذخیره کنید.',
  'conversationIdentity.denied': 'دسترسی شما تغییر کرده است. دوباره وارد حساب شوید.',
  'conversationIdentity.nameError': 'نام معتبر با حداکثر ۸۰ نویسه وارد کنید.',
  'conversationIdentity.photoError': 'یک تصویر PNG، JPG یا WebP با حداکثر ۲ مگابایت انتخاب کنید.',
};
export const en = {
  'conversationIdentity.paymentActivity': 'Show name in payment receipt history',
  'conversationIdentity.paymentActivityHelp':
    'People with access to the invoice can see this name. Turn this off to hide your name in past receipts too.',
  'conversationIdentity.activity': 'Show this name in order, contract and consultation history',
  'conversationIdentity.activityHelp':
    'People with access to these records can see your name. Turn this off to hide your name in past records too.',
  'conversationIdentity.sharingTitle': 'Where your name appears',
  'conversationIdentity.sharingHelp':
    'Only your name appears in these histories. Your photo stays in support conversations.',
  'conversationIdentity.sharingNameRequired':
    'Enter a display name to choose where it appears in history.',
  'conversationIdentity.choosePhoto': 'Choose photo',
  'conversationIdentity.title': 'Conversation name and photo',
  'conversationIdentity.description':
    'This name and photo are shown to other participants in support conversations. Both are optional.',
  'conversationIdentity.name': 'Display name',
  'conversationIdentity.nameHelp': 'Up to 80 characters. Leave blank to show only your role.',
  'conversationIdentity.photo': 'Conversation photo',
  'conversationIdentity.photoHelp': 'One PNG, JPG or WebP image, up to 2 MB.',
  'conversationIdentity.remove': 'Remove photo',
  'conversationIdentity.discardPhoto': 'Discard selection',
  'conversationIdentity.undoPhotoRemoval': 'Undo removal',
  'conversationIdentity.photoSaved': 'Saved photo',
  'conversationIdentity.photoEmpty': 'No photo',
  'conversationIdentity.photoRemovalPending': 'The photo will be removed when you save.',
  'conversationIdentity.fallback': 'User',
  'conversationIdentity.saveAction': 'Save',
  'conversationIdentity.saving': 'Saving…',
  'conversationIdentity.cancel': 'Cancel',
  'conversationIdentity.loading': 'Loading…',
  'conversationIdentity.load': 'Could not load your details. Please retry.',
  'conversationIdentity.retry': 'Retry',
  'conversationIdentity.save': 'Could not save. Your changes are kept for retry.',
  'conversationIdentity.unconfirmed':
    'The save could not be confirmed. Check the saved details before saving again.',
  'conversationIdentity.checkSaved': 'Check saved details',
  'conversationIdentity.checkFailed':
    'Could not check the saved details. Your changes are kept. Try checking again.',
  'conversationIdentity.retrySave':
    'The saved details differ from your draft. Review your changes and save when ready.',
  'conversationIdentity.conflict':
    'Your details changed elsewhere. Check your changes and save again.',
  'conversationIdentity.denied': 'Your access changed. Sign in again.',
  'conversationIdentity.nameError': 'Enter a valid name with up to 80 characters.',
  'conversationIdentity.photoError': 'Choose one PNG, JPG or WebP image up to 2 MB.',
};
export function t(key: string, locale: Locale = 'fa') {
  return lookup(locale === 'fa' ? fa : en, key) ?? key;
}
