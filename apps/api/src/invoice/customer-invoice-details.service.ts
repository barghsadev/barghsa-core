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
 * (default) profile. Missing invoices, other profiles, and unknown ids
 * all resolve to the same not-found outcome so existence is not leaked.
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

export const CUSTOMER_INVOICE_MAX_CHAIN = 50

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
  async resolveActiveProfileId(userId: string): Promise<string | null> {
    const pool = getDbPool()
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM profiles
       WHERE user_id = $1
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
          AND state <> 'Draft'
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

    const family = await this.loadFamily(viewed, profileId)
    const original =
      family.find((row) => predecessorId(row) === null) ?? family[0]!
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
        WHERE id = $1 AND profile_id = $2`,
      [invoiceId, profileId],
    )
    return result.rows[0] ?? null
  }

  /**
   * Walk predecessors to the chain root, then BFS every replacement and
   * adjustment that points at a family member. All hops are profile-scoped.
   */
  private async loadFamily(
    viewed: InvoiceFamilyRow,
    profileId: string,
  ): Promise<InvoiceFamilyRow[]> {
    const byId = new Map<string, InvoiceFamilyRow>([[viewed.id, viewed]])
    let cursor: InvoiceFamilyRow | undefined = viewed
    let depth = 0
    while (cursor && depth < CUSTOMER_INVOICE_MAX_CHAIN) {
      const parentId = predecessorId(cursor)
      if (!parentId || byId.has(parentId)) break
      const parent = await this.loadInvoice(parentId, profileId)
      if (!parent) break
      byId.set(parent.id, parent)
      cursor = parent
      depth += 1
    }

    let frontier = [...byId.keys()]
    while (frontier.length > 0 && byId.size < CUSTOMER_INVOICE_MAX_CHAIN) {
      const children = await this.loadChildren(profileId, frontier, [
        ...byId.keys(),
      ])
      if (children.length === 0) break
      const next: string[] = []
      for (const child of children) {
        if (byId.has(child.id)) continue
        byId.set(child.id, child)
        next.push(child.id)
      }
      frontier = next
    }

    return [...byId.values()]
  }

  private async loadChildren(
    profileId: string,
    parentIds: string[],
    alreadyHave: string[],
  ): Promise<InvoiceFamilyRow[]> {
    const pool = getDbPool()
    const result = await pool.query<InvoiceFamilyRow>(
      `SELECT ${INVOICE_SELECT}
         FROM invoices
        WHERE profile_id = $1
          AND (
            replaces_invoice_id = ANY($2::uuid[])
            OR adjustment_for_invoice_id = ANY($2::uuid[])
          )
          AND NOT (id = ANY($3::uuid[]))`,
      [profileId, parentIds, alreadyHave],
    )
    return result.rows
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
