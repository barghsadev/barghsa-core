/**
 * Customer-facing invoice details (T-04.1.05.04 / S-04.1.05).
 *
 * Customers see the original invoice plus the linked correction chain:
 * pre-payment replacements (`replaces_invoice_id`) and post-payment
 * adjustments (`adjustment_for_invoice_id`), each with the staff-supplied
 * explanation stored on invoice metadata (and as the adjustment line
 * description).
 *
 * Profile isolation: every query is scoped to the caller's active
 * (default) profile. Missing invoices, other profiles, unknown ids, and
 * Draft invoices (not yet issued, staff-only) all resolve to the same
 * not-found outcome so existence is not leaked.
 *
 * Money is serialized as decimal-digit strings (signed int8 IRR). JSON
 * Number cannot carry amounts past `Number.MAX_SAFE_INTEGER`.
 */

import { HttpException, Injectable } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import { isAdjustmentKind, type AdjustmentKind } from '@barghsa/shared/finance'
import { isInvoiceState, type InvoiceState } from './invoice-state.model.js'

/** How this invoice participates in a correction chain. */
export type InvoiceCorrectionRole =
  | 'original'
  | 'replacement'
  | 'adjustment_charge'
  | 'adjustment_credit'

export interface CustomerInvoiceLineDto {
  description: string
  quantity: number
  unitPrice: string
  lineTotal: string
  vatRate: number
  vatAmount: string
  isTaxable: boolean
}

export interface CustomerInvoiceNodeDto {
  invoiceId: string
  role: InvoiceCorrectionRole
  state: InvoiceState
  totalAmount: string
  paidAmount: string
  refundedAmount: string
  accountingAmount: string | null
  adjustmentKind: AdjustmentKind | null
  issuedAt: string | null
  payableFrom: string | null
  dueAt: string | null
  cancelledAt: string | null
  createdAt: string
  replacesInvoiceId: string | null
  adjustmentForInvoiceId: string | null
  /** Customer-visible explanation of this correction. Null on the original. */
  explanation: string | null
  lines: CustomerInvoiceLineDto[]
}

export interface CustomerInvoiceDetailsDto {
  viewedInvoiceId: string
  originalInvoiceId: string
  invoice: CustomerInvoiceNodeDto
  /** Original first, then linked replacements/adjustments chronologically. */
  chain: CustomerInvoiceNodeDto[]
}

export interface CustomerInvoiceListItemDto {
  invoiceId: string
  role: InvoiceCorrectionRole
  state: InvoiceState
  totalAmount: string
  accountingAmount: string | null
  adjustmentKind: AdjustmentKind | null
  issuedAt: string | null
  dueAt: string | null
  createdAt: string
  explanation: string | null
}

export interface CustomerInvoiceListDto {
  invoices: CustomerInvoiceListItemDto[]
}

/**
 * Safety bound on the recursive family CTE diameter (hops). Exhausting
 * this bound is an explicit error — never a partial family or a
 * mis-identified original. Typical chains are a handful of invoices.
 */
export const CUSTOMER_INVOICE_MAX_CHAIN = 256

/** Matches `listForUser`: drafts are staff-only and never customer-visible. */
export const CUSTOMER_VISIBLE_STATE_SQL = `state <> 'Draft'`

export const CUSTOMER_INVOICE_FAMILY_CTE_MARKER = 'customer_invoice_family_cte'

const FAMILY_TRUNCATED_MESSAGE =
  'Invoice correction chain exceeds the maximum supported length'
const FAMILY_ROOT_MESSAGE =
  'Invoice correction chain is cyclic or missing an original invoice'

export interface InvoiceFamilyRow {
  id: string
  profile_id: string
  state: string
  total_amount: unknown
  paid_amount: unknown
  refunded_amount: unknown
  accounting_amount: unknown
  adjustment_kind: string | null
  issued_at: Date | string | null
  payable_from: Date | string | null
  due_at: Date | string | null
  cancelled_at: Date | string | null
  created_at: Date | string
  replaces_invoice_id: string | null
  adjustment_for_invoice_id: string | null
  metadata: unknown
}

export interface InvoiceLineRow {
  invoice_id: string
  description: string
  quantity: number
  unit_price: unknown
  line_total: unknown
  vat_rate: number
  vat_amount: unknown
  is_taxable: boolean
  position: number
}

function httpError(code: string, message: string, statusCode: number): never {
  throw new HttpException({ statusCode, error: code, message }, statusCode)
}

export function asMetadataObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) }
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, unknown>) }
      }
    } catch {
      /* ignore malformed JSON */
    }
  }
  return {}
}

function trimString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Customer-visible explanation for a linked correction.
 *
 * Replacement and adjustment writers store `metadata.reason`. Cancelled
 * originals also keep `metadata.replacementReason`. Adjustment line
 * descriptions copy the same reason as a fallback.
 */
