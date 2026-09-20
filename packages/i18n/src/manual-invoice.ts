const fa: Record<string, string> = {
  'admin.manualInvoice.title': 'صدور فاکتور دستی',
  'admin.manualInvoice.description':
    'مشتری و ردیف‌های فاکتور را انتخاب کنید و مبلغ نهایی را پیش از صدور بررسی کنید.',
  'admin.manualInvoice.new': 'فاکتور دستی جدید',
  'admin.manualInvoice.searchProfiles': 'جست‌وجوی نام مشتری',
  'admin.manualInvoice.search': 'جست‌وجو',
  'admin.manualInvoice.loading': 'در حال دریافت…',
  'admin.manualInvoice.profile': 'پروفایل مشتری',
  'admin.manualInvoice.chooseProfile': 'انتخاب مشتری',
  'admin.manualInvoice.untitled': 'پروفایل بدون نام',
  'admin.manualInvoice.noProfiles': 'مشتری فعالی با این نام پیدا نشد.',
  'admin.manualInvoice.lookup': 'دریافت مشتریان انجام نشد. دوباره جست‌وجو کنید.',
  'admin.manualInvoice.denied': 'برای صدور فاکتور باید وارد حساب دارای دسترسی مالی شوید.',
  'admin.manualInvoice.line': 'ردیف',
  'admin.manualInvoice.lineDescription': 'شرح ردیف',
  'admin.manualInvoice.quantity': 'تعداد',
  'admin.manualInvoice.unitPrice': 'قیمت واحد (ریال)',
  'admin.manualInvoice.vat': 'مالیات بر ارزش افزوده (%)',
  'admin.manualInvoice.removeLine': 'حذف ردیف',
  'admin.manualInvoice.addLine': 'افزودن ردیف',
  'admin.manualInvoice.total': 'مبلغ نهایی با مالیات',
  'admin.manualInvoice.incomplete': 'شرح، تعداد، مبلغ و نرخ مالیات ردیف‌ها را بررسی کنید.',
  'admin.manualInvoice.invalid':
    'مشتری و ردیف‌ها را بررسی کنید. تعداد و مبالغ باید عدد صحیح باشند و مالیات بین ۰ تا ۱۰۰٪ باشد.',
  'admin.manualInvoice.issue': 'صدور فاکتور',
  'admin.manualInvoice.issuing': 'در حال صدور…',
  'admin.manualInvoice.retry': 'تلاش مجدد برای همین فاکتور',
  'admin.manualInvoice.uncertain':
    'نتیجه صدور مشخص نیست. این صفحه را باز نگه دارید و همین فاکتور را دوباره ارسال کنید تا فاکتور تکراری صادر نشود.',
  'admin.manualInvoice.conflict':
    'صدور با وضعیت فعلی مشتری یا درخواست سازگار نیست. اطلاعات را بررسی کنید.',
  'admin.manualInvoice.created': 'فاکتور صادر شد. مبلغ نهایی:',
  'admin.manualInvoice.reference': 'شماره پیگیری فاکتور:',
  'admin.manualInvoice.another': 'صدور فاکتور دیگر',
  'admin.manualInvoice.verifyTitle': 'تأیید هویت برای صدور فاکتور',
  'admin.manualInvoice.verifyDescription':
    'رمز عبور خود را وارد کنید. پس از تأیید، همین فاکتور صادر می‌شود.',
  'admin.manualInvoice.password': 'رمز عبور',
  'admin.manualInvoice.verify': 'تأیید و صدور',
  'admin.manualInvoice.cancel': 'انصراف',
  'admin.manualInvoice.verifyFailed': 'تأیید انجام نشد. رمز عبور را بررسی کنید و دوباره تلاش کنید.',
};

const en: Record<string, string> = {
  'admin.manualInvoice.title': 'Create a manual invoice',
  'admin.manualInvoice.description':
    'Choose a customer, add invoice lines and review the total before issuing.',
  'admin.manualInvoice.new': 'New manual invoice',
  'admin.manualInvoice.searchProfiles': 'Search customer names',
  'admin.manualInvoice.search': 'Search',
  'admin.manualInvoice.loading': 'Loading…',
  'admin.manualInvoice.profile': 'Customer profile',
  'admin.manualInvoice.chooseProfile': 'Choose a customer',
  'admin.manualInvoice.untitled': 'Unnamed profile',
  'admin.manualInvoice.noProfiles': 'No active customers match this search.',
  'admin.manualInvoice.lookup': 'Customers could not be loaded. Search again to retry.',
  'admin.manualInvoice.denied': 'Sign in with current Finance access to issue invoices.',
  'admin.manualInvoice.line': 'Line',
  'admin.manualInvoice.lineDescription': 'Description',
  'admin.manualInvoice.quantity': 'Quantity',
  'admin.manualInvoice.unitPrice': 'Unit price (IRR)',
  'admin.manualInvoice.vat': 'VAT (%)',
  'admin.manualInvoice.removeLine': 'Remove line',
  'admin.manualInvoice.addLine': 'Add line',
  'admin.manualInvoice.total': 'Total including VAT',
  'admin.manualInvoice.incomplete':
    'Check the line descriptions, quantities, amounts and VAT rates.',
  'admin.manualInvoice.invalid':
    'Check the customer and lines. Quantities and IRR amounts must be whole numbers; VAT must be between 0 and 100%.',
  'admin.manualInvoice.issue': 'Issue invoice',
  'admin.manualInvoice.issuing': 'Issuing…',
  'admin.manualInvoice.retry': 'Retry this invoice',
  'admin.manualInvoice.uncertain':
    'The result is unknown. Keep this page open and retry this invoice to avoid creating a duplicate.',
  'admin.manualInvoice.conflict':
    'The customer or request state has changed. Check the details before trying again.',
  'admin.manualInvoice.created': 'Invoice issued. Total:',
  'admin.manualInvoice.reference': 'Invoice reference:',
  'admin.manualInvoice.another': 'Create another invoice',
  'admin.manualInvoice.verifyTitle': 'Verify before issuing',
  'admin.manualInvoice.verifyDescription':
    'Enter your password. After verification, this same invoice will be issued.',
  'admin.manualInvoice.password': 'Password',
  'admin.manualInvoice.verify': 'Verify and issue',
  'admin.manualInvoice.cancel': 'Cancel',
  'admin.manualInvoice.verifyFailed': 'Verification failed. Check your password and try again.',
};

export function tManualInvoice(key: string, locale: 'fa' | 'en'): string {
  const messages = locale === 'fa' ? fa : en;
  return Object.hasOwn(messages, key) ? messages[key]! : key;
}
