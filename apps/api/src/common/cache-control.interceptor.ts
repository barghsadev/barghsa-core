import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';

// Paths where cache-control headers should NOT be overridden
const PUBLIC_PATHS = ['/api/docs', '/api/docs-json', '/api/docs-static'];

@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Skip interception for Swagger UI static asset paths
    if (PUBLIC_PATHS.some((p) => request.url?.startsWith(p))) {
      return next.handle();
    }

    // All API responses should not be cached by CDN or intermediate proxies
    response.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');

    return next.handle();
  }
}