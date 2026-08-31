/**
 * Admin per-service-type reminder offset toggles (T-04.1.04.05 / S-04.1.04).
 *
 * Canonical offsets are days relative to `dueAt` (`-7`, `-3`, `-1`, `0`,
 * `+1`, `+7`). Admin may enable or disable each offset independently for
 * each invoice service type (`electricity` | `saving_plan` |
 * `consultation` | `manual`).
 *
 * Missing rows default to enabled so an empty config table matches the
 * S-04.1.04 schedule. ReminderScheduler (T-04.1.04.02) omits disabled
 * offsets when inserting `invoice_reminder_schedule` rows. Toggles apply
 * to newly scheduled invoices; already-inserted rows are left in place
 * (cancel-on-paid is T-04.1.04.06).
 *
 * @module finance
 */

import { isServiceDuePeriodType, SERVICE_DUE_PERIOD_TYPES, type ServiceDuePeriodType } from './service-due-periods.js'
import {
  INVOICE_REMINDER_OFFSETS,
  isInvoiceReminderOffset,
  type InvoiceReminderOffset,
} from './reminder-schedule.js'

/** Capability gate documented on the admin API (mapped to isAdmin today). */
export const REMINDER_OFFSET_TOGGLE_PERMISSION = 'admin:finance:invoices:reminder-offsets' as const

/** Canonical audit event for a reminder-offset toggle change. */
export const REMINDER_OFFSET_TOGGLE_EVENT = 'invoice.reminder_offset.toggle' as const

/** One persisted (or defaulted) enable/disable flag. */
export interface ReminderOffsetToggleDto {
  serviceType: ServiceDuePeriodType
  offset: InvoiceReminderOffset
  enabled: boolean
}

/** Error messages for the toggle write surface. */
export const REMINDER_OFFSET_TOGGLE_ERRORS = {
  BAD_SERVICE_TYPE: () =>
    `serviceType must be one of ${SERVICE_DUE_PERIOD_TYPES.join(', ')}`,
  BAD_OFFSET: () => `offset must be one of ${INVOICE_REMINDER_OFFSETS.join(', ')}`,
  BAD_ENABLED: () => 'enabled must be a boolean',
} as const

/** Parsed body for a single toggle write. */
export interface ReminderOffsetToggleWrite {
  serviceType: ServiceDuePeriodType
  offset: InvoiceReminderOffset
  enabled: boolean
}

/**
 * The full 4×6 matrix with every offset enabled. Used when no rows have
 * been persisted yet (S-04.1.04 default schedule).
 */
export function defaultReminderOffsetToggles(): ReminderOffsetToggleDto[] {
  const rows: ReminderOffsetToggleDto[] = []
  for (const serviceType of SERVICE_DUE_PERIOD_TYPES) {
    for (const offset of INVOICE_REMINDER_OFFSETS) {
      rows.push({ serviceType, offset, enabled: true })
    }
  }
  return rows
}

/**
 * Overlay stored rows onto the canonical matrix. Unknown service types
 * or offsets are ignored; missing pairs stay enabled.
 */
export function mergeReminderOffsetToggles(
  stored: ReadonlyArray<{ serviceType: string; offset: number; enabled: boolean }>,
): ReminderOffsetToggleDto[] {
  const byKey = new Map<string, boolean>()
  for (const row of stored) {
    if (!isServiceDuePeriodType(row.serviceType)) continue
    if (!isInvoiceReminderOffset(row.offset)) continue
    byKey.set(`${row.serviceType}:${row.offset}`, row.enabled)
  }
  return defaultReminderOffsetToggles().map((row) => ({
    ...row,
    enabled: byKey.get(`${row.serviceType}:${row.offset}`) ?? true,
  }))
}

/**
 * Offsets ReminderScheduler may insert for `serviceType`. A null/unknown
 * type (hardware product, missing metadata) keeps the full canonical set
 * so scheduling never silently drops reminders for unclassified invoices.
 */
export function enabledOffsetsForServiceType(
  toggles: readonly ReminderOffsetToggleDto[],
  serviceType: string | null | undefined,
): InvoiceReminderOffset[] {
  if (!isServiceDuePeriodType(serviceType)) {
    return [...INVOICE_REMINDER_OFFSETS]
  }
  const disabled = new Set<InvoiceReminderOffset>()
  for (const row of toggles) {
    if (row.serviceType === serviceType && row.enabled === false) {
      disabled.add(row.offset)
    }
  }
  return INVOICE_REMINDER_OFFSETS.filter((offset) => !disabled.has(offset))
}

/** True when `raw` is a boolean (not a 0/1 number or string). */
function isBoolean(raw: unknown): raw is boolean {
  return typeof raw === 'boolean'
}

/**
 * Parse a single-toggle write body.
 *
 * @returns `{ ok: true, value }` or `{ ok: false, issues }`.
 */
export function parseReminderOffsetToggleBody(
  raw: unknown,
): { ok: true; value: ReminderOffsetToggleWrite } | { ok: false; issues: string[] } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, issues: ['body must be an object'] }
  }
  const body = raw as Record<string, unknown>
  const issues: string[] = []

  if (!isServiceDuePeriodType(body.serviceType)) {
    issues.push(REMINDER_OFFSET_TOGGLE_ERRORS.BAD_SERVICE_TYPE())
  }
  if (typeof body.offset !== 'number' || !isInvoiceReminderOffset(body.offset)) {
    issues.push(REMINDER_OFFSET_TOGGLE_ERRORS.BAD_OFFSET())
  }
  if (!isBoolean(body.enabled)) {
    issues.push(REMINDER_OFFSET_TOGGLE_ERRORS.BAD_ENABLED())
  }
  if (issues.length > 0) {
    return { ok: false, issues }
  }
  return {
    ok: true,
    value: {
      serviceType: body.serviceType as ServiceDuePeriodType,
      offset: body.offset as InvoiceReminderOffset,
      enabled: body.enabled as boolean,
    },
  }
}
