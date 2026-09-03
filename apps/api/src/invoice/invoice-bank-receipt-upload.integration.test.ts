/**
 * Real-PostgreSQL integration tests for customer invoice bank-receipt
 * upload (T-04.3.01.02).
 *
 * Proves against actual PostgreSQL:
 *   1. A valid receipt inserts a `Submitted` bank_receipts row and
 *      leaves the invoice state unchanged.
 *   2. Amount must be positive; zero is rejected before insert.
 *   3. Stored file type and size are enforced from the trusted storage
 *      object size (not a client-declared storage_records.file_size).
 *   4. Retrying the same attachment with matching details returns the
 *      original Submitted row.
 *   5. A colliding attachment with different details is a conflict.
 *   6. Concurrent same-attachment submissions insert exactly one row.
 *   7. An active receipt becomes immutable in the same transaction.
 *   8. Other-profile invoices 404; Paid invoices 409.
 *   9. A large object with a forged small recorded fileSize is rejected.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { ConflictException, HttpException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import { BANK_RECEIPT_STORAGE_PURPOSE } from '@barghsa/shared/finance'
import { ErrorCodes } from '@barghsa/shared/errors'
import { InvoiceBankReceiptUploadService } from './invoice-bank-receipt-upload.service.js'
import { CustomerInvoiceDetailsService } from './customer-invoice-details.service.js'
import type { StorageProvider } from '@barghsa/shared/storage'

const poolHolder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }))

vi.mock('@barghsa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@barghsa/db')>()
  return {
    ...actual,
    getDbPool: () => {
      if (!poolHolder.pool) {
        throw new Error('test pool not initialized — beforeAll must run first')
      }
      return poolHolder.pool
    },
  }
})

const UUIDV7_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0000_init_uuidv7_function.sql',
)
const INVOICES_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0052_add_invoice_amount_check_constraints.sql',
)
const ADJUSTMENT_KIND_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0067_invoice_adjustment_kind_accounting_amount.sql',
)
const BANK_RECEIPTS_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0078_create_bank_receipts.sql',
)
const ATTACHMENT_CLAIMS_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0079_create_bank_receipt_attachment_claims.sql',
)

const PROFILE_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const PROFILE_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const INVOICE_A = '11111111-1111-7111-8111-111111111111'
const INVOICE_B = '22222222-2222-7222-8222-222222222222'
const ACTOR_ID = 'user-customer-1'
const OTHER_ACTOR = 'user-customer-2'

function receiptKey(suffix: string): string {
  const pad = suffix.replace(/[^0-9a-f]/gi, 'a').padStart(12, '0').slice(0, 12)
  return `uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-${pad}.pdf`
}

function cancellableBody(): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.close()
    },
  })
}

function storageProviderWithSizes(sizes: Map<string, number | undefined>): StorageProvider {
  return {
    putObject: async () => {},
    getObject: async (key: string) => ({
      body: cancellableBody(),
      contentType: 'application/pdf',
      contentLength: sizes.has(key) ? sizes.get(key) : 4096,
      metadata: {},
      etag: undefined,
    }),
    deleteObject: async () => {},
    presignedPutUrl: async () => '',
    presignedGetUrl: async () => '',
    listObjects: async () => ({ items: [], isTruncated: false, continuationToken: undefined }),
  }
}

describe('InvoiceBankReceiptUploadService — real PostgreSQL (T-04.3.01.02)', () => {
  let ctx: IsolatedTestDb
  let service: InvoiceBankReceiptUploadService
  const objectSizes = new Map<string, number | undefined>()

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 4)
    poolHolder.pool = ctx.pool
    service = new InvoiceBankReceiptUploadService(
      new CustomerInvoiceDetailsService(),
      storageProviderWithSizes(objectSizes),
    )

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY
      )
    `)
    await ctx.pool.query(`
      DO $seed$
      BEGIN
        CREATE TYPE invoice_state AS ENUM (
          'Draft', 'Unpaid', 'PaymentUnderReview', 'PartiallyFunded', 'Paid',
          'Overdue', 'Cancelled', 'PartiallyRefunded', 'Refunded'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END
      $seed$
    `)
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
        user_id TEXT NOT NULL,
        archived BOOLEAN NOT NULL DEFAULT false,
        is_default BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(readFileSync(INVOICES_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(ADJUSTMENT_KIND_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(BANK_RECEIPTS_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(ATTACHMENT_CLAIMS_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS storage_records (
        storage_key TEXT PRIMARY KEY,
        file_name TEXT,
        content_type TEXT,
        file_size BIGINT,
        category TEXT,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'immutable', 'removed')),
        metadata JSONB,
        signed_at TIMESTAMPTZ,
        signed_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await ctx.pool.query(`INSERT INTO users (user_id) VALUES ($1), ($2)`, [ACTOR_ID, OTHER_ACTOR])
    await ctx.pool.query(
      `INSERT INTO profiles (id, user_id, is_default) VALUES ($1, $2, true), ($3, $4, true)`,
      [PROFILE_A, ACTOR_ID, PROFILE_B, OTHER_ACTOR],
    )
  }, 60_000)

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  beforeEach(async () => {
    objectSizes.clear()
    await ctx.pool.query(
      `TRUNCATE bank_receipts, bank_receipt_attachment_claims, invoices, storage_records CASCADE`,
    )
    await ctx.pool.query(
      `INSERT INTO invoices (id, profile_id, state, total_amount)
       VALUES ($1, $2, 'Unpaid', 5000000), ($3, $4, 'Paid', 1000000)`,
      [INVOICE_A, PROFILE_A, INVOICE_B, PROFILE_B],
    )
  })

  async function insertReceiptFile(
    storageKey: string,
    overrides: {
      metadata?: Record<string, unknown>
      fileSize?: number | null
      contentType?: string | null
      category?: string | null
      fileName?: string | null
      status?: string
    } = {},
  ): Promise<void> {
    const metadata = {
      verified: true,
      uploadedBy: ACTOR_ID,
      profileId: PROFILE_A,
      purpose: BANK_RECEIPT_STORAGE_PURPOSE,
      ...overrides.metadata,
    }
    await ctx.pool.query(
      `INSERT INTO storage_records
         (storage_key, status, metadata, file_size, content_type, category, file_name)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)`,
      [
        storageKey,
        overrides.status ?? 'active',
        JSON.stringify(metadata),
        overrides.fileSize === undefined ? 4096 : overrides.fileSize,
        overrides.contentType === undefined ? 'application/pdf' : overrides.contentType,
        overrides.category === undefined ? 'document' : overrides.category,
        overrides.fileName === undefined ? 'slip.pdf' : overrides.fileName,
      ],
    )
    if (!objectSizes.has(storageKey)) {
      objectSizes.set(
        storageKey,
        overrides.fileSize === undefined ? 4096 : (overrides.fileSize ?? undefined),
      )
    }
  }

  function payload(overrides: Record<string, unknown> = {}) {
    return {
      userId: ACTOR_ID,
      invoiceId: INVOICE_A,
      amount: 250_000,
      paymentDate: '2026-08-15',
      payerReference: 'TRK-998877',
      attachmentKey: receiptKey('happy0000001'),
      customerNote: 'Branch transfer',
      ...overrides,
    }
  }

  it('creates a Submitted receipt and leaves the invoice Unpaid', async () => {
    const attachment = receiptKey('happy0000001')
    await insertReceiptFile(attachment)
    const result = await service.submit(payload({ attachmentKey: attachment }))

    expect(result.state).toBe('Submitted')
    expect(result.amount).toBe(250_000n)
    expect(result.invoiceId).toBe(INVOICE_A)
    expect(result.attachmentKey).toBe(attachment)

    const invoice = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM invoices WHERE id = $1`,
      [INVOICE_A],
    )
    expect(invoice.rows[0]!.state).toBe('Unpaid')

    const stored = await ctx.pool.query<{ state: string; confirmed_by: string | null }>(
      `SELECT state, confirmed_by FROM bank_receipts WHERE id = $1`,
      [result.receiptId],
    )
    expect(stored.rows[0]).toMatchObject({ state: 'Submitted', confirmed_by: null })

    const storage = await ctx.pool.query<{ status: string }>(
      `SELECT status FROM storage_records WHERE storage_key = $1`,
      [attachment],
    )
    expect(storage.rows[0]!.status).toBe('immutable')

    const claim = await ctx.pool.query<{ claim_type: string }>(
      `SELECT claim_type FROM bank_receipt_attachment_claims WHERE storage_key = $1`,
      [attachment],
    )
    expect(claim.rows[0]!.claim_type).toBe('invoice_receipt')
  })

  it('rejects a zero amount before insert', async () => {
    const attachment = receiptKey('zero00000001')
    await insertReceiptFile(attachment)
    await expect(service.submit(payload({ amount: 0, attachmentKey: attachment }))).rejects.toMatchObject(
      { status: 400 },
    )
    const count = await ctx.pool.query(`SELECT count(*)::int AS n FROM bank_receipts`)
    expect(count.rows[0]!.n).toBe(0)
  })

  it('rejects an oversize stored PDF', async () => {
    const attachment = receiptKey('oversize0001')
    await insertReceiptFile(attachment, { fileSize: 10 * 1024 * 1024 + 1 })
    const rejection = await service.submit(payload({ attachmentKey: attachment })).catch((e: unknown) => e)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    })
    const count = await ctx.pool.query(`SELECT count(*)::int AS n FROM bank_receipts`)
    expect(count.rows[0]!.n).toBe(0)
  })

  it('rejects a large object when the recorded fileSize is forged small', async () => {
    const attachment = receiptKey('forgedsize01')
    await insertReceiptFile(attachment, { fileSize: 4096 })
    objectSizes.set(attachment, 10 * 1024 * 1024 + 1)
    const rejection = await service.submit(payload({ attachmentKey: attachment })).catch((e: unknown) => e)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
      message: expect.stringMatching(/size/i),
    })
    const count = await ctx.pool.query(`SELECT count(*)::int AS n FROM bank_receipts`)
    expect(count.rows[0]!.n).toBe(0)
  })

  it('rejects a stored ZIP even when the key claims to be a PDF', async () => {
    const attachment = receiptKey('zipfile00001')
    await insertReceiptFile(attachment, { contentType: 'application/zip' })
    await expect(service.submit(payload({ attachmentKey: attachment }))).rejects.toMatchObject({
      status: 400,
    })
  })

  it('returns the original row on matching retry of the same attachment', async () => {
    const attachment = receiptKey('retry0000001')
    await insertReceiptFile(attachment)
    const first = await service.submit(payload({ attachmentKey: attachment }))
    const second = await service.submit(payload({ attachmentKey: attachment }))
    expect(second.receiptId).toBe(first.receiptId)
    const count = await ctx.pool.query(`SELECT count(*)::int AS n FROM bank_receipts`)
    expect(count.rows[0]!.n).toBe(1)
  })

  it('conflicts when the same file is reused with a different amount', async () => {
    const attachment = receiptKey('collide00001')
    await insertReceiptFile(attachment)
    await service.submit(payload({ attachmentKey: attachment, amount: 250_000 }))
    await expect(
      service.submit(payload({ attachmentKey: attachment, amount: 300_000 })),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('404s for another profile invoice and 409s for a Paid invoice on the same profile', async () => {
    const otherKey = receiptKey('other0000001')
    await insertReceiptFile(otherKey)
    const missing = await service
      .submit(payload({ invoiceId: INVOICE_B, attachmentKey: otherKey }))
      .catch((e: unknown) => e)
    expect(missing).toBeInstanceOf(HttpException)
    expect((missing as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.NOT_FOUND_RESOURCE.code,
    })

    await ctx.pool.query(`UPDATE invoices SET state = 'Paid' WHERE id = $1`, [INVOICE_A])
    const paidKey = receiptKey('paid00000001')
    await insertReceiptFile(paidKey)
    const paid = await service.submit(payload({ attachmentKey: paidKey })).catch((e: unknown) => e)
    expect(paid).toBeInstanceOf(HttpException)
    expect((paid as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.CONFLICT_STATE.code,
    })
  })

  it('inserts exactly one row under concurrent same-attachment retries', async () => {
    const attachment = receiptKey('race00000001')
    await insertReceiptFile(attachment)
    const [a, b] = await Promise.all([
      service.submit(payload({ attachmentKey: attachment })),
      service.submit(payload({ attachmentKey: attachment })),
    ])
    expect(a.receiptId).toBe(b.receiptId)
    const count = await ctx.pool.query(`SELECT count(*)::int AS n FROM bank_receipts`)
    expect(count.rows[0]!.n).toBe(1)
    const claims = await ctx.pool.query(`SELECT count(*)::int AS n FROM bank_receipt_attachment_claims`)
    expect(claims.rows[0]!.n).toBe(1)
  })
})
