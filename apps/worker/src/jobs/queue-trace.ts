import { SpanKind, SpanStatusCode, type Span, type Tracer } from '@opentelemetry/api';
import { operatorLogTrace } from '@barghsa/shared/operator-logging';
import { extractTraceparent, operationTracer } from '@barghsa/shared/telemetry';

export async function withQueueTrace<T>(
  tracer: Tracer | undefined,
  name: string,
  parent: string | null,
  process: (span?: Span) => Promise<T>
): Promise<T> {
  if (!tracer) return process();
  const span = tracer.startSpan(name, { kind: SpanKind.CONSUMER }, extractTraceparent(parent));
  try {
    return await operationTracer.run(tracer, () =>
      operatorLogTrace.run(span.spanContext(), () => process(span))
    );
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}