export function explanationForCorrection(input: {
  replacesInvoiceId: string | null
  adjustmentForInvoiceId: string | null
  metadata: Record<string, unknown>
  firstLineDescription?: string | null
}): string | null {
  const isLinked =
    input.replacesInvoiceId !== null || input.adjustmentForInvoiceId !== null
  if (!isLinked) return null
  return (
    trimString(input.metadata.reason) ??
    trimString(input.metadata.replacementReason) ??
    trimString(input.firstLineDescription)
  )
}

export function roleForInvoice(input: {
  replacesInvoiceId: string | null
  adjustmentForInvoiceId: string | null
  adjustmentKind: string | null
}): InvoiceCorrectionRole {
  if (input.adjustmentForInvoiceId !== null || input.adjustmentKind !== null) {
    return input.adjustmentKind === 'credit'
      ? 'adjustment_credit'
      : 'adjustment_charge'
  }
  if (input.replacesInvoiceId !== null) return 'replacement'
  return 'original'
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function isoRequired(value: Date | string | null | undefined): string {
  return iso(value) ?? new Date(0).toISOString()
}

function irrString(value: unknown): string {
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.trunc(value)).toString()
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim()).toString()
  }
  return '0'
}

function irrStringOrNull(value: unknown): string | null {
  if (value == null || value === '') return null
  return irrString(value)
}

function createdAtMs(row: InvoiceFamilyRow): number {
  const stamp = iso(row.created_at)
  return stamp ? Date.parse(stamp) : 0
}

export function predecessorId(row: InvoiceFamilyRow): string | null {
  return row.replaces_invoice_id ?? row.adjustment_for_invoice_id ?? null
}

export function isFamilyTruncatedFlag(value: unknown): boolean {
  return value === true || value === 't' || value === 'true'
}

/**
 * Require a complete, uniquely rooted family. A missing root or a
 * predecessor outside the loaded set must not fall back to `family[0]`,
 * which would label a viewed correction as the original invoice.
 */
export function assertCompleteInvoiceFamily(
  family: InvoiceFamilyRow[],
  truncated: boolean,
): InvoiceFamilyRow {
  if (truncated) {
    httpError(
      ErrorCodes.INTERNAL_SERVER.code,
      FAMILY_TRUNCATED_MESSAGE,
      500,
    )
  }
  const ids = new Set(family.map((row) => row.id))
  for (const row of family) {
    const pred = predecessorId(row)
    if (pred !== null && !ids.has(pred)) {
      httpError(
        ErrorCodes.INTERNAL_SERVER.code,
        FAMILY_TRUNCATED_MESSAGE,
        500,
      )
    }
  }
  const roots = family.filter((row) => predecessorId(row) === null)
  if (roots.length !== 1) {
    httpError(ErrorCodes.INTERNAL_SERVER.code, FAMILY_ROOT_MESSAGE, 500)
  }
  return roots[0]!
}

export function assembleCustomerInvoiceDetails(input: {
  viewedInvoiceId: string
  originalInvoiceId: string
  rows: InvoiceFamilyRow[]
  linesByInvoiceId: Map<string, InvoiceLineRow[]>
}): CustomerInvoiceDetailsDto {
  const nodes = input.rows
    .slice()
    .sort((a, b) => {
      if (a.id === input.originalInvoiceId && b.id !== input.originalInvoiceId) {
        return -1
      }
      if (b.id === input.originalInvoiceId && a.id !== input.originalInvoiceId) {
        return 1
      }
      return createdAtMs(a) - createdAtMs(b)
    })
    .map((row) => toNode(row, input.linesByInvoiceId.get(row.id) ?? []))

  const invoice = nodes.find((node) => node.invoiceId === input.viewedInvoiceId)
  if (!invoice) {
    httpError(
      ErrorCodes.NOT_FOUND_RESOURCE.code,
      `Invoice not found: ${input.viewedInvoiceId}`,
      404,
    )
  }

  return {
    viewedInvoiceId: input.viewedInvoiceId,
    originalInvoiceId: input.originalInvoiceId,
    invoice,
    chain: nodes,
  }
}

