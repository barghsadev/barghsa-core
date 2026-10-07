/**
 * Whether a raw persisted/parsed limit value is a valid, losslessly
 * representable IRR amount: a number, an integer, within `0`…
 * `Number.MAX_SAFE_INTEGER`.
 *
 * Shared by {@link toWalletTopUpLimitConfig} (normalization), the admin
 * service read path (corruption detection), and the enforcement guard so the
 * validation rules can never drift apart.
 */
export function isValidWalletTopUpLimit(raw: unknown): raw is number {
  return (
    typeof raw === 'number' &&
    Number.isSafeInteger(raw) &&
    raw >= 0 &&
    raw <= Number.MAX_SAFE_INTEGER
  );
}

/** PostgreSQL `bigint` / signed int8 maximum (inclusive). */
const MAX_INT8 = 9_223_372_036_854_775_807n;

/**
 * Parse a proposed online top-up amount in IRR (T-04.2.02.01).
 *
 * Accepts a positive integer as `number`, `bigint`, or a digit string.
 * Returns `null` when the value cannot be a precise positive IRR amount
 * so the initiation API can fail closed before creating a Pending row.
 */
export function parseOnlineTopUpAmountIrR(raw: unknown): bigint | null {
  if (typeof raw === 'bigint') {
    if (raw <= 0n || raw > MAX_INT8) return null;
    return raw;
  }
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw <= 0) return null;
    return BigInt(raw);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!/^[1-9][0-9]{0,18}$/.test(trimmed)) return null;
    try {
      const amount = BigInt(trimmed);
      if (amount <= 0n || amount > MAX_INT8) return null;
      return amount;
    } catch {
      return null;
    }
  }
  return null;
}
