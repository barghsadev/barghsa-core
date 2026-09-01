/**
 * UI helpers for the staff bank-receipt confirmation queue (T-04.2.02.04).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isTransactionUuid(value: string): boolean {
  return UUID_RE.test(value.trim())
}

export function isImageAttachment(key: string | null | undefined): boolean {
  if (!key) return false
  return /\.(jpg|jpeg|png|webp)$/i.test(key)
}

export function isPdfAttachment(key: string | null | undefined): boolean {
  if (!key) return false
  return /\.pdf$/i.test(key)
}
