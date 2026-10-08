import { fa, en } from './crm-messages.js';
export { fa, en } from './crm-messages.js';
import { lookup } from './lookup.js';
import { t as sharedText, type Locale } from './index.js';
export type { Locale } from './index.js';
export function t(key: string, locale: Locale = 'fa'): string {
  return lookup(locale === 'fa' ? fa : en, key) ?? lookup(en, key) ?? sharedText(key, locale);
}

/** Startup consumers need CRM and workspace messages without the full catalogue. */
