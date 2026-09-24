import { DeliveryRejected } from './execution.js';

export type ProviderErrorKind = 'transient' | 'permanent' | 'unknown';

/** Classify provider outcomes without inspecting unsafe provider response text. */
export function classifyProviderError(error: unknown): ProviderErrorKind {
  if (error instanceof DeliveryRejected) return 'permanent';
  if (!error || typeof error !== 'object') return 'unknown';
  const value = error as {
    httpStatus?: unknown;
    responseCode?: unknown;
    code?: unknown;
    name?: unknown;
    cause?: unknown;
  };
  if (typeof value.httpStatus === 'number') {
    if (
      value.httpStatus === 408 ||
      value.httpStatus === 429 ||
      (value.httpStatus >= 500 && value.httpStatus < 600)
    )
      return 'transient';
    return value.httpStatus >= 400 && value.httpStatus < 500 ? 'permanent' : 'unknown';
  }
  if (typeof value.responseCode === 'number')
    return value.responseCode >= 400 && value.responseCode < 500
      ? 'transient'
      : value.responseCode >= 500 && value.responseCode < 600
        ? 'permanent'
        : 'unknown';
  if (value.name === 'TimeoutError') return 'transient';
  if (
    typeof value.code === 'string' &&
    [
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'EPIPE',
      'EAI_AGAIN',
      'ENETUNREACH',
      'EHOSTUNREACH',
    ].includes(value.code)
  )
    return 'transient';
  // Node fetch wraps network failures in a TypeError with the socket cause.
  if (value.cause && typeof value.cause === 'object') {
    const cause = value.cause as { code?: unknown };
    return typeof cause.code === 'string' &&
      [
        'ETIMEDOUT',
        'ECONNRESET',
        'ECONNREFUSED',
        'EPIPE',
        'EAI_AGAIN',
        'ENETUNREACH',
        'EHOSTUNREACH',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_SOCKET',
      ].includes(cause.code)
      ? 'transient'
      : 'unknown';
  }
  return 'unknown';
}

/** Classify provider health only; this does not authorize a delivery retry. */
export function isTransientProviderError(error: unknown): boolean {
  return classifyProviderError(error) === 'transient';
}

export const isTransientEmailError = isTransientProviderError;
