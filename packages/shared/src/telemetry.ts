import { ROOT_CONTEXT, SpanStatusCode, defaultTextMapGetter } from '@opentelemetry/api';
import { W3CTraceContextPropagator, hrTimeToMilliseconds } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { AlwaysOnSampler, BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { deploymentEnvironment } from './operator-logging.js';

/** Bound DNS, TLS and continuously streaming responses as well as idle requests. */
export async function collectorAgent(protocol: string, timeoutMs: number) {
  const { Agent } = protocol === 'https:' ? await import('node:https') : await import('node:http');
  const agent = new Agent({ keepAlive: false });
  const connect = agent.createConnection.bind(agent);
  agent.createConnection = (options, callback) => {
    const socket = connect(options, callback);
    if (socket) {
      const deadline = setTimeout(() => socket.destroy(), timeoutMs);
      deadline.unref();
      socket.once('close', () => clearTimeout(deadline));
    }
    return socket;
  };
  return agent;
}

const propagation = new W3CTraceContextPropagator();

export function extractTraceparent(value: unknown) {
  return typeof value === 'string' && value.length <= 512 && !value.includes(',')
    ? propagation.extract(ROOT_CONTEXT, { traceparent: value }, defaultTextMapGetter)
    : ROOT_CONTEXT;
}

export function createTraceProvider(
  serviceName: 'barghsa-api' | 'barghsa-worker'
): TracerProvider | undefined {
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
      'service.name': serviceName,
      'deployment.environment.name': deploymentEnvironment(),
    }),
    sampler: new AlwaysOnSampler(),
    spanProcessors: [
      {
        onStart() {},
        onEnd(span) {
          // Choose at completion using the local outcome. Incoming flags do not set the sample rate.
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
