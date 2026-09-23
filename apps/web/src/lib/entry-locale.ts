import type { Locale } from '@barghsa/i18n/auth';

const entryKey = 'barghsa.entry-locale';
const preferenceKey = 'barghsa.locale';
const cookieKey = 'barghsa_locale';

function supported(value: string | null | undefined): Locale | null {
  const language = value?.toLowerCase().split('-')[0];
  return language === 'en' || language === 'fa' ? language : null;
}

function savedPreference(): Locale | null {
  try {
    const stored = supported(localStorage.getItem(preferenceKey));
    if (stored) return stored;
  } catch {
    // Cookie and browser preferences remain available when storage is blocked.
  }
  try {
    const match = document.cookie.split('; ').find((part) => part.startsWith(`${cookieKey}=`));
    const stored = supported(match?.slice(cookieKey.length + 1));
    if (stored) return stored;
  } catch {
    // Browser preference remains available when cookies are blocked.
  }
  return null;
}

function browserPreference(): Locale {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.map(supported).find((locale) => locale !== null) ?? 'fa';
}

function applyLocale(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
}

/** Update the current page and retain the customer's choice for later visits. */
export function setLanguagePreference(locale: Locale): void {
  applyLocale(locale);
  try {
    localStorage.setItem(preferenceKey, locale);
  } catch {
    // A blocked store must not prevent the current page from changing language.
  }
  try {
    document.cookie = `${cookieKey}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  } catch {
    // A blocked cookie must not prevent the current page from changing language.
  }
}

/** Preserve the current document language across an entry-bundle navigation. */
export function rememberEntryLocale(): void {
  try {
    const locale = document.documentElement.lang.toLowerCase().split('-')[0] === 'en' ? 'en' : 'fa';
    sessionStorage.setItem(entryKey, JSON.stringify({ locale, expires: Date.now() + 30_000 }));
  } catch {
    // Browser storage must not prevent navigation.
  }
}

/** Resolve the one-time navigation handoff, saved preference, then browser language before React renders. */
export function restoreEntryLocale(): void {
  let handoff: Locale | null = null;
  try {
    const raw = sessionStorage.getItem(entryKey);
    sessionStorage.removeItem(entryKey);
    if (raw) {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === 'object') {
        const { locale, expires } = value as Record<string, unknown>;
        if (
          typeof locale === 'string' &&
          supported(locale) &&
          typeof expires === 'number' &&
          expires > Date.now() &&
          expires <= Date.now() + 30_000
        )
          handoff = supported(locale);
      }
    }
  } catch {
    // Continue with the saved or browser preference.
  }
  applyLocale(handoff ?? savedPreference() ?? browserPreference());
}
