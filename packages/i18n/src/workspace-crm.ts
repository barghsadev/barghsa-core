import { lookup } from './lookup.js';
import { fa, en } from './crm-messages.js';
import { t as workspaceText } from './workspace.js';
import type { Locale } from './app.js';
export type { Locale } from './app.js';

export function tWorkspace(key: string, locale: Locale = 'fa'): string {
  return lookup(locale === 'fa' ? fa : en, key) ?? lookup(en, key) ?? workspaceText(key, locale);
}
