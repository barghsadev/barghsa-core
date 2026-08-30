/**
 * Staff `dueAt` override contract (T-04.1.03.03).
 *
 * S-04.1.03: staff may replace an invoice due date when they hold the
 * explicit override permission and supply a customer-visible reason.
 * The reason is stored on the invoice metadata snapshot and in the
 * append-only audit log.
 *
 * Instant resolution (`issuedAt + config_days`, staff override
 * precedence) lives in `due-at.ts`. This module owns the override
 * input: datetime + required reason, overridable invoice states, and
 * the metadata snapshot shape.
 *
 * @module finance
 */

/** Canonical audit event for a staff due-date override. */
export const DUE_AT_OVERRIDE_EVENT = 'invoice.due_at.override' as const

/** Capability gate documented on the staff API (mapped to isAdmin today). */
export const DUE_AT_OVERRIDE_PERMISSION = 'admin:finance:invoices:override-due-at' as const

/** Minimum trimmed length of the customer-visible reason. */
export const DUE_AT_OVERRIDE_REASON_MIN_LENGTH = 1

/** Maximum trimmed length of the customer-visible reason. */
export const DUE_AT_OVERRIDE_REASON_MAX_LENGTH = 2000

/**
 * Invoice states in which `dueAt` may still be overridden.
 *
 * Payable (or soon-to-be-payable) invoices keep an operational due
 * date. Terminal / settled states do not.
 */
export const DUE_AT_OVERRIDEABLE_STATES = [
  'Unpaid',
  'PaymentUnderReview',
  'PartiallyFunded',
  'Overdue',
] as const

export type DueAtOverrideableState = (typeof DUE_AT_OVERRIDEABLE_STATES)[number]

/** Error messages for the staff override surface. */
export const DUE_AT_OVERRIDE_ERRORS = {
  BAD_DUE_AT: () => 'dueAt must be a valid ISO-8601 datetime',
  BAD_REASON: () =>
    `reason is required (${DUE_AT_OVERRIDE_REASON_MIN_LENGTH}–${DUE_AT_OVERRIDE_REASON_MAX_LENGTH} characters) and is customer-visible`,
  STATE_NOT_OVERRIDEABLE: (state: string) =>
    `dueAt cannot be overridden while the invoice is ${state}`,
  BEFORE_ISSUED_AT: () => 'dueAt must be on or after issuedAt',
  UNCHANGED: () => 'dueAt is unchanged',
} as const

/** Whether an invoice state still accepts a staff due-date override. */
export function isDueAtOverrideableState(
  state: string,
): state is DueAtOverrideableState {
  return (DUE_AT_OVERRIDEABLE_STATES as readonly string[]).includes(state)
}

/** Parsed override input after validation. */
export interface ParsedDueAtOverride {
  dueAt: Date
  /** Trimmed customer-visible reason. */
  reason: string
}

/** Latest (or historical) dueAt override recorded on invoice metadata. */
export interface InvoiceDueAtOverrideSnapshot {
  dueAt: string
  previousDueAt: string | null
  reason: string
  actorUserId: string
  overriddenAt: string
  customerVisible: true
}

function parseIsoDate(raw: unknown): Date | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function parseReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const reason = raw.trim()
  if (
    reason.length < DUE_AT_OVERRIDE_REASON_MIN_LENGTH ||
    reason.length > DUE_AT_OVERRIDE_REASON_MAX_LENGTH
  ) {
    return null
  }
  return reason
}

/**
 * Parse a staff override body (`dueAt` + required `reason`).
 *
 * Accepts camelCase (`dueAt`) or snake_case (`due_at`) so the admin
 * wire shape matches the rest of the finance config surface.
 */
export function parseDueAtOverrideBody(
  raw: unknown,
): { ok: true; value: ParsedDueAtOverride } | { ok: false; issues: string[] } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, issues: [DUE_AT_OVERRIDE_ERRORS.BAD_DUE_AT(), DUE_AT_OVERRIDE_ERRORS.BAD_REASON()] }
  }
  const body = raw as Record<string, unknown>
  const issues: string[] = []

  const dueAt = parseIsoDate(body.dueAt ?? body.due_at)
  if (dueAt === null) issues.push(DUE_AT_OVERRIDE_ERRORS.BAD_DUE_AT())

  const reason = parseReason(body.reason)
  if (reason === null) issues.push(DUE_AT_OVERRIDE_ERRORS.BAD_REASON())

  if (issues.length > 0 || dueAt === null || reason === null) {
    return { ok: false, issues }
  }
  return { ok: true, value: { dueAt, reason } }
}

/**
 * Build the invoice-metadata snapshot for one staff override.
 *
 * `customerVisible` is always true — the reason is shown to the
 * customer (S-04.1.03).
 */
export function buildDueAtOverrideSnapshot(input: {
  dueAt: Date
  previousDueAt: Date | null
  reason: string
  actorUserId: string
  overriddenAt: Date
}): InvoiceDueAtOverrideSnapshot {
  return {
    dueAt: input.dueAt.toISOString(),
    previousDueAt: input.previousDueAt ? input.previousDueAt.toISOString() : null,
    reason: input.reason,
    actorUserId: input.actorUserId,
    overriddenAt: input.overriddenAt.toISOString(),
    customerVisible: true,
  }
}

/**
 * Read the latest override snapshot from invoice metadata, if present.
 */
export function readDueAtOverrideSnapshot(
  metadata: unknown,
): InvoiceDueAtOverrideSnapshot | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }
  const raw = (metadata as Record<string, unknown>).dueAtOverride
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const rec = raw as Record<string, unknown>
  if (
    typeof rec.dueAt !== 'string' ||
    typeof rec.reason !== 'string' ||
    typeof rec.actorUserId !== 'string' ||
    typeof rec.overriddenAt !== 'string' ||
    rec.customerVisible !== true
  ) {
    return null
  }
  const previousDueAt =
    rec.previousDueAt === null || typeof rec.previousDueAt === 'string'
      ? (rec.previousDueAt as string | null)
      : null
  return {
    dueAt: rec.dueAt,
    previousDueAt,
    reason: rec.reason,
    actorUserId: rec.actorUserId,
    overriddenAt: rec.overriddenAt,
    customerVisible: true,
  }
}