function toNode(
  row: InvoiceFamilyRow,
  lines: InvoiceLineRow[],
): CustomerInvoiceNodeDto {
  const metadata = asMetadataObject(row.metadata)
  const orderedLines = lines
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(toLine)
  const firstLine = orderedLines[0]?.description ?? null
  return {
    invoiceId: row.id,
    role: roleForInvoice({
      replacesInvoiceId: row.replaces_invoice_id,
      adjustmentForInvoiceId: row.adjustment_for_invoice_id,
      adjustmentKind: row.adjustment_kind,
    }),
    state: isInvoiceState(row.state) ? row.state : 'Unpaid',
    totalAmount: irrString(row.total_amount),
    paidAmount: irrString(row.paid_amount),
    refundedAmount: irrString(row.refunded_amount),
    accountingAmount: irrStringOrNull(row.accounting_amount),
    adjustmentKind: isAdjustmentKind(row.adjustment_kind)
      ? row.adjustment_kind
      : null,
    issuedAt: iso(row.issued_at),
    payableFrom: iso(row.payable_from),
    dueAt: iso(row.due_at),
    cancelledAt: iso(row.cancelled_at),
    createdAt: isoRequired(row.created_at),
    replacesInvoiceId: row.replaces_invoice_id,
    adjustmentForInvoiceId: row.adjustment_for_invoice_id,
    explanation: explanationForCorrection({
      replacesInvoiceId: row.replaces_invoice_id,
      adjustmentForInvoiceId: row.adjustment_for_invoice_id,
      metadata,
      firstLineDescription: firstLine,
    }),
    lines: orderedLines,
  }
}

function toLine(row: InvoiceLineRow): CustomerInvoiceLineDto {
  return {
    description: row.description,
    quantity: row.quantity,
    unitPrice: irrString(row.unit_price),
    lineTotal: irrString(row.line_total),
    vatRate: row.vat_rate,
    vatAmount: irrString(row.vat_amount),
    isTaxable: row.is_taxable,
  }
}

function toListItem(row: InvoiceFamilyRow): CustomerInvoiceListItemDto {
  const metadata = asMetadataObject(row.metadata)
  return {
    invoiceId: row.id,
    role: roleForInvoice({
      replacesInvoiceId: row.replaces_invoice_id,
      adjustmentForInvoiceId: row.adjustment_for_invoice_id,
      adjustmentKind: row.adjustment_kind,
    }),
    state: isInvoiceState(row.state) ? row.state : 'Unpaid',
    totalAmount: irrString(row.total_amount),
    accountingAmount: irrStringOrNull(row.accounting_amount),
    adjustmentKind: isAdjustmentKind(row.adjustment_kind)
      ? row.adjustment_kind
      : null,
    issuedAt: iso(row.issued_at),
    dueAt: iso(row.due_at),
    createdAt: isoRequired(row.created_at),
    explanation: explanationForCorrection({
      replacesInvoiceId: row.replaces_invoice_id,
      adjustmentForInvoiceId: row.adjustment_for_invoice_id,
      metadata,
    }),
  }
}

const INVOICE_SELECT = `id, profile_id, state, total_amount, paid_amount, refunded_amount,
       accounting_amount, adjustment_kind, issued_at, payable_from, due_at,
       cancelled_at, created_at, replaces_invoice_id, adjustment_for_invoice_id,
       metadata`

