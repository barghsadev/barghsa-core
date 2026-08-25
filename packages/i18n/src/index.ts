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
  'error.authz.profile.not_verified': 'پروفایل شما تأیید نشده است. برای ثبت سفارش جدید، ابتدا پروفایل خود را تأیید کنید',

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
  'auth.register.passwordPlaceholder': '••••••••',
  'auth.register.passwordVisibilityLabel': 'نمایش یا مخفی‌سازی رمز عبور',
  'auth.register.passwordStrengthWeak': 'ضعیف',
  'auth.register.passwordStrengthFair': 'متوسط',
  'auth.register.passwordStrengthGood': 'خوب',
  'auth.register.passwordStrengthStrong': 'قوی',
  'auth.register.passwordRequirements': 'حداقل ۸ کاراکتر، شامل حرف بزرگ، حرف کوچک و عدد',
  'auth.register.emailPlaceholder': 'example@email.com',
  'auth.register.usernamePlaceholder': 'ایمیل یا شماره موبایل',
  'auth.register.invalidEmail': 'ایمیل نامعتبر است',
  'auth.register.invalidMobile': 'شماره موبایل نامعتبر است',
  'auth.register.invalidUsername': 'نام کاربری نامعتبر است',
  'auth.register.tosLinkText': 'قوانین استفاده',
  'auth.register.tosRequired': 'برای ثبت‌نام باید قوانین را بپذیرید',
  'auth.register.tosPrefix': 'با ثبت‌نام،',
  'auth.register.tosSuffix': 'و سیاست‌های حریم خصوصی را می‌پذیرم',
  'auth.register.forgotPasswordLink': 'رمز عبور را فراموش کرده‌اید؟',
  'auth.register.forgotPasswordLabel': 'فراموشی رمز عبور',
  'auth.register.newPasswordLabel': 'رمز عبور جدید',
  'auth.register.confirmPasswordLabel': 'تکرار رمز عبور جدید',
  'auth.register.error.passwordsDoNotMatch': 'رمز عبور و تکرار آن مطابقت ندارند',

  // ── Conflict ────────────────────────────────────────────
  'error.conflict.duplicate': 'این مورد از قبل وجود دارد',
  'error.conflict.state': 'وضعیت فعلی امکان انجام این عملیات را نمی‌دهد',
  'error.conflict.version': 'تغییرات همزمان باعث تداخل شده است',

  // ── Rate Limit ──────────────────────────────────────────
  'error.rate_limit.exceeded': 'تعداد درخواست‌های شما بیش از حد مجاز است',
  'error.rate_limit.retry_after': 'تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً {seconds} ثانیه دیگر تلاش کنید',

  // ── Provider / External ─────────────────────────────────
  'error.provider.downstream': 'خطا در سرویس خارجی',
  'error.provider.timeout': 'مدت زمان انتظار برای سرویس خارجی به پایان رسید',
  'error.provider.rate_limited': 'سرویس خارجی محدودیت نرخ دارد',

  // ── Auth Pages — Register (submission errors) ───────────
  'auth.register.submitting': 'در حال ثبت‌نام…',
  'auth.register.error.generic': 'خطایی رخ داده است. لطفاً دوباره تلاش کنید',
  'auth.register.error.usernameTaken': 'این نام کاربری قبلاً ثبت شده است',
  'auth.register.error.invalidUsername': 'نام کاربری نامعتبر است',
  'auth.register.error.weakPassword': 'رمز عبور الزامات امنیتی را ندارد',
  'auth.register.error.tosNotAccepted': 'باید قوانین استفاده را بپذیرید',
  'auth.register.error.rateLimited': 'تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً بعداً تلاش کنید',
  'auth.register.error.internal': 'خطای داخلی سرور رخ داده است. لطفاً بعداً تلاش کنید',
  'auth.register.otpSent': 'کد تأیید برای شما ارسال شد',
  'auth.register.success': 'حساب شما با موفقیت ایجاد شد',

  // ── Auth Pages — Login ────────────────────────────────────────
  'auth.login.title': 'ورود به حساب کاربری',
  'auth.login.submit': 'ورود',
  'auth.login.registerLink': 'حساب کاربری ندارید؟ ثبت‌نام کنید',
  'auth.login.registerLinkLabel': 'ثبت‌نام',
  'auth.login.submitting': 'در حال ورود…',
  'auth.login.error.invalidCredentials': 'نام کاربری یا رمز عبور نامعتبر است',
  'auth.login.error.generic': 'خطایی رخ داده است. لطفاً دوباره تلاش کنید',
  'auth.login.error.internal': 'خطای داخلی سرور رخ داده است. لطفاً بعداً تلاش کنید',
  'auth.login.success': 'با موفقیت وارد شدید',
  'auth.login.otpTitle': 'تأیید ورود دو مرحله‌ای',
  'auth.login.otpSentTo': 'کد تأیید به {destination} ارسال شد',
  'auth.login.otpBackToLogin': 'بازگشت به فرم ورود',
  'auth.login.trustDevice': 'این دستگاه را به خاطر بسپار',
  'auth.login.otpSuccess': 'ورود با موفقیت تأیید شد',
  'auth.login.otpExpired': 'کد تأیید منقضی شده است. لطفاً دوباره وارد شوید',
  'auth.login.backToLogin': 'بازگشت به فرم ورود',
  'auth.login.forceChangeTitle': 'تغییر رمز عبور الزامی است',
  'auth.login.forceChangeDescription': 'حساب شما نیاز به تغییر رمز عبور دارد. لطفاً یک رمز عبور جدید انتخاب کنید',
  'auth.login.changingPassword': 'در حال تغییر رمز عبور…',
  'auth.login.changePasswordButton': 'تغییر رمز عبور',
  'auth.login.passwordChanged': 'رمز عبور با موفقیت تغییر کرد. لطفاً با رمز جدید وارد شوید',
  'auth.login.error.mustChangePassword': 'تغییر رمز عبور الزامی است',
  'auth.login.error.passwordReused': 'این رمز عبور قبلاً استفاده شده است. لطفاً رمز عبور دیگری انتخاب کنید',
  'auth.login.error.passwordChangeFailed': 'تغییر رمز عبور با خطا مواجه شد. لطفاً دوباره تلاش کنید',

  // ── Auth Pages — OTP Verification ────────────────────────────
  'auth.otp.title': 'تأیید شماره موبایل / ایمیل',
  'auth.otp.sentTo': 'کد تأیید به {destination} ارسال شد',
  'auth.otp.digitLabel': 'رقم',
  'auth.otp.inputLabel': 'کد تأیید ۶ رقمی',
  'auth.otp.resend': 'ارسال مجدد',
  'auth.otp.resendTimer': 'ارسال مجدد در {seconds} ثانیه',
  'auth.otp.resending': 'در حال ارسال مجدد…',
  'auth.otp.verifying': 'در حال تأیید…',
  'auth.otp.verifyButton': 'تأیید',
  'auth.otp.expired': 'کد تأیید منقضی شده است. لطفاً دوباره ثبت‌نام کنید',
  'auth.otp.error.invalid': 'کد تأیید نامعتبر است',
  'auth.otp.error.expired': 'کد تأیید منقضی شده است',
  'auth.otp.error.maxAttempts': 'تعداد تلاش‌های ناموفق بیش از حد مجاز است',
  'auth.otp.error.resend': 'خطا در ارسال مجدد کد',
  'auth.otp.error.generic': 'خطایی رخ داده است. لطفاً دوباره تلاش کنید',
  'auth.otp.backToRegister': 'بازگشت به فرم ثبت‌نام',

  // ── Auth Pages — Forgot Password ─────────────────────────
  'auth.forgotPassword.title': 'فراموشی رمز عبور',
  'auth.forgotPassword.submit': 'ارسال کد تأیید',
  'auth.forgotPassword.submitting': 'در حال ارسال…',
  'auth.forgotPassword.sent': 'اگر حساب کاربری با این اطلاعات وجود داشته باشد، کد تأیید برای شما ارسال شده است',
  'auth.forgotPassword.otpTitle': 'کد تأیید بازیابی رمز عبور',
  'auth.forgotPassword.otpSentTo': 'کد تأیید به {destination} ارسال شد',
  'auth.forgotPassword.backToLogin': 'بازگشت به فرم ورود',
  'auth.forgotPassword.helpLink': 'مشکل دارید؟ با پشتیبانی تماس بگیرید',
  'auth.forgotPassword.error.generic': 'خطایی رخ داده است. لطفاً دوباره تلاش کنید',
  'auth.forgotPassword.error.rateLimited': 'تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً بعداً تلاش کنید',

  // ── Auth Pages — Account Recovery Support ────────────────
  'auth.support.title': 'پشتیبانی بازیابی حساب',
  'auth.support.subtitle': 'اگر دیگر به ایمیل یا شماره تلفن ثبت‌نامی خود دسترسی ندارید، ما اینجا هستیم تا کمک کنیم.',
  'auth.support.steps': 'بازیابی حساب نیاز به تأیید هویت و بررسی کامل تاریخچه حساب دارد. تیم پشتیبانی شما را در این فرآیند راهنمایی خواهد کرد.',
  'auth.support.contactEmail': 'با ما تماس بگیرید:',
  'auth.support.emailAddress': 'support@barghsa.com',
  'auth.support.contactPhone': 'یا با شماره زیر تماس بگیرید:',
  'auth.support.phoneNumber': '۰۲۱-۱۲۳۴۵۶۷۸',
  'auth.support.responseTime': 'زمان پاسخگویی: حداکثر ۲۴ ساعت',
  'auth.support.backToLogin': 'بازگشت به فرم ورود',

  // ── Internal ────────────────────────────────────────────
  'error.internal.server': 'خطای داخلی سرور',
  'error.internal.database': 'خطای پایگاه داده',
  'error.internal.unexpected': 'خطای غیرمنتظره رخ داده است',

  // ── Products ────────────────────────────────────────────
  'product.thermal': 'برق حرارتی',
  'product.green': 'برق سبز',
  'product.free_market': 'برق آزاد',
  'product.energy_saving': 'برق صرفه‌جویی',

  // ── Settings — Security / Sessions ──────────────────────
  'settings.security.title': 'امنیت و نشست‌ها',
  'settings.security.sessionsTitle': 'نشست‌های فعال',
  'settings.security.sessionsDescription': 'دستگاه‌هایی که با حساب شما متصل هستند',
  'settings.security.currentSession': 'نشست فعلی',
  'settings.security.revoke': 'قطع دسترسی',
  'settings.security.revokeConfirm': 'آیا از قطع دسترسی این نشست اطمینان دارید؟',
  'settings.security.revokeAll': 'قطع دسترسی همه نشست‌های دیگر',
  'settings.security.revokeAllDescription': 'با این کار از همه دستگاه‌های دیگر خارج می‌شوید',
  'settings.security.revokeAllConfirm': 'برای قطع دسترسی همه نشست‌های دیگر، رمز عبور خود را وارد کنید',
  'settings.security.passwordLabel': 'رمز عبور',
  'settings.security.passwordPlaceholder': 'رمز عبور خود را وارد کنید',
  'settings.security.confirmButton': 'تأیید و قطع دسترسی',
  'settings.security.revoked': 'دسترسی با موفقیت قطع شد',
  'settings.security.revokeAllSuccess': 'دسترسی همه نشست‌های دیگر با موفقیت قطع شد',
  'settings.security.noOtherSessions': 'نشست فعال دیگری وجود ندارد',
  'settings.security.deviceUnknown': 'دستگاه ناشناخته',
  'settings.security.ipUnknown': 'نامشخص',
  'settings.security.lastActive': 'آخرین فعالیت',
  'settings.security.createdAt': 'ایجاد شده در',
  'settings.security.expiresAt': 'انقضا',
  'settings.security.error.revoke': 'خطا در قطع دسترسی نشست',
  'settings.security.error.revokeAll': 'خطا در قطع دسترسی همه نشست‌ها',
  'settings.security.error.invalidPassword': 'رمز عبور نامعتبر است',
  'settings.security.loading': 'در حال بارگذاری…',
  'settings.security.error.load': 'خطا در بارگذاری نشست‌ها',
  'settings.security.error.auth': 'احراز هویت نشده‌اید',
  'settings.security.error.loadRetry': 'خطا در بارگذاری نشست‌ها. لطفاً دوباره تلاش کنید',
  'settings.security.noSessions': 'هیچ نشست فعالی یافت نشد',
  'settings.security.cancel': 'انصراف',
  'settings.security.revoking': 'در حال قطع دسترسی…',
  'settings.security.error.title': 'خطا',
  'settings.security.device.ios': 'Apple iOS',
  'settings.security.device.mac': 'Apple Mac',
  'settings.security.device.androidPhone': 'اندروید',
  'settings.security.device.androidTablet': 'تبلت اندروید',
  'settings.security.device.windows': 'Windows PC',
  'settings.security.device.linux': 'لینوکس',

  // ── Onboarding ───────────────────────────────────────────
  'onboarding.welcome.title': 'خوش آمدید به بارگشا',
  'onboarding.welcome.subtitle': 'برای شروع، لطفاً پروفایل خود را ایجاد کنید.',
  'onboarding.welcome.subtitleEn': 'Please create your profile to get started.',
  'onboarding.profile.individual': 'حقیقی',
  'onboarding.profile.individualDesc': 'برای ثبت‌نام به عنوان شخص حقیقی',
  'onboarding.profile.individualDescEn': 'Individual registration',
  'onboarding.profile.legal': 'حقوقی',
  'onboarding.profile.legalDesc': 'برای ثبت‌نام به عنوان شخص حقوقی',
  'onboarding.profile.legalDescEn': 'Legal entity registration',

  // ── Verification ───────────────────────────────────────────
  'verification.banner.title': 'پروفایل شما تأیید نشده است',
  'verification.banner.verifyNow': 'تأیید کن',
  'verification.banner.learnMore': 'بیشتر بدانید',
  'verification.banner.verify': 'تأیید خودکار',
  'verification.banner.verifying': 'در حال تأیید…',
  'verification.banner.verified': 'پروفایل شما با موفقیت تأیید شد',
  'verification.order.blocked.title': 'ثبت سفارش جدید امکان‌پذیر نیست',
  'verification.order.blocked.description': 'پروفایل شما هنوز تأیید نشده است. برای ثبت سفارش جدید، ابتدا پروفایل خود را تأیید کنید.',
  'verification.order.blocked.support': 'در صورت نیاز به راهنمایی با پشتیبانی تماس بگیرید.',
  'verification.status.unverified': 'تأیید نشده',
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
  'error.authz.profile.not_verified': 'Your profile is not verified. Please verify your profile before placing an order',

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
  'auth.register.passwordPlaceholder': '••••••••',
  'auth.register.passwordVisibilityLabel': 'Toggle password visibility',
  'auth.register.passwordStrengthWeak': 'Weak',
  'auth.register.passwordStrengthFair': 'Fair',
  'auth.register.passwordStrengthGood': 'Good',
  'auth.register.passwordStrengthStrong': 'Strong',
  'auth.register.passwordRequirements': 'Minimum 8 characters, must include uppercase, lowercase, and a digit',
  'auth.register.emailPlaceholder': 'example@email.com',
  'auth.register.usernamePlaceholder': 'Email or Mobile number',
  'auth.register.invalidEmail': 'Invalid email address',
  'auth.register.invalidMobile': 'Invalid mobile number',
  'auth.register.invalidUsername': 'Invalid username',
  'auth.register.tosLinkText': 'terms of use',
  'auth.register.tosRequired': 'You must accept the terms before registering',
  'auth.register.tosPrefix': 'By registering, I accept the',
  'auth.register.tosSuffix': 'and privacy policy',
  'auth.register.forgotPasswordLink': 'Forgot password?',
  'auth.register.forgotPasswordLabel': 'Forgot password',
  'auth.register.newPasswordLabel': 'New password',
  'auth.register.confirmPasswordLabel': 'Confirm new password',
  'auth.register.error.passwordsDoNotMatch': 'Passwords do not match',

  // ── Rate Limit ──────────────────────────────────────────
  'error.rate_limit.exceeded': 'Too many requests – please try again later',
  'error.rate_limit.retry_after': 'Too many requests – please try again in {seconds} seconds',

  // ── Provider / External ─────────────────────────────────
  'error.provider.downstream': 'External service error',
  'error.provider.timeout': 'External service timed out',
  'error.provider.rate_limited': 'External service is rate-limited',

  // ── Auth Pages — Register (submission errors) ───────────
  'auth.register.submitting': 'Registering…',
  'auth.register.error.generic': 'An error occurred. Please try again',
  'auth.register.error.usernameTaken': 'This username is already registered',
  'auth.register.error.invalidUsername': 'Invalid username',
  'auth.register.error.weakPassword': 'Password does not meet security requirements',
  'auth.register.error.tosNotAccepted': 'You must accept the terms of service',
  'auth.register.error.rateLimited': 'Too many attempts. Please try again later',
  'auth.register.error.internal': 'An internal server error occurred. Please try again later',
  'auth.register.otpSent': 'Verification code has been sent',
  'auth.register.success': 'Account created successfully',

  // ── Auth Pages — Login ────────────────────────────────────────
  'auth.login.title': 'Log in',
  'auth.login.submit': 'Log in',
  'auth.login.registerLink': 'Don\'t have an account? Register',
  'auth.login.registerLinkLabel': 'Register',
  'auth.login.submitting': 'Logging in…',
  'auth.login.error.invalidCredentials': 'Invalid username or password',
  'auth.login.error.generic': 'An error occurred. Please try again',
  'auth.login.error.internal': 'An internal server error occurred. Please try again later',
  'auth.login.success': 'Logged in successfully',
  'auth.login.otpTitle': 'Two-factor authentication required',
  'auth.login.otpSentTo': 'A verification code has been sent to {destination}',
  'auth.login.otpBackToLogin': 'Back to login',
  'auth.login.trustDevice': 'Trust this device',
  'auth.login.otpSuccess': 'Login verified successfully',
  'auth.login.otpExpired': 'Verification code expired. Please log in again',
  'auth.login.backToLogin': 'Back to login',
  'auth.login.forceChangeTitle': 'Password change required',
  'auth.login.forceChangeDescription': 'Your account requires a password change. Please choose a new password',
  'auth.login.changingPassword': 'Changing password…',
  'auth.login.changePasswordButton': 'Change password',
  'auth.login.passwordChanged': 'Password changed successfully. Please log in with your new password',
  'auth.login.error.mustChangePassword': 'Password change is required',
  'auth.login.error.passwordReused': 'This password was used before. Please choose a different password',
  'auth.login.error.passwordChangeFailed': 'Password change failed. Please try again',

  // ── Auth Pages — OTP Verification ────────────────────────────
  'auth.otp.title': 'Verify Mobile / Email',
  'auth.otp.sentTo': 'A verification code was sent to {destination}',
  'auth.otp.digitLabel': 'Digit',
  'auth.otp.inputLabel': '6-digit verification code',
  'auth.otp.resend': 'Resend code',
  'auth.otp.resendTimer': 'Resend in {seconds}s',
  'auth.otp.resending': 'Resending…',
  'auth.otp.verifying': 'Verifying…',
  'auth.otp.verifyButton': 'Verify',
  'auth.otp.expired': 'The verification code has expired. Please register again',
  'auth.otp.error.invalid': 'Invalid verification code',
  'auth.otp.error.expired': 'Verification code has expired',
  'auth.otp.error.maxAttempts': 'Too many failed attempts',
  'auth.otp.error.resend': 'Failed to resend code',
  'auth.otp.error.generic': 'An error occurred. Please try again',
  'auth.otp.backToRegister': 'Back to registration',

  // ── Auth Pages — Forgot Password ─────────────────────────
  'auth.forgotPassword.title': 'Forgot Password',
  'auth.forgotPassword.submit': 'Send verification code',
  'auth.forgotPassword.submitting': 'Sending…',
  'auth.forgotPassword.sent': 'If an account exists with this information, a verification code has been sent',
  'auth.forgotPassword.otpTitle': 'Password Reset Verification',
  'auth.forgotPassword.otpSentTo': 'A verification code has been sent to {destination}',
  'auth.forgotPassword.backToLogin': 'Back to login',
  'auth.forgotPassword.helpLink': 'Having trouble? Contact support',
  'auth.forgotPassword.error.generic': 'An error occurred. Please try again',
  'auth.forgotPassword.error.rateLimited': 'Too many attempts. Please try again later',

  // ── Auth Pages — Account Recovery Support ────────────────
  'auth.support.title': 'Account Recovery Support',
  'auth.support.subtitle': "If you no longer have access to your registered email or phone number, we're here to help.",
  'auth.support.steps': 'Account recovery requires identity verification and a full audit history. Our support team will guide you through the process.',
  'auth.support.contactEmail': 'Contact us at:',
  'auth.support.emailAddress': 'support@barghsa.com',
  'auth.support.contactPhone': 'Or call us:',
  'auth.support.phoneNumber': '+98 21 1234 5678',
  'auth.support.responseTime': 'Response time: within 24 hours',
  'auth.support.backToLogin': 'Back to login',

  // ── Internal ────────────────────────────────────────────
  'error.internal.server': 'Internal server error',
  'error.internal.database': 'Database error',
  'error.internal.unexpected': 'An unexpected error occurred',

  // ── Products ────────────────────────────────────────────
  'product.thermal': 'Thermal Electricity',
  'product.green': 'Green Electricity',
  'product.free_market': 'Free Market Electricity',
  'product.energy_saving': 'Energy Saving Electricity',

  // ── Settings — Security / Sessions ──────────────────────
  'settings.security.title': 'Security & Sessions',
  'settings.security.sessionsTitle': 'Active Sessions',
  'settings.security.sessionsDescription': 'Devices connected to your account',
  'settings.security.currentSession': 'Current session',
  'settings.security.revoke': 'Revoke',
  'settings.security.revokeConfirm': 'Are you sure you want to revoke this session?',
  'settings.security.revokeAll': 'Revoke all other sessions',
  'settings.security.revokeAllDescription': 'This will sign you out from all other devices',
  'settings.security.revokeAllConfirm': 'Enter your password to revoke all other sessions',
  'settings.security.passwordLabel': 'Password',
  'settings.security.passwordPlaceholder': 'Enter your password',
  'settings.security.confirmButton': 'Confirm & revoke',
  'settings.security.revoked': 'Session revoked successfully',
  'settings.security.revokeAllSuccess': 'All other sessions revoked successfully',
  'settings.security.noOtherSessions': 'No other active sessions',
  'settings.security.deviceUnknown': 'Unknown device',
  'settings.security.ipUnknown': 'Unknown',
  'settings.security.lastActive': 'Last active',
  'settings.security.createdAt': 'Created',
  'settings.security.expiresAt': 'Expires',
  'settings.security.error.revoke': 'Failed to revoke session',
  'settings.security.error.revokeAll': 'Failed to revoke all sessions',
  'settings.security.error.invalidPassword': 'Invalid password',
  'settings.security.loading': 'Loading…',
  'settings.security.error.load': 'Failed to load sessions',
  'settings.security.error.auth': 'Not authenticated',
  'settings.security.error.loadRetry': 'Failed to load sessions. Please try again.',
  'settings.security.noSessions': 'No active sessions found',
  'settings.security.cancel': 'Cancel',
  'settings.security.revoking': 'Revoking…',
  'settings.security.error.title': 'Error',
  'settings.security.device.ios': 'Apple iOS',
  'settings.security.device.mac': 'Apple Mac',
  'settings.security.device.androidPhone': 'Android Phone',
  'settings.security.device.androidTablet': 'Android Tablet',
  'settings.security.device.windows': 'Windows PC',
  'settings.security.device.linux': 'Linux',

  // ── Onboarding ───────────────────────────────────────────
  'onboarding.welcome.title': 'Welcome to Barghsa',
  'onboarding.welcome.subtitle': 'Please create your profile to get started.',
  'onboarding.profile.individual': 'Individual',
  'onboarding.profile.individualDesc': 'Register as an individual person',
  'onboarding.profile.legal': 'Legal Entity',
  'onboarding.profile.legalDesc': 'Register as a legal entity',

  // ── Verification ───────────────────────────────────────────
  'verification.banner.title': 'Your profile is not verified',
  'verification.banner.verifyNow': 'Verify now',
  'verification.banner.learnMore': 'Learn more',
  'verification.banner.verify': 'Auto-verify',
  'verification.banner.verifying': 'Verifying…',
  'verification.banner.verified': 'Your profile has been verified successfully',
  'verification.order.blocked.title': 'New orders are not available',
  'verification.order.blocked.description': 'Your profile has not been verified yet. Please verify your profile before placing a new order.',
  'verification.order.blocked.support': 'Contact support for assistance.',
  'verification.status.unverified': 'Unverified',
};

/** Supported locale codes */
export type Locale = 'fa' | 'en';

/** All available dictionaries */
export const dictionaries: Record<Locale, I18nDictionary> = { fa, en };

/** Resolve a message key for the given locale. Falls back to English then the key itself. */
export function t(key: string, locale: Locale = 'fa'): string {
  return dictionaries[locale]?.[key] ?? dictionaries.en?.[key] ?? key;
}