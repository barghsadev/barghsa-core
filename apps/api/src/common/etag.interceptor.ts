import { createHash } from 'node:crypto';
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';

/**
 * Metadata key used to mark controller methods that should have ETag
 * processing applied. Controllers decorated with `@Etag()` will have
 * their safe GET responses cached via ETag / 304 negotiation.
 */
export const ETAG_METADATA = 'etag';

/**
 * Decorator that marks a route or controller as eligible for ETag
 * processing. Only GET requests are affected; other methods pass
 * through untouched.
 *
 * @example
 * ```typescript
 * @Controller('products')
 * export class ProductsController {
 *   @Get()
 *   @Etag()
 *   findAll(): Product[] { … }
 * }
 * ```
 */
export const Etag = () => SetMetadata(ETAG_METADATA, true);

/**
 * Interceptor that computes an ETag (SHA-256 of the JSON response body)
 * for safe, read-only metadata endpoints. When the client sends an
 * `If-None-Match` header matching the computed hash, the interceptor
 * short-circuits with a `304 Not Modified` response and an empty body.
 *
 * Usage — wire as a global interceptor in `main.ts` and tag endpoints
 * with the `@Etag()` decorator:
 *
 * ```typescript
 * app.useGlobalInterceptors(new EtagInterceptor(app.get(Reflector)));
 * ```
 *
 * **ETags are for bandwidth reduction on safe data only.**
 * They must **never** be used for:
 * - Authenticated profile-scoped data
 * - Financial or billing data
 * - Rapidly changing / real-time data
 *
 * See also `CacheControlInterceptor` which sets `private, no-cache` headers
 * for all API responses.
 */
@Injectable()
export class EtagInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();

    // Only process GET requests
    if (request.method !== 'GET') {
      return next.handle();
    }

    // Only process handlers decorated with @Etag()
    const etagEnabled =
      this.reflector.getAllAndOverride<boolean>(ETAG_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]);

    if (!etagEnabled) {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse();

    return next.handle().pipe(
      map((body) => {
        const payload = JSON.stringify(body);
        const hash = createHash('sha256').update(payload).digest('base64');
        const etag = `"${hash}"`;

        response.setHeader('ETag', etag);

        const ifNoneMatch = request.headers['if-none-match'];

        if (ifNoneMatch === etag) {
          response.status(304);
          return null;
        }

        return body;
      }),
    );
  }
}