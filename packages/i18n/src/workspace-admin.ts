import { lookup } from './lookup.js';
import { fa, en } from './workspace-admin-messages.js';
import { tWorkspace as workspaceText } from './workspace-crm.js';
import type { Locale } from './app.js';
export type { Locale } from './app.js';

export function tWorkspace(key: string, locale: Locale = 'fa'): string {
  return lookup(locale === 'fa' ? fa : en, key) ?? lookup(en, key) ?? workspaceText(key, locale);
}
