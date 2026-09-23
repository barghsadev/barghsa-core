import { t, type Locale } from '@barghsa/i18n/app';
import { formatNumber } from '@barghsa/i18n/numbers';

const productKeys = new Set(['thermal', 'green', 'free_market', 'energy_saving']);

export class ElectricityQuotePreviewError extends Error {}

function positiveKwh(value: unknown): bigint | null {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? BigInt(value) : null;
}

/** Translate only known composition errors; never show arbitrary server text to customers. */
export async function electricityQuoteError(response: Response, locale: Locale): Promise<string> {
  const fallback = t('electricity.order.previewUnavailable', locale);
  if (response.status !== 400) return fallback;

  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('error' in body) || !('details' in body))
    return fallback;
  if (body.error !== 'ELECTRICITY_QUOTE_INVALID' || !Array.isArray(body.details)) return fallback;

  for (const detail of body.details) {
    if (!detail || typeof detail !== 'object' || !productKeys.has(detail.systemKey)) continue;
    const product = t(`electricity.catalogue.${detail.systemKey}`, locale);
    const required = positiveKwh(detail.requiredKwh);
    if (detail.code === 'PRODUCT_MAX_KWH') {
      const limit = positiveKwh(detail.limitKwh);
      if (required === null || limit === null) continue;
      return t('electricity.order.productMaxConflict', locale)
        .replace('{product}', product)
        .replace('{required}', formatNumber(required, locale))
        .replace('{limit}', formatNumber(limit, locale));
    }
    if (detail.code === 'PRODUCT_MIN_KWH' && required !== null) {
      return t('electricity.order.productMinConflict', locale)
        .replace('{product}', product)
        .replace('{minimum}', formatNumber(required, locale));
    }
  }
  return fallback;
}
