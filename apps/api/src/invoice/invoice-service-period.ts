/** Read only the immutable electricity service period saved on an invoice. */
export function electricityInvoicePeriod(
  snapshot: unknown
): { periodStart: string; periodEnd: string } | null {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const value = snapshot as Record<string, unknown>;
  if (
    value.schemaVersion !== 1 ||
    typeof value.totalKwh !== 'string' ||
    typeof value.periodStart !== 'string' ||
    typeof value.periodEnd !== 'string'
  ) {
    return null;
  }
  const start = new Date(value.periodStart);
  const end = new Date(value.periodEnd);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return null;
  }
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}
