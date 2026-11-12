import { workerLog } from './operator-log.js';

/** Delivery diagnostics contain identifiers and outcomes, never message bodies or provider errors. */
export function logDelivery(
  event: 'notification.attempt' | 'auth.delivery' | 'ai.model_test',
  outboxId: string,
  correlationId: string | null | undefined,
  status: string,
  channel?: string
): void {
  const failed = ['failed', 'dead', 'retry', 'stale'].includes(status);
  workerLog(failed ? 'warn' : 'info', 'Delivery outcome', {
    event,
    outboxId,
    correlationId,
    status,
    ...(channel ? { channel } : {}),
  });
}