@Injectable()
export class CustomerInvoiceDetailsService {
  /**
   * Active profile is the caller's non-archived default, falling back to
   * their earliest non-archived profile. Archived profiles are inactive
   * and must not isolate invoice list/details.
   */
  async resolveActiveProfileId(userId: string): Promise<string | null> {
    const pool = getDbPool()
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM profiles
       WHERE user_id = $1 AND archived = false
       ORDER BY is_default DESC, created_at ASC
       LIMIT 1`,
      [userId],
    )
    return result.rows[0]?.id ?? null
  }

  async listForUser(userId: string): Promise<CustomerInvoiceListDto> {
    const profileId = await this.requireActiveProfile(userId)
    const pool = getDbPool()
    const result = await pool.query<InvoiceFamilyRow>(
      `SELECT ${INVOICE_SELECT}
         FROM invoices
        WHERE profile_id = $1
          AND ${CUSTOMER_VISIBLE_STATE_SQL}
        ORDER BY created_at DESC`,
      [profileId],
    )
    return { invoices: result.rows.map(toListItem) }
  }

  async getForUser(
    userId: string,
    invoiceId: string,
  ): Promise<CustomerInvoiceDetailsDto> {
    const profileId = await this.requireActiveProfile(userId)
    const viewed = await this.loadInvoice(invoiceId, profileId)
    if (!viewed) {
      httpError(
        ErrorCodes.NOT_FOUND_RESOURCE.code,
        `Invoice not found: ${invoiceId}`,
        404,
      )
    }

    const { rows: family, truncated } = await this.loadFamily(
      viewed.id,
      profileId,
    )
    const original = assertCompleteInvoiceFamily(family, truncated)
    const linesByInvoiceId = await this.loadLines(family.map((row) => row.id))

    return assembleCustomerInvoiceDetails({
      viewedInvoiceId: invoiceId,
      originalInvoiceId: original.id,
      rows: family,
      linesByInvoiceId,
    })
  }

  private async requireActiveProfile(userId: string): Promise<string> {
    const profileId = await this.resolveActiveProfileId(userId)
    if (!profileId) {
      httpError(
        ErrorCodes.NOT_FOUND_RESOURCE.code,
        'No active profile',
        404,
      )
    }
    return profileId
  }

  private async loadInvoice(
    invoiceId: string,
    profileId: string,
  ): Promise<InvoiceFamilyRow | null> {
    const pool = getDbPool()
    const result = await pool.query<InvoiceFamilyRow>(
      `SELECT ${INVOICE_SELECT}
         FROM invoices
        WHERE id = $1 AND profile_id = $2
          AND ${CUSTOMER_VISIBLE_STATE_SQL}`,
      [invoiceId, profileId],
    )
    return result.rows[0] ?? null
  }

  /**
   * Load the complete correction family with a recursive CTE: walk both
   * to predecessors and to replacements/adjustments, with path-based
   * cycle detection. Neighbor leftovers after the hop bound set
   * `family_truncated` so callers can fail closed.
   */
  private async loadFamily(
    seedId: string,
    profileId: string,
  ): Promise<{ rows: InvoiceFamilyRow[]; truncated: boolean }> {
    const pool = getDbPool()
    const result = await pool.query<
      InvoiceFamilyRow & { family_truncated: unknown }
    >(
      `-- ${CUSTOMER_INVOICE_FAMILY_CTE_MARKER}
       WITH RECURSIVE family AS (
         SELECT ${INVOICE_SELECT},
                ARRAY[id]::uuid[] AS path,
                1 AS depth
           FROM invoices
          WHERE id = $1::uuid
            AND profile_id = $2::uuid
            AND ${CUSTOMER_VISIBLE_STATE_SQL}

          UNION ALL

         SELECT n.id, n.profile_id, n.state, n.total_amount, n.paid_amount,
                n.refunded_amount, n.accounting_amount, n.adjustment_kind,
                n.issued_at, n.payable_from, n.due_at, n.cancelled_at,
                n.created_at, n.replaces_invoice_id, n.adjustment_for_invoice_id,
                n.metadata,
                f.path || n.id,
                f.depth + 1
           FROM invoices n
           INNER JOIN family f ON (
             n.id = COALESCE(f.replaces_invoice_id, f.adjustment_for_invoice_id)
             OR n.replaces_invoice_id = f.id
             OR n.adjustment_for_invoice_id = f.id
           )
          WHERE n.profile_id = $2::uuid
            AND n.state <> 'Draft'
            AND NOT (n.id = ANY(f.path))
            AND f.depth < $3
       ),
       loaded AS (
         SELECT DISTINCT ON (id) ${INVOICE_SELECT}
           FROM family
          ORDER BY id, depth ASC
       ),
       truncated AS (
         SELECT EXISTS (
           SELECT 1
             FROM invoices n
            WHERE n.profile_id = $2::uuid
              AND n.state <> 'Draft'
              AND (
                EXISTS (
                  SELECT 1 FROM loaded x
                   WHERE COALESCE(x.replaces_invoice_id, x.adjustment_for_invoice_id) = n.id
                )
                OR EXISTS (
                  SELECT 1 FROM loaded x
                   WHERE n.replaces_invoice_id = x.id
                      OR n.adjustment_for_invoice_id = x.id
                )
              )
              AND NOT EXISTS (SELECT 1 FROM loaded y WHERE y.id = n.id)
         ) AS family_truncated
       )
       SELECT l.*, t.family_truncated
         FROM loaded l
         CROSS JOIN truncated t`,
      [seedId, profileId, CUSTOMER_INVOICE_MAX_CHAIN],
    )
    const truncated = result.rows.some((row) =>
      isFamilyTruncatedFlag(row.family_truncated),
    )
    const rows = result.rows.map(
      ({ family_truncated: _truncated, ...invoice }) => invoice,
    )
    return { rows, truncated }
  }

  private async loadLines(
    invoiceIds: string[],
  ): Promise<Map<string, InvoiceLineRow[]>> {
    const map = new Map<string, InvoiceLineRow[]>()
    if (invoiceIds.length === 0) return map
    const pool = getDbPool()
    const result = await pool.query<InvoiceLineRow>(
      `SELECT invoice_id, description, quantity, unit_price, line_total,
              vat_rate, vat_amount, is_taxable, position
         FROM invoice_lines
        WHERE invoice_id = ANY($1::uuid[])
        ORDER BY invoice_id, position`,
      [invoiceIds],
    )
    for (const row of result.rows) {
      const list = map.get(row.invoice_id) ?? []
      list.push(row)
      map.set(row.invoice_id, list)
    }
    return map
  }
}
