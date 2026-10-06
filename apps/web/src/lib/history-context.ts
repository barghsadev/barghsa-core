import { t } from '@barghsa/i18n/app';
import type { Locale } from '@barghsa/i18n';

/** Missing historical provenance must never be inferred from current account roles. */
export function historyContextText(value: unknown, locale: Locale): string {
  const context = value === 'staff' || value === 'customer' ? value : 'unknown';
  return t(`history.context.${context}`, locale);
}
