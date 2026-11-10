/**
 * UI helpers for the staff bank-receipt confirmation queue (T-04.2.02.04).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTransactionUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}
