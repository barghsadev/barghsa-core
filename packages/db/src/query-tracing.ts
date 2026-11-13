import type { Client } from 'pg';
import { currentTraceparent } from '@barghsa/shared/operator-logging';
import { startPostgresSpan } from '@barghsa/shared/telemetry';

/** Observe one application query, including any transaction-pool work it needs. */
export function traceClientQueries(query: Client['query'], client: Client): Client['query'] {
  return ((...args: unknown[]) => {
    const parent = currentTraceparent();
    if (!parent) return Reflect.apply(query, client, args);
    const first = args[0] as
      string | { text?: unknown; submit?: unknown; callback?: unknown } | null;
    const config = first && typeof first === 'object' ? first : undefined;
    const callbackIndex = args.findIndex((value) => typeof value === 'function');
    // Leave custom Submittables and callbacks embedded in driver config to pg.
    if (
      (typeof first !== 'string' && typeof config?.text !== 'string') ||
      typeof config?.submit === 'function' ||
      (callbackIndex < 0 && config?.callback)
    )
      return Reflect.apply(query, client, args);
    const finish = startPostgresSpan(parent);
    if (!finish) return Reflect.apply(query, client, args);

    if (callbackIndex >= 0) {
      const callback = args[callbackIndex] as (...values: unknown[]) => void;
      args[callbackIndex] = function (this: unknown, ...values: unknown[]) {
        finish(Boolean(values[0]));
        Reflect.apply(callback, this, values);
      };
    }
    try {
      const result = Reflect.apply(query, client, args);
      if (callbackIndex >= 0) return result;
      if (!result || typeof result.then !== 'function') {
        finish(false);
        return result;
      }
      return (result as Promise<unknown>).then(
        (value) => {
          finish(false);
          return value;
        },
        (error: unknown) => {
          finish(true);
          throw error;
        }
      );
    } catch (error) {
      finish(true);
      throw error;
    }
  }) as Client['query'];
}
