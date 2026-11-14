import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import {
  AlwaysOnSampler,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deploymentEnvironment } from './environment.js';
import {
  createTraceProvider,
  extractTraceparent,
  observeStaticRequest,
  operationTracer,
  startPostgresSpan,
} from './index.js';

const traceId = '1234567890abcdef1234567890abcdef';
const parentSpanId = 'fedcba0987654321';
const traceparent = `00-${traceId}-${parentSpanId}-01`;

afterEach(() => vi.unstubAllEnvs());

describe('deployment environment', () => {
  it.each([
    ['staging', 'production', 'staging'],
    ['development', 'production', 'development'],
    [undefined, 'test', 'test'],
    [undefined, undefined, 'development'],
    ['unknown', 'development', 'production'],
  ])('resolves %s with NODE_ENV %s', (explicit, fallback, expected) => {
    vi.stubEnv('BARGHSA_DEPLOYMENT_ENV', explicit);
    vi.stubEnv('NODE_ENV', fallback);
    expect(deploymentEnvironment()).toBe(expected);
  });
});

describe('trace propagation', () => {
  it('accepts one valid parent and discards ambiguous, invalid and oversized headers', () => {
    expect(trace.getSpanContext(extractTraceparent(traceparent))).toMatchObject({
      traceId,
      spanId: parentSpanId,
    });
    for (const value of [
      undefined,
      [traceparent],
      'not-a-trace',
      `${traceparent},${traceparent}`,
      traceparent.padEnd(513),
    ]) {
      expect(trace.getSpanContext(extractTraceparent(value))).toBeUndefined();
    }
  });

  it('records a PostgreSQL failure under the incoming parent without query details', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter })],
    });
    try {
      expect(startPostgresSpan(traceparent)).toBeUndefined();
      operationTracer.run(provider.getTracer('fixture'), () => {
        startPostgresSpan(traceparent)?.(true);
        startPostgresSpan(traceparent)?.(false);
      });
      expect(exporter.getFinishedSpans()).toMatchObject([
        {
          name: 'postgresql.query',
          kind: SpanKind.CLIENT,
          parentSpanContext: { spanId: parentSpanId },
          attributes: { 'db.system.name': 'postgresql' },
          status: { code: SpanStatusCode.ERROR },
        },
        { name: 'postgresql.query', status: { code: SpanStatusCode.UNSET } },
      ]);
      expect(exporter.getFinishedSpans()[0]?.attributes).toEqual({
        'db.system.name': 'postgresql',
      });
    } finally {
      await provider.shutdown();
    }
  });

  it.each([
    ['GET', 200, true, true, 'finish', 'GET', false],
    ['HEAD', 408, true, true, 'finish', 'HEAD', true],
    ['POST', 502, true, true, 'finish', '_OTHER', true],
    ['GET', 200, false, false, 'close', 'GET', true],
  ])(
    'ends one static request span for %s %d (%s, %s, %s)',
    async (method, statusCode, headersSent, writableFinished, event, label, failed) => {
      const exporter = new InMemorySpanExporter();
      const provider = new TracerProvider({
        sampler: new AlwaysOnSampler(),
        spanProcessors: [new SimpleSpanProcessor({ exporter })],
      });
      const request = { method, headers: { traceparent } } as IncomingMessage;
      const response = Object.assign(new EventEmitter(), {
        statusCode,
        headersSent,
        writableFinished,
      });
      const onFailure = vi.fn();
      try {
        observeStaticRequest(
          provider.getTracer('fixture'),
          request,
          response as unknown as ServerResponse,
          onFailure
        );
        response.emit(event);
        response.emit('finish');
        response.emit('close');
        const [span] = exporter.getFinishedSpans();
        expect(exporter.getFinishedSpans()).toHaveLength(1);
        expect(span).toMatchObject({
          name: `HTTP ${label}`,
          kind: SpanKind.SERVER,
          parentSpanContext: { spanId: parentSpanId },
          status: { code: failed ? SpanStatusCode.ERROR : SpanStatusCode.UNSET },
        });
        expect(span?.attributes).toEqual({
          'http.request.method': label,
          ...(headersSent ? { 'http.response.status_code': statusCode } : {}),
        });
        expect(onFailure.mock.calls).toEqual(failed ? [[traceId, span?.spanContext().spanId]] : []);
      } finally {
        await provider.shutdown();
      }
    }
  );
});

