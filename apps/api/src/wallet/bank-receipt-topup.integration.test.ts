/**
 * Real-PostgreSQL integration tests for bank-receipt top-up submission
 * (T-04.2.02.03).
 *
 * Proves against actual PostgreSQL:
 *   1. A valid receipt creates a Pending topup ledger row and does not
 *      change posted_balance or reserved_balance (no credit).
 *   2. Amounts above the online top-up limit are accepted.
 *   3. Retrying with the same idempotency key returns the original
 *      Pending row and does not insert a second transaction.
 *   4. A colliding key with a different receipt is ConflictException.
 *   5. A missing storage_records row is rejected before insert.
 *   6. Concurrent same-key retries insert exactly one Pending row.
 *   7. An active receipt becomes immutable in the same transaction,
 *      so the storage delete path cannot physically remove it.
 *   8. Unverified, wrong-owner, and wrong-purpose keys are rejected.
 *   9. Simultaneous submissions of one attachment with different
 *      idempotency keys insert exactly one Pending row.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { ConflictException, HttpException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedTestDb, dropTestSchema } from '@barghsa/db/test'
import type { IsolatedTestDb } from '@barghsa/db/test'
import {
  BANK_RECEIPT_STORAGE_PURPOSE,
  BANK_RECEIPT_TOPUP_CHANNEL,
} from '@barghsa/shared/finance'
import {
  ImmutableRecordDeleteError,
  ImmutableStorageRecordService,
  type DbAdapter,
  type StorageProvider,
} from '@barghsa/shared/storage'
import { WalletService } from './wallet.service.js'
import { BankReceiptTopUpService } from './bank-receipt-topup.service.js'

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
const WALLET_TX_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0068_create_wallet_transactions.sql',
)
const ATTACHMENT_UNIQUE_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0072_wallet_tx_receipt_attachment_unique.sql',
)
const ATTACHMENT_CLAIMS_MIGRATION = resolve(
  __dirname,
  '../../../../packages/db/drizzle/0079_create_bank_receipt_attachment_claims.sql',
)

const PROFILE_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const PROFILE_B = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const ACTOR_ID = 'user-customer-1'
const OTHER_ACTOR = 'user-customer-2'

function receiptKey(suffix: string): string {
  const pad = suffix.replace(/[^0-9a-f]/gi, 'a').padStart(12, '0').slice(0, 12)
  return `uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-${pad}.pdf`
}

describe('BankReceiptTopUpService — real PostgreSQL (T-04.2.02.03)', () => {
  let ctx: IsolatedTestDb
  let walletService: WalletService
  let service: BankReceiptTopUpService

  beforeAll(async () => {
    ctx = await createIsolatedTestDb('test_', 4)
    poolHolder.pool = ctx.pool
    walletService = new WalletService()
    service = new BankReceiptTopUpService(walletService)

    await ctx.pool.query(readFileSync(UUIDV7_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v7()
      )
    `)
    await ctx.pool.query(readFileSync(WALLET_TX_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(ATTACHMENT_UNIQUE_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(readFileSync(ATTACHMENT_CLAIMS_MIGRATION, 'utf-8').trim())
    await ctx.pool.query(`
      CREATE TABLE IF NOT EXISTS storage_records (
        storage_key TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'immutable', 'removed')),
        metadata JSONB,
        signed_at TIMESTAMPTZ,
        signed_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await ctx.pool.query(`INSERT INTO profiles (id) VALUES ($1), ($2)`, [PROFILE_A, PROFILE_B])
    await ctx.pool.query(`INSERT INTO wallets (profile_id) VALUES ($1)`, [PROFILE_A])
  }, 60_000)

  afterAll(async () => {
    poolHolder.pool = null
    await ctx.pool.end()
    await dropTestSchema(ctx.schemaName)
  })

  async function insertReceipt(
    storageKey: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    const metadata = {
      verified: true,
      uploadedBy: ACTOR_ID,
      profileId: PROFILE_A,
      purpose: BANK_RECEIPT_STORAGE_PURPOSE,
      ...overrides,
    }
    await ctx.pool.query(
      `INSERT INTO storage_records (storage_key, status, metadata) VALUES ($1, 'active', $2::jsonb)`,
      [storageKey, JSON.stringify(metadata)],
    )
  }

  async function fetchWallet(profileId: string) {
    const result = await ctx.pool.query<{
      posted_balance: string
      reserved_balance: string
      version: number
    }>(
      `SELECT posted_balance::text AS posted_balance,
              reserved_balance::text AS reserved_balance,
              version
       FROM wallets WHERE profile_id = $1`,
      [profileId],
    )
    return result.rows[0]!
  }

  async function fetchLedger(profileId: string) {
    const result = await ctx.pool.query<{
      id: string
      type: string
      amount: string
      state: string
      idempotency_key: string
      receipt_attachment_key: string | null
      metadata: unknown
    }>(
      `SELECT id, type, amount::text AS amount, state, idempotency_key,
              receipt_attachment_key, metadata
       FROM wallet_transactions
       WHERE wallet_id = $1
       ORDER BY created_at, id`,
      [profileId],
    )
    return result.rows
  }

  function payload(overrides: Record<string, unknown> = {}) {
    return {
      profileId: PROFILE_A,
      amount: 250_000,
      paymentDate: '2026-08-15',
      payerReference: 'TRK-998877',
      attachmentKey: receiptKey('happy0000001'),
      customerNote: 'Branch transfer',
      idempotencyKey: 'bank-receipt-happy',
      actorId: ACTOR_ID,
      ...overrides,
    }
  }

  it('creates a Pending top-up and leaves balances unchanged', async () => {
    const attachment = receiptKey('happy0000001')
    await insertReceipt(attachment)
    const before = await fetchWallet(PROFILE_A)
    const result = await service.submit(payload({ attachmentKey: attachment }))

    expect(result.state).toBe('Pending')
    expect(result.amount).toBe(250_000n)
    expect(result.attachmentKey).toBe(attachment)

    const after = await fetchWallet(PROFILE_A)
    expect(after.posted_balance).toBe(before.posted_balance)
    expect(after.reserved_balance).toBe(before.reserved_balance)
    expect(after.version).toBe(before.version)

    const ledger = await fetchLedger(PROFILE_A)
    const row = ledger.find((entry) => entry.idempotency_key === 'bank-receipt-happy')
    expect(row).toMatchObject({
      type: 'topup',
      amount: '250000',
      state: 'Pending',
      receipt_attachment_key: attachment,
    })
    expect(row!.metadata).toMatchObject({
      channel: BANK_RECEIPT_TOPUP_CHANNEL,
      receipt: {
        paymentDate: '2026-08-15',
        payerReference: 'TRK-998877',
        attachmentKey: attachment,
        customerNote: 'Branch transfer',
      },
    })
  })

  it('accepts an amount above the online top-up limit', async () => {
    const attachment = receiptKey('overlimit0001')
    await insertReceipt(attachment)
    const result = await service.submit(
      payload({
        amount: 3_000_000_000,
        idempotencyKey: 'bank-receipt-over-online-limit',
        attachmentKey: attachment,
      }),
    )
    expect(result.state).toBe('Pending')
    expect(result.amount).toBe(3_000_000_000n)
    const after = await fetchWallet(PROFILE_A)
    expect(after.posted_balance).toBe('0')
  })

  it('creates the wallet when missing and still inserts a Pending top-up', async () => {
    const attachment = receiptKey('newwallet0001')
    await insertReceipt(attachment, { profileId: PROFILE_B })
    const result = await service.submit(
      payload({
        profileId: PROFILE_B,
        idempotencyKey: 'bank-receipt-new-wallet',
        attachmentKey: attachment,
      }),
    )
    expect(result.state).toBe('Pending')
    const wallet = await fetchWallet(PROFILE_B)
    expect(wallet.posted_balance).toBe('0')
    expect(wallet.reserved_balance).toBe('0')
  })

  it('reuses the original Pending row on idempotent retry', async () => {
    const attachment = receiptKey('retry00000001')
    await insertReceipt(attachment)
    const first = await service.submit(
      payload({ idempotencyKey: 'bank-receipt-retry', attachmentKey: attachment }),
    )
    const second = await service.submit(
      payload({ idempotencyKey: 'bank-receipt-retry', attachmentKey: attachment }),
    )
    expect(second.transactionId).toBe(first.transactionId)
    const ledger = await fetchLedger(PROFILE_A)
    expect(ledger.filter((row) => row.idempotency_key === 'bank-receipt-retry')).toHaveLength(1)
  })

  it('conflicts when the same key is reused with a different receipt', async () => {
    const attachment = receiptKey('conflict00001')
    await insertReceipt(attachment)
    await service.submit(
      payload({ idempotencyKey: 'bank-receipt-conflict', attachmentKey: attachment }),
    )
    await expect(
      service.submit(
        payload({
          idempotencyKey: 'bank-receipt-conflict',
          amount: 1000,
          attachmentKey: attachment,
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('rejects an attachment that was never recorded', async () => {
    const rejection = await service
      .submit(
        payload({
          idempotencyKey: 'bank-receipt-missing-file',
          attachmentKey: receiptKey('missing000001'),
        }),
      )
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    const ledger = await fetchLedger(PROFILE_A)
    expect(ledger.some((row) => row.idempotency_key === 'bank-receipt-missing-file')).toBe(false)
  })

  it('rejects an unverified storage record before insert', async () => {
    const attachment = receiptKey('unverified001')
    await insertReceipt(attachment, { verified: false })
    const rejection = await service
      .submit(
        payload({
          idempotencyKey: 'bank-receipt-unverified',
          attachmentKey: attachment,
        }),
      )
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      message: 'Bank receipt attachment has not been verified',
    })
    const ledger = await fetchLedger(PROFILE_A)
    expect(ledger.some((row) => row.idempotency_key === 'bank-receipt-unverified')).toBe(false)
  })

  it('rejects a storage record owned by a different user and profile', async () => {
    const attachment = receiptKey('wrongowner001')
    await insertReceipt(attachment, {
      uploadedBy: OTHER_ACTOR,
      profileId: PROFILE_B,
    })
    const rejection = await service
      .submit(
        payload({
          idempotencyKey: 'bank-receipt-wrong-owner',
          attachmentKey: attachment,
        }),
      )
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      message: 'Bank receipt attachment does not belong to this account',
    })
    const ledger = await fetchLedger(PROFILE_A)
    expect(ledger.some((row) => row.idempotency_key === 'bank-receipt-wrong-owner')).toBe(false)
  })

  it('rejects a storage record recorded for a different purpose', async () => {
    const attachment = receiptKey('wrongpurpose1')
    await insertReceipt(attachment, { purpose: 'contract' })
    const rejection = await service
      .submit(
        payload({
          idempotencyKey: 'bank-receipt-wrong-purpose',
          attachmentKey: attachment,
        }),
      )
      .catch((error: unknown) => error)
    expect(rejection).toBeInstanceOf(HttpException)
    expect((rejection as HttpException).getResponse()).toMatchObject({
      message: 'Bank receipt attachment was not uploaded as a bank receipt',
    })
    const ledger = await fetchLedger(PROFILE_A)
    expect(ledger.some((row) => row.idempotency_key === 'bank-receipt-wrong-purpose')).toBe(false)
  })

  it('serializes concurrent retries onto a single Pending row', async () => {
    const attachment = receiptKey('concurrent001')
    await insertReceipt(attachment)
    const key = 'bank-receipt-concurrent'
    const [a, b] = await Promise.all([
      service.submit(payload({ idempotencyKey: key, attachmentKey: attachment })),
      service.submit(payload({ idempotencyKey: key, attachmentKey: attachment })),
    ])
    expect(a.transactionId).toBe(b.transactionId)
    const ledger = await fetchLedger(PROFILE_A)
    expect(ledger.filter((row) => row.idempotency_key === key)).toHaveLength(1)
  })

  it('rejects simultaneous submissions of one attachment with different idempotency keys', async () => {
    const attachment = receiptKey('raceattach001')
    await insertReceipt(attachment)
    const results = await Promise.allSettled([
      service.submit(
        payload({
          idempotencyKey: 'bank-receipt-race-a',
          attachmentKey: attachment,
        }),
      ),
      service.submit(
        payload({
          idempotencyKey: 'bank-receipt-race-b',
          attachmentKey: attachment,
        }),
      ),
    ])
    const fulfilled = results.filter((row) => row.status === 'fulfilled')
    const rejected = results.filter((row) => row.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException)
    const ledger = await fetchLedger(PROFILE_A)
    expect(
      ledger.filter((row) => row.receipt_attachment_key === attachment),
    ).toHaveLength(1)
  })

  it('freezes the receipt as immutable so it cannot be physically deleted after Pending is committed', async () => {
    const protectedKey = receiptKey('protected0001')
    await insertReceipt(protectedKey)

    await service.submit(
      payload({
        idempotencyKey: 'bank-receipt-lock-evidence',
        attachmentKey: protectedKey,
      }),
    )

    const stored = await ctx.pool.query<{ status: string; signed_by: string | null }>(
      `SELECT status, signed_by FROM storage_records WHERE storage_key = $1`,
      [protectedKey],
    )
    expect(stored.rows[0]).toMatchObject({
      status: 'immutable',
      signed_by: ACTOR_ID,
    })

    const deleteObject = vi.fn()
    const adapter: DbAdapter = {
      createStorageRecord: async () => undefined,
      getStorageRecordStatus: async (storageKey) => {
        const result = await ctx.pool.query<{ status: 'active' | 'immutable' | 'removed' }>(
          `SELECT status FROM storage_records WHERE storage_key = $1`,
          [storageKey],
        )
        return result.rows[0]?.status ?? null
      },
      markStorageRecordImmutable: async () => undefined,
      softDeleteStorageRecord: async (storageKey) => {
        await ctx.pool.query(
          `UPDATE storage_records SET status = 'removed' WHERE storage_key = $1`,
          [storageKey],
        )
      },
      updateStorageRecordMetadata: async () => undefined,
    }
    const storageService = new ImmutableStorageRecordService(
      { deleteObject } as unknown as StorageProvider,
      adapter,
    )

    await expect(storageService.deleteRecord(protectedKey)).rejects.toBeInstanceOf(
      ImmutableRecordDeleteError,
    )
    expect(deleteObject).not.toHaveBeenCalled()

    const afterDelete = await ctx.pool.query<{ status: string }>(
      `SELECT status FROM storage_records WHERE storage_key = $1`,
      [protectedKey],
    )
    expect(afterDelete.rows[0]?.status).toBe('removed')
  })
})
