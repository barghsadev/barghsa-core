import { fa, en } from './admin-ui-messages.js';
export { fa, en } from './admin-ui-messages.js';
import { lookup } from './lookup.js';
import type { Locale } from './index.js';
import { t as sharedText } from './crm.js';
export type { Locale } from './index.js';
export function t(key: string, locale: Locale = 'fa'): string {
  return lookup(locale === 'fa' ? fa : en, key) ?? lookup(en, key) ?? sharedText(key, locale);
}

/** Keep the complete legacy fallback available through t for other consumers. */
