const key = 'barghsa.entry-locale';

/** Preserve the current document language across an entry-bundle navigation. */
export function rememberEntryLocale(): void {
  try {
    const locale = document.documentElement.lang.toLowerCase().split('-')[0] === 'en' ? 'en' : 'fa';
    sessionStorage.setItem(key, JSON.stringify({ locale, expires: Date.now() + 30_000 }));
  } catch {
    // Browser storage must not prevent navigation.
  }
}

/** Runs before React renders; this is a one-time handoff, not a new language preference. */
export function restoreEntryLocale(): void {
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw) return;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return;
    const { locale, expires } = value as Record<string, unknown>;
    if (
      (locale !== 'en' && locale !== 'fa') ||
      typeof expires !== 'number' ||
      expires <= Date.now() ||
      expires > Date.now() + 30_000
    )
      return;
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
  } catch {
    // Keep the HTML document's default when storage is unavailable or invalid.
  }
}
