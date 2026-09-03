import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConflictException, HttpException } from '@nestjs/common'
import { ErrorCodes } from '@barghsa/shared/errors'
import { BANK_RECEIPT_STORAGE_PURPOSE } from '@barghsa/shared/finance'
import { StorageObjectNotFound, type StorageProvider } from '@barghsa/shared/storage'
import { InvoiceBankReceiptUploadService } from './invoice-bank-receipt-upload.service.js'
import type { CustomerInvoiceDetailsService } from './customer-invoice-details.service.js'

const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
}

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

const PROFILE_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const INVOICE_ID = '11111111-1111-7111-8111-111111111111'
const RECEIPT_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'
const ACTOR_ID = 'user-1'
const AMOUNT = 250_000n
const ATTACHMENT = 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'
const SEALED = 'receipts/submitted/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'

const RECEIPT = {
  paymentDate: '2026-08-15',
  payerReference: 'TRK-998877',
  attachmentKey: ATTACHMENT,
  customerNote: 'Branch transfer',
}

const VALID_STORAGE_METADATA = {
  verified: true,
  uploadedBy: ACTOR_ID,
  profileId: PROFILE_ID,
  purpose: BANK_RECEIPT_STORAGE_PURPOSE,
}

function makeReceiptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RECEIPT_ID,
    invoice_id: INVOICE_ID,
    profile_id: PROFILE_ID,
    amount: AMOUNT.toString(),
    payment_date: RECEIPT.paymentDate,
    payer_reference: RECEIPT.payerReference,
    attachment_key: ATTACHMENT,
    customer_note: RECEIPT.customerNote,
    state: 'Submitted',
    ...overrides,
  }
}

type ScriptOptions = {
  invoice?: { id: string; profile_id: string; state: string; adjustment_kind: string | null } | null
  storageStatus?: string | null
  storageMetadata?: Record<string, unknown> | null
  fileSize?: number | null
  contentType?: string | null
  category?: string | null
  fileName?: string | null
  claimType?: string | null
  existing?: ReturnType<typeof makeReceiptRow> | null
  insert?: ReturnType<typeof makeReceiptRow> | Error
}

function scriptClient(opts: ScriptOptions = {}) {
  mockClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes('pg_advisory_lock') || sql.includes('pg_advisory_unlock')) {
      return { rows: [] }
    }
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [] }
    }
    if (sql.includes('FROM invoices')) {
      if (opts.invoice === null) return { rows: [] }
      return {
        rows: [
          opts.invoice ?? {
            id: INVOICE_ID,
            profile_id: PROFILE_ID,
            state: 'Unpaid',
            adjustment_kind: null,
          },
        ],
      }
    }
    if (sql.includes('FROM storage_records')) {
      if (opts.storageStatus === null) return { rows: [] }
      return {
        rows: [
          {
            status: opts.storageStatus ?? 'active',
            metadata:
              opts.storageMetadata === undefined ? VALID_STORAGE_METADATA : opts.storageMetadata,
            file_size: opts.fileSize === undefined ? 4096 : opts.fileSize,
            content_type: opts.contentType === undefined ? 'application/pdf' : opts.contentType,
            category: opts.category === undefined ? 'document' : opts.category,
            file_name: opts.fileName === undefined ? 'slip.pdf' : opts.fileName,
          },
        ],
      }
    }
    if (sql.includes('UPDATE storage_records')) {
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('bank_receipt_attachment_claims')) {
      if (sql.includes('INSERT')) return { rows: [] }
      if (opts.claimType === null) return { rows: [] }
      return { rows: [{ claim_type: opts.claimType ?? 'invoice_receipt' }] }
    }
    if (sql.includes('FROM bank_receipts')) {
      return { rows: opts.existing ? [opts.existing] : [] }
    }
    if (sql.includes('INSERT INTO bank_receipts')) {
      if (opts.insert instanceof Error) throw opts.insert
      const attachmentKey =
        Array.isArray(params) && typeof params[5] === 'string' ? params[5] : ATTACHMENT
      return { rows: [opts.insert ?? makeReceiptRow({ attachment_key: attachmentKey })] }
    }
    return { rows: [] }
  })
}

function submitInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: ACTOR_ID,
    invoiceId: INVOICE_ID,
    amount: Number(AMOUNT),
    paymentDate: RECEIPT.paymentDate,
    payerReference: RECEIPT.payerReference,
    attachmentKey: RECEIPT.attachmentKey,
    customerNote: RECEIPT.customerNote,
    ...overrides,
  }
}

function pdfBytes(size = 4096): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(new TextEncoder().encode('%PDF-1.4\n'))
  return bytes
}

function zipBytes(size = 4096): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes.set(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
  return bytes
}

function bytesBody(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (bytes.byteLength > 0) controller.enqueue(bytes)
      controller.close()
    },
  })
}

function storageWithObjects(
  objects: Map<string, Uint8Array>,
  options: { missing?: boolean } = {},
): StorageProvider {
  return {
    putObject: vi.fn(async (key: string, body: ReadableStream | Blob | Uint8Array | string) => {
      if (body instanceof Uint8Array) objects.set(key, body)
    }),
    getObject: vi.fn(async (key: string) => {
      if (options.missing) throw new StorageObjectNotFound(key)
      const bytes = objects.get(key)
      if (!bytes) throw new StorageObjectNotFound(key)
      return {
        body: bytesBody(bytes),
        contentType: 'application/pdf',
        contentLength: bytes.byteLength,
        metadata: {},
        etag: undefined,
      }
    }),
    deleteObject: vi.fn(),
    presignedPutUrl: vi.fn(),
    presignedGetUrl: vi.fn(),
    listObjects: vi.fn(),
  }
}

