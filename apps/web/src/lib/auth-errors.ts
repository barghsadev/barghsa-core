import { t, type Locale } from '@barghsa/i18n/auth';

export function authErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('error' in body)) return undefined;
  const error = body.error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string')
    return error.code;
  return undefined;
}

export function retryAfterSeconds(response: Pick<Response, 'headers'>): number | null {
  const value = response.headers.get('Retry-After')?.trim();
  if (!value) return null;
  const seconds = /^\d+(?:\.\d+)?$/.test(value)
    ? Number(value)
    : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 31 * 86400
    ? Math.max(1, Math.ceil(seconds))
    : null;
}

export function rateLimitMessage(
  response: Pick<Response, 'status' | 'headers'>,
  locale: Locale
): string | null {
  if (response.status !== 429) return null;
  const seconds = retryAfterSeconds(response);
  return seconds === null
    ? t('error.rate_limit.exceeded', locale)
    : t('error.rate_limit.retry_after', locale).replace(
        '{seconds}',
        new Intl.NumberFormat(locale, { useGrouping: false }).format(seconds)
      );
}
