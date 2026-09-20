import { lookup } from './lookup.js';
import { fa as appFA, en as appEN } from './app.js';
import { fa as authFA, en as authEN } from './auth.js';
import type { I18nDictionary, Locale } from './app.js';
export type { I18nDictionary, Locale } from './app.js';

/** Backward-compatible dictionaries containing application and authentication messages. */
export const fa: I18nDictionary = { ...authFA, ...appFA };
export const en: I18nDictionary = { ...authEN, ...appEN };
export const dictionaries: Record<Locale, I18nDictionary> = { fa, en };

/** Resolve a message, falling back to English and then the literal key. */
export function t(key: string, locale: Locale = 'fa'): string {
  return lookup(locale === 'fa' ? fa : en, key) ?? lookup(dictionaries.en, key) ?? key;
}
