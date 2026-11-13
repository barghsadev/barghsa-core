import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type SpanOptions,
  type Tracer,
} from '@opentelemetry/api';
import { operatorLogTrace } from '@barghsa/shared/operator-logging';

export const apiOperationTracer = new AsyncLocalStorage<Tracer>();

function traceOperation<Result>(name: string, options: SpanOptions, run: () => Promise<Result>) {
  const tracer = apiOperationTracer.getStore();
  const parent = operatorLogTrace.getStore();
  if (!tracer || !parent) return run();

  const span = tracer.startSpan(name, options, trace.setSpanContext(ROOT_CONTEXT, parent));
  return operatorLogTrace.run(span.spanContext(), async () => {
    try {
      return await run();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Label a domain method with a fixed operation name. Arguments and results stay private. */
export function TraceDomainOperation(name: string) {
  return function <Service, Args extends unknown[], Result>(
    _target: object,
    _key: string | symbol,
    descriptor: TypedPropertyDescriptor<(this: Service, ...args: Args) => Promise<Result>>
  ) {
    const original = descriptor.value;
    if (!original) throw new TypeError('Domain tracing requires a method');
    descriptor.value = function (this: Service, ...args: Args) {
      return traceOperation(name, { kind: SpanKind.INTERNAL }, () => original.apply(this, args));
    };
  };
}

export function traceNotificationOutboxInsert<Result>(run: () => Promise<Result>) {
  return traceOperation(
    'notification.outbox.insert',
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system.name': 'postgresql',
        'db.operation.name': 'INSERT',
        'db.collection.name': 'notification_outbox',
      },
    },
    run
  );
}

export function traceAiInferenceRequest<Result>(run: () => Promise<Result>) {
  return traceOperation('ai.inference.request', { kind: SpanKind.CLIENT }, run);
}
