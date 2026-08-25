import type { Locale } from '@barghsa/i18n'

/**
 * Returns the current application locale.
 *
 * Reads from `document.documentElement.lang` set by the server (e.g.
 * `<html lang="fa">`). Falls back to `'fa'` when the attribute is
 * empty or absent. This is a runtime read, not a constant — if the
 * lang attribute ever changes dynamically, the returned value reflects
 * the change on next render.
 */
export function useLocale(): Locale {
  return (document.documentElement.lang as Locale) || 'fa'
}