import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * AsyncLocalStorage instance for retrieving the current request's correlation ID
 * anywhere in the request lifecycle without passing it through the call chain.
 */
export const correlationIdStorage = new AsyncLocalStorage<string>();

/**
 * Injectable provider that reads the current correlation ID from AsyncLocalStorage.
 * Use this in services, interceptors, and filters to get the correlation ID.
 */
@Injectable()
export class CorrelationIdProvider {
  getCorrelationId(): string | undefined {
    return correlationIdStorage.getStore();
  }
}

/**
 * Middleware that generates or propagates a UUIDv7-style correlation ID per request.
 *
 * - Reads `X-Correlation-ID` from the incoming request if present (for distributed tracing)
 * - Generates a new UUID otherwise
 * - Stores in `AsyncLocalStorage` for downstream access via `CorrelationIdProvider`
 * - Sets the `X-Correlation-ID` response header
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId =
      (req.headers['x-correlation-id'] as string) ?? randomUUID();

    // Store in AsyncLocalStorage so any downstream code can retrieve it
    correlationIdStorage.run(correlationId, () => {
      res.setHeader('X-Correlation-ID', correlationId);
      next();
    });
  }
}