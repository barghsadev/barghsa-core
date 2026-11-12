import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { deploymentEnvironment } from '@barghsa/shared/operator-logging';
import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  defaultTextMapGetter,
  type SpanContext,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator, hrTimeToMilliseconds } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { AlwaysOnSampler, BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import type { RequestHandler } from 'express';
import { collectorAgent } from './otlp-http-agent.js';

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
const propagation = new W3CTraceContextPropagator();

export const apiRequestTrace = new AsyncLocalStorage<Pick<SpanContext, 'traceId' | 'spanId'>>();

function createProvider(): TracerProvider | undefined {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (!endpoint) return undefined;
  const url = URL.parse(endpoint);
  if (
    !url ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('Invalid OTLP traces endpoint');

  const timeoutMs = Number(process.env.OTEL_EXPORTER_OTLP_TRACES_TIMEOUT || '2000');
  const sampleRate = Number(process.env.OTEL_TRACE_SUCCESS_SAMPLE_RATE || '0.1');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000)
    throw new Error('Invalid OTLP traces timeout');
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1)
    throw new Error('Invalid OTLP traces sample rate');

  const exporter = new OTLPTraceExporter({
    url: url.toString(),
    timeoutMillis: timeoutMs,
    concurrencyLimit: 1,
    httpAgentOptions: (protocol) => collectorAgent(protocol, timeoutMs),
  });
  const batch = new BatchSpanProcessor({
    exporter,
    scheduledDelayMillis: 1000,
    exportTimeoutMillis: timeoutMs,
    maxQueueSize: 512,
    maxExportBatchSize: 512,
  });
  return new TracerProvider({
    resource: resourceFromAttributes({
      'service.name': 'barghsa-api',
      'deployment.environment.name': deploymentEnvironment(),
    }),
    sampler: new AlwaysOnSampler(),
    spanProcessors: [
      {
        onStart() {},
        onEnd(span) {
          // Select completed API server spans using local outcomes and randomness.
          // A caller's trace ID or sampled flag cannot force routine export.
          if (
            span.status.code === SpanStatusCode.ERROR ||
            hrTimeToMilliseconds(span.duration) > 500 ||
            Math.random() < sampleRate
          )
            batch.onEnd(span);
        },
        forceFlush: () => batch.forceFlush(),
        shutdown: () => batch.shutdown(),
      },
    ],
  });
}

@Injectable()
export class ApiRequestTracing implements OnApplicationShutdown {
  private readonly logger = new Logger(ApiRequestTracing.name);
  private readonly provider = createProvider();
  private readonly tracer = this.provider?.getTracer('barghsa.api.http');

  readonly observe: RequestHandler = (request, response, next) => {
    if (!this.tracer) return next();
    const traceparent = request.headers.traceparent;
    const parent =
      typeof traceparent === 'string' && traceparent.length <= 512 && !traceparent.includes(',')
        ? propagation.extract(ROOT_CONTEXT, { traceparent }, defaultTextMapGetter)
        : ROOT_CONTEXT;
    const method = methods.has(request.method) ? request.method : '_OTHER';
    const span = this.tracer.startSpan(
      `HTTP ${method}`,
      {
        kind: SpanKind.SERVER,
        attributes: { 'http.request.method': method },
      },
      parent
    );
    const { traceId, spanId } = span.spanContext();
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
    apiRequestTrace.run({ traceId, spanId }, next);
  };

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.provider?.shutdown();
    } catch {
      this.logger.warn('OpenTelemetry traces shutdown did not complete');
    }
  }
}
