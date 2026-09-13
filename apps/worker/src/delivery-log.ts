/** Delivery diagnostics contain identifiers and outcomes, never message bodies or provider errors. */
export function logDelivery(
  event: 'notification.attempt' | 'auth.delivery' | 'ai.model_test',
  outboxId: string,
  correlationId: string | null | undefined,
  status: string,
  channel?: string
): void {
  console.info(
    JSON.stringify({
      event,
      outboxId,
      correlationId: correlationId ?? null,
      status,
      ...(channel ? { channel } : {}),
    })
  );
}
