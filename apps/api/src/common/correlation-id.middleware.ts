import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v7 as uuidv7 } from 'uuid';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Validates that an inbound correlation ID is a well-formed UUID.
 * Falls back to generating a new UUIDv7 if the header value is invalid.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateCorrelationId(id: string): boolean {
  return UUID_PATTERN.test(id) && id.length <= 128;
}

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
 * Middleware that generates or propagates a UUIDv7 correlation ID per request.
 *
 * - Reads `X-Correlation-ID` from the incoming request if present and valid
 * - Generates a new UUIDv7 otherwise
 * - Stores in `AsyncLocalStorage` for downstream access via `CorrelationIdProvider`
 * - Sets the `X-Correlation-ID` response header
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inboundId = req.headers['x-correlation-id'] as string | undefined;
    const correlationId =
      inboundId !== undefined && validateCorrelationId(inboundId)
        ? inboundId
        : uuidv7();

    // Store in AsyncLocalStorage so any downstream code can retrieve it
    correlationIdStorage.run(correlationId, () => {
      res.setHeader('X-Correlation-ID', correlationId);
      next();
    });
  }
}