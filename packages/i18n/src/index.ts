export interface I18nDictionary {
  [key: string]: string;
}

/** Persian (fa) dictionary for the Barghsa platform */
export const fa: I18nDictionary = {
  // ── Validation ──────────────────────────────────────────
  'error.validation.input.invalid': 'مقدار ورودی نامعتبر است',
  'error.validation.input.missing': 'فیلد الزامی وارد نشده است',
  'error.validation.parse.zod': 'داده‌های ارسالی معتبر نیستند',
  'error.validation.parse.json': 'فرمت JSON درخواست نامعتبر است',

  // ── Authentication ──────────────────────────────────────
  'error.auth.unauthenticated': 'احراز هویت نشده‌اید',
  'error.auth.token.expired': 'نشست شما منقضی شده است',
  'error.auth.token.invalid': 'نشست شما نامعتبر است',
  'error.auth.session.revoked': 'نشست شما باطل شده است',
  'error.auth.mfa.required': 'احراز هویت دومرحله‌ای الزامی است',
  'error.auth.mfa.invalid': 'کد احراز هویت نامعتبر است',

  // ── Authorization ───────────────────────────────────────
  'error.authz.forbidden': 'دسترسی غیرمجاز',
  'error.authz.insufficient.role': 'نقش کاربری شما مجاز به انجام این عملیات نیست',
  'error.authz.not.resource.owner': 'شما مالک این منبع نیستید',

  // ── Not Found ───────────────────────────────────────────
  'error.not_found.resource': 'منبع درخواستی یافت نشد',
  'error.not_found.route': 'مسیر درخواستی یافت نشد',

  // ── Auth Pages — Brand ───────────────────────────────────
  'auth.brand.title': 'برگشا',
  'auth.brand.slogan': 'پلتفرم هوشمند بازار برق ایران',
  'auth.brand.value1': 'مقایسه و خرید بسته‌های برق با بهترین قیمت',
  'auth.brand.value2': 'مدیریت هوشمند مصرف و قبض‌های خود',
  'auth.brand.value3': 'دسترسی به طرح‌های پس‌انداز و انرژی خورشیدی',
  'auth.brand.logo.alt': 'لوگوی برگشا',

  // ── Auth Pages — Register ────────────────────────────────
  'auth.register.title': 'ایجاد حساب کاربری',
  'auth.register.submit': 'ثبت‌نام',
  'auth.register.loginLink': 'قبلاً ثبت‌نام کرده‌اید؟ وارد شوید',
  'auth.register.loginLinkLabel': 'ورود به حساب کاربری',
  'auth.register.emailLabel': 'ایمیل یا شماره موبایل',
  'auth.register.passwordLabel': 'رمز عبور',
  'auth.register.emailPlaceholder': 'example@email.com',

  // ── Conflict ────────────────────────────────────────────
  'error.conflict.duplicate': 'این مورد از قبل وجود دارد',
  'error.conflict.state': 'وضعیت فعلی امکان انجام این عملیات را نمی‌دهد',
  'error.conflict.version': 'تغییرات همزمان باعث تداخل شده است',

  // ── Rate Limit ──────────────────────────────────────────
  'error.rate_limit.exceeded': 'تعداد درخواست‌های شما بیش از حد مجاز است',

  // ── Provider / External ─────────────────────────────────
  'error.provider.downstream': 'خطا در سرویس خارجی',
  'error.provider.timeout': 'مدت زمان انتظار برای سرویس خارجی به پایان رسید',
  'error.provider.rate_limited': 'سرویس خارجی محدودیت نرخ دارد',

  // ── Internal ────────────────────────────────────────────
  'error.internal.server': 'خطای داخلی سرور',
  'error.internal.database': 'خطای پایگاه داده',
  'error.internal.unexpected': 'خطای غیرمنتظره رخ داده است',
};

/** English (en) dictionary for the Barghsa platform */
export const en: I18nDictionary = {
  // ── Validation ──────────────────────────────────────────
  'error.validation.input.invalid': 'Invalid input value',
  'error.validation.input.missing': 'Required field is missing',
  'error.validation.parse.zod': 'Submitted data is not valid',
  'error.validation.parse.json': 'Invalid JSON request format',

  // ── Authentication ──────────────────────────────────────
  'error.auth.unauthenticated': 'Authentication required',
  'error.auth.token.expired': 'Your session has expired',
  'error.auth.token.invalid': 'Invalid session token',
  'error.auth.session.revoked': 'Your session has been revoked',
  'error.auth.mfa.required': 'Multi-factor authentication is required',
  'error.auth.mfa.invalid': 'Invalid authentication code',

  // ── Authorization ───────────────────────────────────────
  'error.authz.forbidden': 'Access denied',
  'error.authz.insufficient.role': 'Your role does not have permission for this action',
  'error.authz.not.resource.owner': 'You are not the owner of this resource',

  // ── Not Found ───────────────────────────────────────────
  'error.not_found.resource': 'Requested resource was not found',
  'error.not_found.route': 'Requested route was not found',

  // ── Conflict ────────────────────────────────────────────
  'error.conflict.duplicate': 'This entry already exists',
  'error.conflict.state': 'Current state does not allow this operation',
  'error.conflict.version': 'Concurrent modification conflict detected',

  // ── Auth Pages — Brand ───────────────────────────────────
  'auth.brand.title': 'Barghsa',
  'auth.brand.slogan': 'Iranian electricity market intelligence platform',
  'auth.brand.value1': 'Compare and purchase electricity packages at the best price',
  'auth.brand.value2': 'Smart consumption and bill management',
  'auth.brand.value3': 'Access to savings plans and solar energy',
  'auth.brand.logo.alt': 'Barghsa logo',

  // ── Auth Pages — Register ────────────────────────────────
  'auth.register.title': 'Create an account',
  'auth.register.submit': 'Register',
  'auth.register.loginLink': 'Already have an account? Log in',
  'auth.register.loginLinkLabel': 'Log in to your account',
  'auth.register.emailLabel': 'Email or Mobile number',
  'auth.register.passwordLabel': 'Password',
  'auth.register.emailPlaceholder': 'example@email.com',

  // ── Rate Limit ──────────────────────────────────────────
  'error.rate_limit.exceeded': 'Too many requests – please try again later',

  // ── Provider / External ─────────────────────────────────
  'error.provider.downstream': 'External service error',
  'error.provider.timeout': 'External service timed out',
  'error.provider.rate_limited': 'External service is rate-limited',

  // ── Internal ────────────────────────────────────────────
  'error.internal.server': 'Internal server error',
  'error.internal.database': 'Database error',
  'error.internal.unexpected': 'An unexpected error occurred',
};

/** Supported locale codes */
export type Locale = 'fa' | 'en';

/** All available dictionaries */
export const dictionaries: Record<Locale, I18nDictionary> = { fa, en };

/** Resolve a message key for the given locale. Falls back to English then the key itself. */
export function t(key: string, locale: Locale = 'fa'): string {
  return dictionaries[locale]?.[key] ?? dictionaries.en?.[key] ?? key;
}