describe('trace exporter', () => {
  it.each([
    ['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'incomplete', 'endpoint'],
    ['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'file:///tmp/fixture', 'endpoint'],
    ['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'https://fixture@collector.test/v1/traces', 'endpoint'],
    ['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'https://:fixture@collector.test/v1/traces', 'endpoint'],
    ['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'https://collector.test/v1/traces#fragment', 'endpoint'],
    ['OTEL_EXPORTER_OTLP_TRACES_TIMEOUT', '100.5', 'timeout'],
    ['OTEL_EXPORTER_OTLP_TRACES_TIMEOUT', '99', 'timeout'],
    ['OTEL_EXPORTER_OTLP_TRACES_TIMEOUT', '5001', 'timeout'],
    ['OTEL_TRACE_SUCCESS_SAMPLE_RATE', 'NaN', 'sample rate'],
    ['OTEL_TRACE_SUCCESS_SAMPLE_RATE', '-0.1', 'sample rate'],
    ['OTEL_TRACE_SUCCESS_SAMPLE_RATE', '1.1', 'sample rate'],
  ])('rejects invalid %s (%s)', (key, value, error) => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'https://collector.test/v1/traces');
    vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_TIMEOUT', undefined);
    vi.stubEnv('OTEL_TRACE_SUCCESS_SAMPLE_RATE', undefined);
    vi.stubEnv(key, value);
    expect(() => createTraceProvider('barghsa-web')).toThrow(`Invalid OTLP traces ${error}`);
  });

  it('keeps tracing disabled without an endpoint', () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', ' ');
    expect(createTraceProvider('barghsa-web')).toBeUndefined();
  });

  it.each([0, 1])(
    'exports errors and slow spans with success sample rate %d',
    async (sampleRate) => {
      const requests: { method: string | undefined; url: string | undefined; size: number }[] = [];
      const collector = createServer((request, response) => {
        let size = 0;
        request.on('data', (chunk: Buffer) => {
          size += chunk.length;
        });
        request.once('end', () => {
          requests.push({ method: request.method, url: request.url, size });
          response.end();
        });
      });
      await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
      const address = collector.address();
      if (!address || typeof address === 'string') throw new Error('Fixture requires TCP');
      vi.stubEnv(
        'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
        `http://127.0.0.1:${address.port}/v1/traces`
      );
      vi.stubEnv('OTEL_EXPORTER_OTLP_TRACES_TIMEOUT', undefined);
      vi.stubEnv('OTEL_TRACE_SUCCESS_SAMPLE_RATE', String(sampleRate));
      const provider = createTraceProvider('barghsa-web')!;
      try {
        const tracer = provider.getTracer('fixture');
        tracer.startSpan('successful', {}, extractTraceparent(traceparent)).end();
        await provider.forceFlush();
        expect(requests).toHaveLength(sampleRate);
        tracer.startSpan('failed').setStatus({ code: SpanStatusCode.ERROR }).end();
        await provider.forceFlush();
        tracer
          .startSpan('slow', { startTime: performance.timeOrigin + performance.now() - 600 })
          .end();
        await provider.forceFlush();
        expect(requests).toHaveLength(sampleRate + 2);
        for (const request of requests) {
          expect(request).toMatchObject({ method: 'POST', url: '/v1/traces' });
          expect(request.size).toBeGreaterThan(0);
        }
      } finally {
        try {
          await provider.shutdown();
        } finally {
          await new Promise<void>((resolve, reject) =>
            collector.close((error) => (error ? reject(error) : resolve()))
          );
        }
      }
    }
  );
});
