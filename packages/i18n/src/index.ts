import { lookup } from './lookup.js';
import type { I18nDictionary, Locale } from './app.js';
import { english, type MessageKey } from './locales/en.js';
import { persian } from './locales/fa.js';
export type { I18nDictionary, Locale } from './app.js';
export type { MessageKey } from './locales/en.js';

/** Backward-compatible dictionaries containing application and authentication messages. */
export const fa: I18nDictionary = persian;
export const en: I18nDictionary = english;
export const dictionaries: Record<Locale, I18nDictionary> = { fa, en };

/** Create a typed snapshot with English fallback for missing Persian messages. */
export function createI18n(locale: Locale = 'fa'): Readonly<Record<MessageKey, string>> {
  const messages = { ...english, ...(locale === 'fa' ? persian : {}) };
  Object.setPrototypeOf(messages, null);
  return Object.freeze(messages);
}

/** Resolve a message, falling back to English and then the literal key. */
export function t(key: string, locale: Locale = 'fa'): string {
  return lookup(locale === 'fa' ? fa : en, key) ?? lookup(dictionaries.en, key) ?? key;
}
