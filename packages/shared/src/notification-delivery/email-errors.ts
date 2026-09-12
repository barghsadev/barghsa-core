/** Classify provider health only; this does not authorize a delivery retry. */
export function isTransientEmailError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as {
    httpStatus?: unknown;
    responseCode?: unknown;
    code?: unknown;
    name?: unknown;
    cause?: unknown;
  };
  if (typeof value.httpStatus === 'number')
    return (
      value.httpStatus === 408 ||
      value.httpStatus === 429 ||
      (value.httpStatus >= 500 && value.httpStatus < 600)
    );
  if (typeof value.responseCode === 'number')
    return value.responseCode >= 400 && value.responseCode < 500;
  if (value.name === 'TimeoutError') return true;
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
    return true;
  // Node fetch wraps network failures in a TypeError with the socket cause.
  if (value.cause && typeof value.cause === 'object') {
    const cause = value.cause as { code?: unknown };
    return (
      typeof cause.code === 'string' &&
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
    );
  }
  return false;
}
