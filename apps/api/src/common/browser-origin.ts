import type { IncomingHttpHeaders } from 'node:http';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';

function originOf(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.username || url.password) return;
    if (
      url.protocol === 'https:' ||
      (process.env.NODE_ENV !== 'production' && url.protocol === 'http:')
    )
      return url.origin;
  } catch {
    // Invalid configuration or a malformed Referer supplies no trusted origin.
  }
  return undefined;
}

export function acceptsBrowserOrigin(
  headers: Pick<IncomingHttpHeaders, 'origin' | 'referer'>
): boolean {
  // Requests without either header must still pass their existing token check.
  if (headers.origin === undefined && headers.referer === undefined) return true;
  const trusted = originOf(process.env.APP_PUBLIC_URL);
  return trusted !== undefined && (headers.origin ?? originOf(headers.referer)) === trusted;
}

export function browserCorsOptions(): CorsOptions {
  const trusted = originOf(process.env.APP_PUBLIC_URL);
  return {
    origin: (origin, callback) => callback(null, trusted !== undefined && origin === trusted),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'X-Draft-Revision'],
    exposedHeaders: ['X-Correlation-Id', 'X-Has-Next-Page', 'Retry-After'],
    maxAge: 3600,
  };
}
