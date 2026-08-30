/**
 * UI helpers for the staff dueAt override form (T-04.1.03.03).
 *
 * datetime-local values are timezone-local; the API expects ISO-8601.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isInvoiceUuid(value: string): boolean {
  return UUID_RE.test(value.trim())
}

/**
 * True when the lookup field still identifies the invoice currently loaded
 * into the override form. A mismatch must discard the loaded invoice so a
 * staff member cannot override invoice A while the field shows invoice B.
 */
export function lookupMatchesLoadedInvoice(
  lookupId: string,
  loadedInvoiceId: string,
): boolean {
  return lookupId.trim() === loadedInvoiceId
}

/** Convert an ISO timestamp to a `datetime-local` input value. */
export function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Convert a `datetime-local` value to an ISO-8601 UTC string. */
export function datetimeLocalToIso(value: string): string | null {
  if (!value.trim()) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}
