/**
 * Unit tests for customer invoice details assembly (T-04.1.05.04).
 *
 * Covers explanation extraction, role classification, chain ordering,
 * profile isolation (404), archived-profile skip, missing invoice,
 * direct draft 404, draft family-member exclusion, complete families
 * longer than 50, and fail-closed errors when the family CTE is truncated.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpException } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  CUSTOMER_INVOICE_FAMILY_CTE_MARKER,
  CUSTOMER_INVOICE_MAX_CHAIN,
  CUSTOMER_VISIBLE_STATE_SQL,
  CustomerInvoiceDetailsService,
  assembleCustomerInvoiceDetails,
  assertCompleteInvoiceFamily,
  explanationForCorrection,
  predecessorId,
  roleForInvoice,
  type InvoiceFamilyRow,
  type InvoiceLineRow,
} from './customer-invoice-details.service.js'

const USER_ID = 'user-001'
const PROFILE_ID = '11111111-1111-7111-8111-111111111111'
const ARCHIVED_DEFAULT_ID = '99999999-9999-7999-8999-999999999999'
const ORIGINAL_ID = '22222222-2222-7222-8222-222222222222'
const REPLACEMENT_ID = '33333333-3333-7333-8333-333333333333'
const ADJUSTMENT_ID = '44444444-4444-7444-8444-444444444444'
const OTHER_ID = '55555555-5555-7555-8555-555555555555'
const DRAFT_ID = '77777777-7777-7777-8777-777777777777'
const DRAFT_ADJUSTMENT_ID = '88888888-8888-7888-8888-888888888888'

const mockPool = {
  query: vi.fn(),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

function rejectionBody(error: unknown): Record<string, unknown> {
  if (error instanceof HttpException) {
    return error.getResponse() as Record<string, unknown>
  }
  throw new Error(`expected HttpException, got ${String(error)}`)
}

function row(overrides: Partial<InvoiceFamilyRow> & { id: string }): InvoiceFamilyRow {
  return {
    profile_id: PROFILE_ID,
    state: 'Unpaid',
    total_amount: '100000',
    paid_amount: '0',
    refunded_amount: '0',
    accounting_amount: '100000',
    adjustment_kind: null,
    issued_at: new Date('2026-08-01T10:00:00.000Z'),
    payable_from: new Date('2026-08-01T10:00:00.000Z'),
    due_at: new Date('2026-08-08T10:00:00.000Z'),
    cancelled_at: null,
    created_at: new Date('2026-08-01T10:00:00.000Z'),
    replaces_invoice_id: null,
    adjustment_for_invoice_id: null,
    metadata: {},
    ...overrides,
  }
}

function familyQueryRows(
  invoices: InvoiceFamilyRow[],
  truncated = false,
): { rows: Array<InvoiceFamilyRow & { family_truncated: boolean }> } {
  return {
    rows: invoices.map((invoice) => ({
      ...invoice,
      family_truncated: truncated,
    })),
  }
}

function isFamilyCte(sql: string): boolean {
  return (
    sql.includes('WITH RECURSIVE') &&
    sql.includes(CUSTOMER_INVOICE_FAMILY_CTE_MARKER)
  )
}

function uuidAt(n: number): string {
  return `aaaaaaaa-aaaa-7aaa-8aaa-${n.toString(16).padStart(12, '0')}`
}

function linearReplacementChain(length: number): InvoiceFamilyRow[] {
  return Array.from({ length }, (_, i) =>
    row({
      id: uuidAt(i),
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      issued_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      replaces_invoice_id: i === 0 ? null : uuidAt(i - 1),
      metadata: i === 0 ? {} : { reason: `Correction ${i}` },
    }),
  )
}

function line(
  invoiceId: string,
  description: string,
  amount = '100000',
): InvoiceLineRow {
  return {
    invoice_id: invoiceId,
    description,
    quantity: 1,
    unit_price: amount,
    line_total: amount,
    vat_rate: 0,
    vat_amount: '0',
    is_taxable: false,
    position: 0,
  }
}

describe('explanationForCorrection', () => {
  it('returns null on an original invoice', () => {
    expect(
      explanationForCorrection({
        replacesInvoiceId: null,
        adjustmentForInvoiceId: null,
        metadata: { reason: 'should not appear' },
        firstLineDescription: 'line',
      }),
    ).toBeNull()
  })

  it('prefers metadata.reason on a replacement', () => {
    expect(
      explanationForCorrection({
        replacesInvoiceId: ORIGINAL_ID,
        adjustmentForInvoiceId: null,
        metadata: { reason: 'Wrong quantity billed' },
        firstLineDescription: 'Corrected line',
      }),
    ).toBe('Wrong quantity billed')
  })

  it('falls back to the adjustment line description', () => {
    expect(
      explanationForCorrection({
        replacesInvoiceId: null,
        adjustmentForInvoiceId: ORIGINAL_ID,
        metadata: {},
        firstLineDescription: 'Post-payment quantity increase',
      }),
    ).toBe('Post-payment quantity increase')
  })
})

describe('roleForInvoice', () => {
  it('classifies original, replacement, charge, and credit', () => {
    expect(
      roleForInvoice({
        replacesInvoiceId: null,
        adjustmentForInvoiceId: null,
        adjustmentKind: null,
      }),
    ).toBe('original')
    expect(
      roleForInvoice({
        replacesInvoiceId: ORIGINAL_ID,
        adjustmentForInvoiceId: null,
        adjustmentKind: null,
      }),
    ).toBe('replacement')
    expect(
      roleForInvoice({
        replacesInvoiceId: null,
        adjustmentForInvoiceId: ORIGINAL_ID,
        adjustmentKind: 'charge',
      }),
    ).toBe('adjustment_charge')
    expect(
      roleForInvoice({
        replacesInvoiceId: null,
        adjustmentForInvoiceId: ORIGINAL_ID,
        adjustmentKind: 'credit',
      }),
    ).toBe('adjustment_credit')
  })
})

describe('assembleCustomerInvoiceDetails', () => {
  it('puts the original first and attaches explanations to linked invoices', () => {
    const original = row({
      id: ORIGINAL_ID,
      state: 'Cancelled',
      cancelled_at: new Date('2026-08-02T10:00:00.000Z'),
      metadata: { replacedByInvoiceId: REPLACEMENT_ID, replacementReason: 'Qty fix' },
    })
    const replacement = row({
      id: REPLACEMENT_ID,
      created_at: new Date('2026-08-02T10:00:00.000Z'),
      replaces_invoice_id: ORIGINAL_ID,
      total_amount: '200000',
      accounting_amount: '200000',
      metadata: { reason: 'Quantity was billed as 1 instead of 2' },
    })
    const lines = new Map<string, InvoiceLineRow[]>([
      [ORIGINAL_ID, [line(ORIGINAL_ID, 'Original line')]],
      [REPLACEMENT_ID, [line(REPLACEMENT_ID, 'Corrected line', '200000')]],
    ])

    const details = assembleCustomerInvoiceDetails({
      viewedInvoiceId: REPLACEMENT_ID,
      originalInvoiceId: ORIGINAL_ID,
      rows: [replacement, original],
      linesByInvoiceId: lines,
    })

    expect(details.originalInvoiceId).toBe(ORIGINAL_ID)
    expect(details.invoice.invoiceId).toBe(REPLACEMENT_ID)
    expect(details.chain.map((n) => n.invoiceId)).toEqual([
      ORIGINAL_ID,
      REPLACEMENT_ID,
    ])
    expect(details.chain[0]!.role).toBe('original')
    expect(details.chain[0]!.explanation).toBeNull()
    expect(details.chain[1]!.role).toBe('replacement')
    expect(details.chain[1]!.explanation).toBe(
      'Quantity was billed as 1 instead of 2',
    )
    expect(details.chain[1]!.totalAmount).toBe('200000')
    expect(details.invoice.lines[0]!.description).toBe('Corrected line')
  })

  it('includes charge and credit adjustments with their reasons', () => {
    const original = row({
      id: ORIGINAL_ID,
      state: 'Paid',
      paid_amount: '100000',
      metadata: { adjustedByInvoiceIds: [ADJUSTMENT_ID] },
    })
    const charge = row({
      id: ADJUSTMENT_ID,
      created_at: new Date('2026-08-03T10:00:00.000Z'),
      adjustment_for_invoice_id: ORIGINAL_ID,
      adjustment_kind: 'charge',
      total_amount: '50000',
      accounting_amount: '50000',
      metadata: { reason: 'Post-payment quantity increase', kind: 'charge' },
    })
    const creditId = '66666666-6666-7666-8666-666666666666'
    const credit = row({
      id: creditId,
      created_at: new Date('2026-08-04T10:00:00.000Z'),
      adjustment_for_invoice_id: ORIGINAL_ID,
      adjustment_kind: 'credit',
      total_amount: '20000',
      accounting_amount: '-20000',
      metadata: { reason: 'Overbilled usage credit', kind: 'credit' },
    })

    const details = assembleCustomerInvoiceDetails({
      viewedInvoiceId: ORIGINAL_ID,
      originalInvoiceId: ORIGINAL_ID,
      rows: [credit, original, charge],
      linesByInvoiceId: new Map([
        [ORIGINAL_ID, [line(ORIGINAL_ID, 'Usage')]],
        [ADJUSTMENT_ID, [line(ADJUSTMENT_ID, 'Post-payment quantity increase', '50000')]],
        [creditId, [line(creditId, 'Overbilled usage credit', '20000')]],
      ]),
    })

    expect(details.chain.map((n) => n.role)).toEqual([
      'original',
      'adjustment_charge',
      'adjustment_credit',
    ])
    expect(details.chain[1]!.explanation).toBe('Post-payment quantity increase')
    expect(details.chain[2]!.explanation).toBe('Overbilled usage credit')
    expect(details.chain[2]!.accountingAmount).toBe('-20000')
  })
})

describe('assertCompleteInvoiceFamily', () => {
  it('returns the true root of a chain longer than 50', () => {
    const chain = linearReplacementChain(51)
    const root = assertCompleteInvoiceFamily(chain, false)
    expect(root.id).toBe(uuidAt(0))
    expect(predecessorId(root)).toBeNull()
    expect(chain).toHaveLength(51)
  })

  it('errors instead of treating the viewed correction as the original', () => {
    const viewed = row({
      id: REPLACEMENT_ID,
      replaces_invoice_id: ORIGINAL_ID,
    })
    const rejection = (() => {
      try {
        assertCompleteInvoiceFamily([viewed], false)
        throw new Error('expected assertCompleteInvoiceFamily to throw')
      } catch (error) {
        return error
      }
    })()
    expect(rejection).toMatchObject({ status: 500 })
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.INTERNAL_SERVER.code,
    })
  })

  it('errors when the safety bound truncated the family', () => {
    const chain = linearReplacementChain(3)
    const rejection = (() => {
      try {
        assertCompleteInvoiceFamily(chain, true)
        throw new Error('expected assertCompleteInvoiceFamily to throw')
      } catch (error) {
        return error
      }
    })()
    expect(rejection).toMatchObject({ status: 500 })
    expect(rejectionBody(rejection).error).toBe(
      ErrorCodes.INTERNAL_SERVER.code,
    )
  })
})

describe('CustomerInvoiceDetailsService', () => {
  const service = new CustomerInvoiceDetailsService()

  beforeEach(() => {
    mockPool.query.mockReset()
  })

  function profilesQueryResult(sql: string): { rows: Array<{ id: string }> } {
    expect(sql).toContain('AND archived = false')
    expect(sql).toContain('ORDER BY is_default DESC, created_at ASC')
    // Without the archived filter the default (archived) row would win
    // `ORDER BY is_default DESC`. With the filter, only the live profile
    // remains.
    const excludesArchived = sql.includes('AND archived = false')
    return { rows: [{ id: excludesArchived ? PROFILE_ID : ARCHIVED_DEFAULT_ID }] }
  }

  it('404s when the caller has no active profile', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] })
    const rejection = await service.getForUser(USER_ID, ORIGINAL_ID).catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 404 })
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.NOT_FOUND_RESOURCE.code,
      message: 'No active profile',
    })
    const profileSql = mockPool.query.mock.calls[0]![0] as string
    expect(profileSql).toContain('archived = false')
  })

  it('skips an archived default profile in favor of a non-archived profile', async () => {
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM profiles')) {
        return profilesQueryResult(sql)
      }
      if (sql.includes('FROM invoices')) {
        return { rows: [row({ id: ORIGINAL_ID })] }
      }
      return { rows: [] }
    })

    const list = await service.listForUser(USER_ID)
    expect(list.invoices[0]!.invoiceId).toBe(ORIGINAL_ID)
    const invoiceParams = mockPool.query.mock.calls[1]![1] as unknown[]
    expect(invoiceParams[0]).toBe(PROFILE_ID)
    expect(invoiceParams[0]).not.toBe(ARCHIVED_DEFAULT_ID)

    mockPool.query.mockClear()
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM profiles')) {
        return profilesQueryResult(sql)
      }
      if (sql.includes('FROM invoices') && sql.includes('WHERE id = $1')) {
        return { rows: [row({ id: ORIGINAL_ID })] }
      }
      if (isFamilyCte(sql)) {
        return familyQueryRows([row({ id: ORIGINAL_ID })])
      }
      if (sql.includes('FROM invoice_lines')) {
        return { rows: [line(ORIGINAL_ID, 'Usage')] }
      }
      return { rows: [] }
    })

    const details = await service.getForUser(USER_ID, ORIGINAL_ID)
    expect(details.viewedInvoiceId).toBe(ORIGINAL_ID)
    const detailsInvoiceParams = mockPool.query.mock.calls[1]![1] as unknown[]
    expect(detailsInvoiceParams).toEqual([ORIGINAL_ID, PROFILE_ID])
    expect(detailsInvoiceParams).not.toContain(ARCHIVED_DEFAULT_ID)
  })

  it('404s when the user has only archived profiles', async () => {
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM profiles')) {
        expect(sql).toContain('archived = false')
        return { rows: [] }
      }
      throw new Error(`unexpected query after archived-only profile lookup: ${sql}`)
    })

    const listRejection = await service.listForUser(USER_ID).catch((e: unknown) => e)
    expect(listRejection).toMatchObject({ status: 404 })
    expect(rejectionBody(listRejection)).toMatchObject({
      error: ErrorCodes.NOT_FOUND_RESOURCE.code,
      message: 'No active profile',
    })

    const detailsRejection = await service
      .getForUser(USER_ID, ORIGINAL_ID)
      .catch((e: unknown) => e)
    expect(detailsRejection).toMatchObject({ status: 404 })
    expect(rejectionBody(detailsRejection)).toMatchObject({
      error: ErrorCodes.NOT_FOUND_RESOURCE.code,
      message: 'No active profile',
    })
    expect(mockPool.query.mock.calls).toHaveLength(2)
  })

  it('404s when the invoice belongs to another profile', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: PROFILE_ID }] })
      .mockResolvedValueOnce({ rows: [] })
    const rejection = await service
      .getForUser(USER_ID, OTHER_ID)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 404 })
    expect(rejectionBody(rejection).error).toBe(ErrorCodes.NOT_FOUND_RESOURCE.code)
    const loadCall = mockPool.query.mock.calls[1] as [string, unknown[]]
    expect(loadCall[1]).toEqual([OTHER_ID, PROFILE_ID])
    expect(loadCall[0]).toContain(CUSTOMER_VISIBLE_STATE_SQL)
  })

  it('404s when requesting a draft invoice in the active profile', async () => {
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM profiles')) {
        return { rows: [{ id: PROFILE_ID }] }
      }
      if (sql.includes('FROM invoices') && sql.includes('WHERE id = $1')) {
        expect(sql).toContain(CUSTOMER_VISIBLE_STATE_SQL)
        return { rows: [] }
      }
      return { rows: [] }
    })

    const rejection = await service
      .getForUser(USER_ID, DRAFT_ID)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 404 })
    expect(rejectionBody(rejection).error).toBe(ErrorCodes.NOT_FOUND_RESOURCE.code)
    expect(rejectionBody(rejection).message).toBe(`Invoice not found: ${DRAFT_ID}`)
  })

  it('excludes draft linked invoices from the correction chain', async () => {
    const original = row({
      id: ORIGINAL_ID,
      state: 'Paid',
      paid_amount: '100000',
    })
    const issuedAdjustment = row({
      id: ADJUSTMENT_ID,
      created_at: new Date('2026-08-03T10:00:00.000Z'),
      adjustment_for_invoice_id: ORIGINAL_ID,
      adjustment_kind: 'charge',
      total_amount: '50000',
      accounting_amount: '50000',
      metadata: { reason: 'Issued post-payment charge', kind: 'charge' },
    })

    mockPool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM profiles')) {
        return { rows: [{ id: PROFILE_ID }] }
      }
      if (isFamilyCte(sql)) {
        expect(sql).toContain(CUSTOMER_VISIBLE_STATE_SQL)
        expect(sql).toContain("n.state <> 'Draft'")
        expect(params).toEqual([
          ORIGINAL_ID,
          PROFILE_ID,
          CUSTOMER_INVOICE_MAX_CHAIN,
        ])
        return familyQueryRows([original, issuedAdjustment])
      }
      if (sql.includes('FROM invoices') && sql.includes('WHERE id = $1')) {
        expect(sql).toContain(CUSTOMER_VISIBLE_STATE_SQL)
        const id = params![0] as string
        if (id === ORIGINAL_ID) return { rows: [original] }
        if (id === DRAFT_ADJUSTMENT_ID) return { rows: [] }
        return { rows: [] }
      }
      if (sql.includes('FROM invoice_lines')) {
        return {
          rows: [
            line(ORIGINAL_ID, 'Usage'),
            line(ADJUSTMENT_ID, 'Issued post-payment charge', '50000'),
          ],
        }
      }
      return { rows: [] }
    })

    const details = await service.getForUser(USER_ID, ORIGINAL_ID)
    expect(details.chain.map((n) => n.invoiceId)).toEqual([
      ORIGINAL_ID,
      ADJUSTMENT_ID,
    ])
    expect(details.chain.map((n) => n.invoiceId)).not.toContain(DRAFT_ADJUSTMENT_ID)
  })

  it('walks a replacement chain and returns original + replacement with explanations', async () => {
    const original = row({
      id: ORIGINAL_ID,
      state: 'Cancelled',
      cancelled_at: new Date('2026-08-02T10:00:00.000Z'),
      metadata: { replacementReason: 'Qty fix', replacedByInvoiceId: REPLACEMENT_ID },
    })
    const replacement = row({
      id: REPLACEMENT_ID,
      created_at: new Date('2026-08-02T10:00:00.000Z'),
      replaces_invoice_id: ORIGINAL_ID,
      metadata: { reason: 'Quantity was billed as 1 instead of 2' },
    })

    mockPool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM profiles')) {
        return { rows: [{ id: PROFILE_ID }] }
      }
      if (isFamilyCte(sql)) {
        expect(sql).toContain(CUSTOMER_VISIBLE_STATE_SQL)
        expect(params).toEqual([
          REPLACEMENT_ID,
          PROFILE_ID,
          CUSTOMER_INVOICE_MAX_CHAIN,
        ])
        return familyQueryRows([original, replacement])
      }
      if (sql.includes('FROM invoices') && sql.includes('WHERE id = $1')) {
        const id = params![0] as string
        if (id === REPLACEMENT_ID) return { rows: [replacement] }
        return { rows: [] }
      }
      if (sql.includes('FROM invoice_lines')) {
        return {
          rows: [
            line(ORIGINAL_ID, 'Original line'),
            line(REPLACEMENT_ID, 'Corrected line', '200000'),
          ],
        }
      }
      return { rows: [] }
    })

    const details = await service.getForUser(USER_ID, REPLACEMENT_ID)
    expect(details.viewedInvoiceId).toBe(REPLACEMENT_ID)
    expect(details.originalInvoiceId).toBe(ORIGINAL_ID)
    expect(details.chain).toHaveLength(2)
    expect(details.chain[0]!.role).toBe('original')
    expect(details.chain[1]!.explanation).toBe(
      'Quantity was billed as 1 instead of 2',
    )
  })

  it('returns the complete family when the chain is longer than 50', async () => {
    const chain = linearReplacementChain(51)
    const viewed = chain[50]!
    mockPool.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM profiles')) {
        return { rows: [{ id: PROFILE_ID }] }
      }
      if (isFamilyCte(sql)) {
        expect(params).toEqual([
          viewed.id,
          PROFILE_ID,
          CUSTOMER_INVOICE_MAX_CHAIN,
        ])
        expect(CUSTOMER_INVOICE_MAX_CHAIN).toBeGreaterThan(50)
        return familyQueryRows(chain)
      }
      if (sql.includes('FROM invoices') && sql.includes('WHERE id = $1')) {
        return { rows: [viewed] }
      }
      if (sql.includes('FROM invoice_lines')) {
        return { rows: chain.map((invoice) => line(invoice.id, 'Line')) }
      }
      return { rows: [] }
    })

    const details = await service.getForUser(USER_ID, viewed.id)
    expect(details.viewedInvoiceId).toBe(uuidAt(50))
    expect(details.originalInvoiceId).toBe(uuidAt(0))
    expect(details.chain).toHaveLength(51)
    expect(details.chain[0]!.role).toBe('original')
    expect(details.chain[50]!.role).toBe('replacement')
    expect(details.chain[50]!.explanation).toBe('Correction 50')
  })

  it('errors when a chain beyond the safety bound would omit the true original', async () => {
    const viewed = row({
      id: REPLACEMENT_ID,
      replaces_invoice_id: ORIGINAL_ID,
      metadata: { reason: 'Would be mislabeled as original' },
    })
    mockPool.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM profiles')) {
        return { rows: [{ id: PROFILE_ID }] }
      }
      if (isFamilyCte(sql)) {
        return familyQueryRows([viewed], true)
      }
      if (sql.includes('FROM invoices') && sql.includes('WHERE id = $1')) {
        return { rows: [viewed] }
      }
      return { rows: [] }
    })

    const rejection = await service
      .getForUser(USER_ID, REPLACEMENT_ID)
      .catch((e: unknown) => e)
    expect(rejection).toMatchObject({ status: 500 })
    expect(rejectionBody(rejection)).toMatchObject({
      error: ErrorCodes.INTERNAL_SERVER.code,
      message: 'Invoice correction chain exceeds the maximum supported length',
    })
  })

  it('lists non-draft invoices for the active profile', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ id: PROFILE_ID }] })
      .mockResolvedValueOnce({
        rows: [
          row({
            id: REPLACEMENT_ID,
            replaces_invoice_id: ORIGINAL_ID,
            metadata: { reason: 'Qty fix' },
          }),
        ],
      })

    const list = await service.listForUser(USER_ID)
    expect(list.invoices).toHaveLength(1)
    expect(list.invoices[0]!.invoiceId).toBe(REPLACEMENT_ID)
    expect(list.invoices[0]!.explanation).toBe('Qty fix')
    const listSql = mockPool.query.mock.calls[1]![0] as string
    expect(listSql).toContain(CUSTOMER_VISIBLE_STATE_SQL)
  })
})
