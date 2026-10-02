import { lookup } from './lookup.js';
export type Locale = 'fa' | 'en';
export const fa = {
  'conversationIdentity.paymentActivity': 'نمایش نام در سوابق رسید پرداخت',
  'conversationIdentity.paymentActivityHelp':
    'مشتریان و کارکنانی که به فاکتور دسترسی دارند، این نام را در سوابق رسید می‌بینند. این انتخاب جدا از سوابق سفارش است؛ تصویر نمایش داده نمی‌شود. با غیرفعال کردن، نام از نمایش بعدی سوابق گذشته نیز حذف می‌شود.',
  'conversationIdentity.activity': 'نمایش این نام در سوابق سفارش، قرارداد و مشاوره',
  'conversationIdentity.activityHelp':
    'مشتریان و کارکنانی که به این پرونده‌ها دسترسی دارند، نام انتخابی شما را می‌بینند. تصویر فقط در گفتگوهای پشتیبانی نمایش داده می‌شود. با غیرفعال کردن این گزینه، نام از نمایش بعدی سوابق گذشته نیز حذف می‌شود.',
  'conversationIdentity.choosePhoto': 'انتخاب تصویر',
  'conversationIdentity.title': 'نام و تصویر گفتگو',
  'conversationIdentity.description':
    'این نام و تصویر برای دیگر شرکت‌کنندگان در گفتگوهای پشتیبانی نمایش داده می‌شود. افزودن آن‌ها اختیاری است.',
  'conversationIdentity.name': 'نام نمایشی',
  'conversationIdentity.nameHelp': 'حداکثر ۸۰ نویسه. خالی بگذارید تا فقط نقش شما نمایش داده شود.',
  'conversationIdentity.photo': 'تصویر گفتگو',
  'conversationIdentity.photoHelp': 'یک تصویر PNG، JPG یا WebP، حداکثر ۲ مگابایت.',
  'conversationIdentity.remove': 'حذف تصویر',
  'conversationIdentity.fallback': 'کاربر',
  'conversationIdentity.saveAction': 'ذخیره',
  'conversationIdentity.saving': 'در حال ذخیره…',
  'conversationIdentity.cancel': 'انصراف',
  'conversationIdentity.loading': 'در حال دریافت…',
  'conversationIdentity.load': 'دریافت اطلاعات ناموفق بود. دوباره تلاش کنید.',
  'conversationIdentity.retry': 'تلاش دوباره',
  'conversationIdentity.save': 'ذخیره ناموفق بود. تغییرات شما برای تلاش دوباره حفظ شده است.',
  'conversationIdentity.conflict':
    'اطلاعات در جای دیگری تغییر کرده است. تغییرات خود را بررسی کنید و دوباره ذخیره کنید.',
  'conversationIdentity.denied': 'دسترسی شما تغییر کرده است. دوباره وارد حساب شوید.',
  'conversationIdentity.nameError': 'نام معتبر با حداکثر ۸۰ نویسه وارد کنید.',
  'conversationIdentity.photoError': 'یک تصویر PNG، JPG یا WebP با حداکثر ۲ مگابایت انتخاب کنید.',
};
export const en = {
  'conversationIdentity.paymentActivity': 'Show name in payment receipt history',
  'conversationIdentity.paymentActivityHelp':
    'Customers and staff with access to the invoice can see this name in receipt history. This is separate from order history; photos are excluded. Turning this off also removes the name from later reads of past activity.',
  'conversationIdentity.activity': 'Show this name in order, contract and consultation history',
  'conversationIdentity.activityHelp':
    'Customers and staff with access to these records can see your chosen name. Photos stay in support conversations. Turning this off also removes the name from later reads of past activity.',
  'conversationIdentity.choosePhoto': 'Choose photo',
  'conversationIdentity.title': 'Conversation name and photo',
  'conversationIdentity.description':
    'This name and photo are shown to other participants in support conversations. Both are optional.',
  'conversationIdentity.name': 'Display name',
  'conversationIdentity.nameHelp': 'Up to 80 characters. Leave blank to show only your role.',
  'conversationIdentity.photo': 'Conversation photo',
  'conversationIdentity.photoHelp': 'One PNG, JPG or WebP image, up to 2 MB.',
  'conversationIdentity.remove': 'Remove photo',
  'conversationIdentity.fallback': 'User',
  'conversationIdentity.saveAction': 'Save',
  'conversationIdentity.saving': 'Saving…',
  'conversationIdentity.cancel': 'Cancel',
  'conversationIdentity.loading': 'Loading…',
  'conversationIdentity.load': 'Could not load your details. Please retry.',
  'conversationIdentity.retry': 'Retry',
  'conversationIdentity.save': 'Could not save. Your changes are kept for retry.',
  'conversationIdentity.conflict':
    'Your details changed elsewhere. Check your changes and save again.',
  'conversationIdentity.denied': 'Your access changed. Sign in again.',
  'conversationIdentity.nameError': 'Enter a valid name with up to 80 characters.',
  'conversationIdentity.photoError': 'Choose one PNG, JPG or WebP image up to 2 MB.',
};
export function t(key: string, locale: Locale = 'fa') {
  return lookup(locale === 'fa' ? fa : en, key) ?? key;
}