describe('InvoiceBankReceiptUploadService (T-04.3.01.02)', () => {
  let customerInvoices: { resolveActiveProfileId: ReturnType<typeof vi.fn> }
  let service: InvoiceBankReceiptUploadService
  let objects: Map<string, Uint8Array>
  let storage: StorageProvider

  function buildService(seed: Uint8Array | 'missing' = pdfBytes(4096)) {
    objects = new Map()
    if (seed !== 'missing') objects.set(ATTACHMENT, seed)
    storage = storageWithObjects(objects, { missing: seed === 'missing' })
    service = new InvoiceBankReceiptUploadService(
      customerInvoices as unknown as CustomerInvoiceDetailsService,
      storage,
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.release.mockImplementation(() => {})
    mockClient.query.mockReset()
    customerInvoices = {
      resolveActiveProfileId: vi.fn().mockResolvedValue(PROFILE_ID),
    }
    buildService()
  })

  it('rejects a non-positive amount before touching the database', async () => {
    await expect(service.submit(submitInput({ amount: 0 }))).rejects.toMatchObject({
      status: 400,
    })
    expect(customerInvoices.resolveActiveProfileId).not.toHaveBeenCalled()
    expect(mockPool.connect).not.toHaveBeenCalled()
  })

  it('creates a Submitted receipt bound to a sealed copy, not the mutable upload key', async () => {
    scriptClient()
    const result = await service.submit(submitInput())
    expect(result.state).toBe('Submitted')
    expect(result.amount).toBe(AMOUNT)
    expect(result.invoiceId).toBe(INVOICE_ID)
    expect(result.attachmentKey).toBe(SEALED)
    const insert = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO bank_receipts'),
    )
    expect(insert?.[1]?.[2]).toBe(AMOUNT.toString())
    expect(insert?.[1]?.[5]).toBe(SEALED)
    expect(insert?.[0]).toContain("'Submitted'")
    expect(storage.putObject).toHaveBeenCalledWith(SEALED, expect.any(Uint8Array), 'application/pdf')
    expect(objects.get(SEALED)?.subarray(0, 5)).toEqual(new TextEncoder().encode('%PDF-'))
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE invoices')),
    ).toBe(false)
  })

  it('rejects a missing storage record so fabricated keys cannot insert', async () => {
    scriptClient({ storageStatus: null })
    const rejection = await service.submit(submitInput()).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    })
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO bank_receipts')),
    ).toBe(false)
  })

  it('rejects an oversize stored file', async () => {
    const oversize = 10 * 1024 * 1024 + 1
    scriptClient({ fileSize: oversize })
    buildService(pdfBytes(oversize))
    const rejection = await service.submit(submitInput()).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
      message: expect.stringMatching(/size/i),
    })
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO bank_receipts')),
    ).toBe(false)
  })

  it('rejects a large object when the recorded fileSize is forged small', async () => {
    scriptClient({ fileSize: 4096 })
    buildService(pdfBytes(10 * 1024 * 1024 + 1))
    const rejection = await service.submit(submitInput()).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
      message: expect.stringMatching(/size/i),
    })
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO bank_receipts')),
    ).toBe(false)
  })

  it('rejects submission when the stored object is missing', async () => {
    scriptClient({ fileSize: 4096 })
    buildService('missing')
    const rejection = await service.submit(submitInput()).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
      message: expect.stringMatching(/verif/i),
    })
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO bank_receipts')),
    ).toBe(false)
  })

  it('rejects when recorded size differs from a still-allowed actual size', async () => {
    scriptClient({ fileSize: 1024 })
    buildService(pdfBytes(2048))
    const rejection = await service.submit(submitInput()).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
      message: expect.stringMatching(/match/i),
    })
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO bank_receipts')),
    ).toBe(false)
  })

  it('rejects ZIP bytes even when the recorded content type is still PDF', async () => {
    scriptClient({ contentType: 'application/pdf' })
    buildService(zipBytes(4096))
    const rejection = await service.submit(submitInput()).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
      message: expect.stringMatching(/PDF|JPEG|PNG|WebP/i),
    })
    expect(storage.putObject).not.toHaveBeenCalled()
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO bank_receipts')),
    ).toBe(false)
  })

  it('does not recopy a mutable upload when the sealed receipt already exists', async () => {
    scriptClient({ existing: makeReceiptRow({ attachment_key: SEALED }) })
    objects.set(ATTACHMENT, zipBytes(4096))
    const result = await service.submit(submitInput())
    expect(result.receiptId).toBe(RECEIPT_ID)
    expect(result.attachmentKey).toBe(SEALED)
    expect(storage.putObject).not.toHaveBeenCalled()
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO bank_receipts')),
    ).toBe(false)
  })

  it('rejects an invoice in a non-submittable state', async () => {
    scriptClient({
      invoice: {
        id: INVOICE_ID,
        profile_id: PROFILE_ID,
        state: 'Paid',
        adjustment_kind: null,
      },
    })
    const rejection = await service.submit(submitInput()).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.CONFLICT_STATE.code,
    })
  })

  it('rejects a credit-note invoice', async () => {
    scriptClient({
      invoice: {
        id: INVOICE_ID,
        profile_id: PROFILE_ID,
        state: 'Unpaid',
        adjustment_kind: 'credit',
      },
    })
    await expect(service.submit(submitInput())).rejects.toMatchObject({ status: 409 })
  })

  it('returns the original Submitted row when the same attachment is retried', async () => {
    scriptClient({ existing: makeReceiptRow() })
    const result = await service.submit(submitInput())
    expect(result.receiptId).toBe(RECEIPT_ID)
    expect(result.state).toBe('Submitted')
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO bank_receipts')),
    ).toBe(false)
  })

  it('conflicts when the same attachment was used with different details', async () => {
    scriptClient({ existing: makeReceiptRow({ amount: '1' }) })
    await expect(service.submit(submitInput())).rejects.toBeInstanceOf(ConflictException)
  })

  it('conflicts when the attachment is already claimed by a wallet top-up', async () => {
    scriptClient({ claimType: 'wallet_topup' })
    await expect(service.submit(submitInput())).rejects.toBeInstanceOf(ConflictException)
    expect(
      mockClient.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO bank_receipts')),
    ).toBe(false)
  })

  it('404s when the invoice is not on the active profile', async () => {
    scriptClient({ invoice: null })
    const rejection = await service.submit(submitInput()).catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.NOT_FOUND_RESOURCE.code,
    })
  })
})
