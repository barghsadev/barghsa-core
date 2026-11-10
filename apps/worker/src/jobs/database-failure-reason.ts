const knownFailures = new Map([
  ['40001', 'serialization failure'],
  ['40P01', 'deadlock'],
  ['55P03', 'lock unavailable'],
  ['57014', 'query cancelled'],
]);

/** Report a known SQLSTATE without logging database error text or detail. */
export function databaseFailureReason(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  return knownFailures.get(code ?? '') ?? 'database operation failed';
}
