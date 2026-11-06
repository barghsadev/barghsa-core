import type { Locale } from './app.js';
export const fa = {
  'level.0': 'خیلی ضعیف',
  'hint.0': 'از رمزهای رایج، تکرار و الگوهای قابل حدس استفاده نکنید.',
  'level.1': 'ضعیف',
  'hint.1': 'چند واژهٔ نامرتبط یا نویسهٔ تصادفی دیگر اضافه کنید.',
  'level.2': 'متوسط',
  'hint.2': 'رمز را با واژه‌های نامرتبط یا نویسه‌های تصادفی طولانی‌تر کنید.',
  'level.3': 'قوی',
  'hint.3': 'برای اطمینان بیشتر، طول رمز را افزایش دهید و آن را فقط برای این حساب نگه دارید.',
  'level.4': 'بسیار قوی',
  'hint.4': 'این رمز را برای حساب دیگری استفاده نکنید و آن را در مدیر رمز عبور نگه دارید.',
};
export const en = {
  'level.0': 'Very weak',
  'hint.0': 'Avoid common passwords, repetition and predictable patterns.',
  'level.1': 'Weak',
  'hint.1': 'Add more unrelated words or random characters.',
  'level.2': 'Fair',
  'hint.2': 'Make it longer with unrelated words or random characters.',
  'level.3': 'Strong',
  'hint.3': 'Add length for more protection and use this password only for this account.',
  'level.4': 'Very strong',
  'hint.4': 'Keep this password unique and store it in a password manager.',
};

/** Loaded with the local estimator, after password interaction. */
export function passwordStrengthFeedback(score: number, locale: Locale) {
  const tier = Math.max(0, Math.min(4, Math.floor(score / 25))) as 0 | 1 | 2 | 3 | 4;
  const words = locale === 'fa' ? fa : en;
  return { label: words[`level.${tier}`], hint: words[`hint.${tier}`] };
}
