import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { operatorLogTrace } from '@barghsa/shared/operator-logging';
import { createTraceProvider, extractTraceparent } from '@barghsa/shared/telemetry';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { RequestHandler } from 'express';
import { apiOperationTracer } from './domain-tracing.js';

const methods = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'CONNECT',
  'TRACE',
]);
const routes = /^\/api(?:\/[a-z0-9_.:-]+)*\/?$/i;

@Injectable()
export class ApiRequestTracing implements OnApplicationShutdown {
  private readonly logger = new Logger(ApiRequestTracing.name);
  private readonly provider = createTraceProvider('barghsa-api');
  private readonly tracer = this.provider?.getTracer('barghsa.api.http');

  readonly observe: RequestHandler = (request, response, next) => {
    if (!this.tracer) return next();
    const parent = extractTraceparent(request.headers.traceparent);
    const method = methods.has(request.method) ? request.method : '_OTHER';
    const span = this.tracer.startSpan(
      `HTTP ${method}`,
      {
        kind: SpanKind.SERVER,
        attributes: { 'http.request.method': method },
      },
      parent
    );
    let ended = false;
    const finish = (interrupted: boolean) => {
      if (ended) return;
      ended = true;
      const route: unknown = request.route?.path;
      if (typeof route === 'string' && route.length <= 160 && routes.test(route)) {
        span.updateName(`${method} ${route}`);
        span.setAttribute('http.route', route);
      }
      if (response.headersSent) span.setAttribute('http.response.status_code', response.statusCode);
      if (interrupted || response.statusCode >= 500 || response.statusCode === 408)
        span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    };
    response.once('finish', () => finish(false));
    response.once('close', () => finish(!response.writableFinished));
    apiOperationTracer.run(this.tracer, () => operatorLogTrace.run(span.spanContext(), next));
  };

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.provider?.shutdown();
    } catch {
      this.logger.warn('OpenTelemetry traces shutdown did not complete');
    }
  }
}
