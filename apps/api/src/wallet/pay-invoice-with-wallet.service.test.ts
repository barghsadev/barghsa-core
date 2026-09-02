/**
 * Unit tests for PayInvoiceWithWalletService (T-04.2.03.01).
 *
 * Mocks `getDbPool`, `WalletService.debit`, and invoice transitions.
 * Covers: full remaining debit + Paid, PartiallyFunded remaining,
 * insufficient balance rollback, idempotent replay, profile isolation,
 * credit notes, non-payable states, and debit joining the same client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import {
  PAY_INVOICE_WITH_WALLET_DESCRIPTION,
  PAY_INVOICE_WITH_WALLET_ERRORS,
  payInvoiceWithWalletMetadata,
} from '@barghsa/shared/finance'
import { PayInvoiceWithWalletService } from './pay-invoice-with-wallet.service.js'
import type { WalletService } from './wallet.service.js'
import type { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js'

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}

const mockPool = {
  connect: vi.fn().mockResolvedValue(mockClient),
  query: vi.fn(),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

const INVOICE_ID = '11111111-1111-7111-8111-111111111111'
const PROFILE_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const OTHER_PROFILE = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const TX_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'
const ACTOR_ID = 'user-owner-1'
const NOW = new Date('2026-09-02T08:00:00.000Z')
const IDEMPOTENCY_KEY = 'pay-invoice-wallet:inv-1'

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    profile_id: PROFILE_ID,
    state: 'Unpaid',
    total_amount: '1000000',
    paid_amount: '0',
    refunded_amount: '0',
    adjustment_kind: null,
    payable_from: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }
}

function debitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TX_ID,
    walletId: PROFILE_ID,
    type: 'payment',
    amount: -1_000_000n,
    state: 'Completed',
    idempotencyKey: IDEMPOTENCY_KEY,
    refId: INVOICE_ID,
    description: PAY_INVOICE_WITH_WALLET_DESCRIPTION,
    metadata: payInvoiceWithWalletMetadata({
      invoiceId: INVOICE_ID,
      remainingBefore: 1_000_000n,
      paidAmountAfter: 1_000_000n,
    }),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function ledgerSqlRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TX_ID,
    wallet_id: PROFILE_ID,
    type: 'payment',
    amount: '-1000000',
    state: 'Completed',
    idempotency_key: IDEMPOTENCY_KEY,
    ref_id: INVOICE_ID,
    description: PAY_INVOICE_WITH_WALLET_DESCRIPTION,
    metadata: {},
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

function mockQuery(handler: (sql: string, params?: unknown[]) => unknown) {
  mockClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [] }
    }
    return handler(sql, params)
  })
}

describe('PayInvoiceWithWalletService (T-04.2.03.01)', () => {
  let walletService: { debit: ReturnType<typeof vi.fn> }
  let invoiceStateMachine: {
    canPayFromWallet: ReturnType<typeof vi.fn>
    transition: ReturnType<typeof vi.fn>
  }
  let service: PayInvoiceWithWalletService

  beforeEach(() => {
    vi.clearAllMocks()
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.release.mockImplementation(() => {})
    walletService = {
      debit: vi.fn().mockResolvedValue(debitRow()),
    }
    invoiceStateMachine = {
      canPayFromWallet: vi.fn(
        (from: string, adjustmentKind?: string | null) =>
          adjustmentKind !== 'credit' && (from === 'Unpaid' || from === 'PartiallyFunded'),
      ),
      transition: vi.fn().mockResolvedValue({
        invoiceId: INVOICE_ID,
        fromState: 'Unpaid',
        toState: 'Paid',
        transition: 'PayFromWallet',
        auditId: 'audit-1',
      }),
    }
    service = new PayInvoiceWithWalletService(
      walletService as unknown as WalletService,
      invoiceStateMachine as unknown as InvoiceStateMachineService,
    )
  })

  function pay(overrides: Record<string, unknown> = {}) {
    return service.payInvoiceWithWallet(
      (overrides.invoiceId as string) ?? INVOICE_ID,
      (overrides.profileId as string) ?? PROFILE_ID,
      (overrides.idempotencyKey as string) ?? IDEMPOTENCY_KEY,
      {
        actorUserId: ACTOR_ID,
        now: NOW,
        ip: '203.0.113.10',
        ...('options' in overrides ? (overrides.options as object) : {}),
      },
    )
  }

  it('debits the exact remaining amount and marks the invoice Paid in one transaction', async () => {
    mockQuery((sql) => {
      if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) {
        return { rows: [invoiceRow()] }
      }
      if (sql.includes('FROM wallet_transactions')) {
        return { rows: [] }
      }
      if (sql.includes('SET paid_amount')) {
        return { rows: [{ paid_amount: '1000000', total_amount: '1000000' }] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    })

    const result = await pay()

    expect(result).toMatchObject({
      invoiceId: INVOICE_ID,
      profileId: PROFILE_ID,
      fromState: 'Unpaid',
      toState: 'Paid',
      remainingPaid: 1_000_000n,
      auditId: 'audit-1',
      replayed: false,
    })
    expect(result.walletTransaction.id).toBe(TX_ID)

    expect(walletService.debit).toHaveBeenCalledTimes(1)
    expect(walletService.debit).toHaveBeenCalledWith(
      PROFILE_ID,
      1_000_000n,
      expect.objectContaining({
        type: 'payment',
        refId: INVOICE_ID,
        description: PAY_INVOICE_WITH_WALLET_DESCRIPTION,
      }),
      IDEMPOTENCY_KEY,
      mockClient,
    )
    expect(invoiceStateMachine.transition).toHaveBeenCalledWith(
      INVOICE_ID,
      'Unpaid',
      'Paid',
      expect.objectContaining({
        actorUserId: ACTOR_ID,
        now: NOW,
        client: mockClient,
        financials: expect.objectContaining({
          paidAmount: 1_000_000n,
          totalAmount: 1_000_000n,
          incomingPaidAmount: 1_000_000n,
        }),
      }),
    )
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    expect(mockClient.query).not.toHaveBeenCalledWith('ROLLBACK')
    expect(mockClient.release).toHaveBeenCalledOnce()

    const paidUpdate = mockClient.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('SET paid_amount'),
    )
    expect(paidUpdate?.[1]).toEqual([INVOICE_ID, '1000000'])
  })

  it('debits only the remaining amount on a PartiallyFunded invoice', async () => {
    walletService.debit.mockResolvedValue(
      debitRow({
        amount: -400_000n,
        metadata: payInvoiceWithWalletMetadata({
          invoiceId: INVOICE_ID,
          remainingBefore: 400_000n,
          paidAmountAfter: 1_000_000n,
        }),
      }),
    )
    invoiceStateMachine.transition.mockResolvedValue({
      invoiceId: INVOICE_ID,
      fromState: 'PartiallyFunded',
      toState: 'Paid',
      transition: 'PayFromWallet',
      auditId: 'audit-partial',
    })
    mockQuery((sql) => {
      if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) {
        return { rows: [invoiceRow({ state: 'PartiallyFunded', paid_amount: '600000' })] }
      }
      if (sql.includes('FROM wallet_transactions')) {
        return { rows: [] }
      }
      if (sql.includes('SET paid_amount')) {
        return { rows: [{ paid_amount: '1000000', total_amount: '1000000' }] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    })

    const result = await pay()

    expect(result.fromState).toBe('PartiallyFunded')
    expect(result.remainingPaid).toBe(400_000n)
    expect(walletService.debit).toHaveBeenCalledWith(
      PROFILE_ID,
      400_000n,
      expect.objectContaining({ type: 'payment', refId: INVOICE_ID }),
      IDEMPOTENCY_KEY,
      mockClient,
    )
  })

  it('rolls back the invoice when debit rejects insufficient availableBalance', async () => {
    walletService.debit.mockRejectedValue(
      new BadRequestException('Insufficient balance: available=100000, required=1000000'),
    )
    mockQuery((sql) => {
      if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) {
        return { rows: [invoiceRow()] }
      }
      if (sql.includes('FROM wallet_transactions')) {
        return { rows: [] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    })

    await expect(pay()).rejects.toThrow('Insufficient balance')
    expect(invoiceStateMachine.transition).not.toHaveBeenCalled()
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT')
    expect(
      mockClient.query.mock.calls.some(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('SET paid_amount'),
      ),
    ).toBe(false)
  })

  it('returns the original result on idempotent retry without debiting again', async () => {
    mockQuery((sql) => {
      if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) {
        return {
          rows: [invoiceRow({ state: 'Paid', paid_amount: '1000000' })],
        }
      }
      if (sql.includes('FROM wallet_transactions')) {
        return { rows: [ledgerSqlRow()] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    })

    const result = await pay()

    expect(result.replayed).toBe(true)
    expect(result.toState).toBe('Paid')
    expect(result.remainingPaid).toBe(1_000_000n)
    expect(result.walletTransaction.id).toBe(TX_ID)
    expect(walletService.debit).not.toHaveBeenCalled()
    expect(invoiceStateMachine.transition).not.toHaveBeenCalled()
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
  })

  it('settles an Unpaid invoice when a matching debit already exists (heal)', async () => {
    mockQuery((sql) => {
      if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) {
        return { rows: [invoiceRow()] }
      }
      if (sql.includes('FROM wallet_transactions')) {
        return { rows: [ledgerSqlRow()] }
      }
      if (sql.includes('SET paid_amount')) {
        return { rows: [{ paid_amount: '1000000', total_amount: '1000000' }] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    })

    const result = await pay()

    expect(result.replayed).toBe(true)
    expect(result.toState).toBe('Paid')
    expect(walletService.debit).not.toHaveBeenCalled()
    expect(invoiceStateMachine.transition).toHaveBeenCalledWith(
      INVOICE_ID,
      'Unpaid',
      'Paid',
      expect.objectContaining({ client: mockClient }),
    )
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
  })

  it('rejects a colliding idempotency key that belongs to another operation', async () => {
    mockQuery((sql) => {
      if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) {
        return { rows: [invoiceRow()] }
      }
      if (sql.includes('FROM wallet_transactions')) {
        return { rows: [ledgerSqlRow({ type: 'topup', amount: '1000000', ref_id: null })] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    })

    await expect(pay()).rejects.toThrow('Idempotency key already used for a different wallet operation')
    expect(walletService.debit).not.toHaveBeenCalled()
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
  })

  it('returns 404 when the invoice is missing or belongs to another profile', async () => {
    mockQuery((sql) => {
      if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) {
        return { rows: [] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    })
    await expect(pay()).rejects.toBeInstanceOf(NotFoundException)

    mockQuery((sql) => {
      if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) {
        return { rows: [invoiceRow({ profile_id: OTHER_PROFILE })] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    })
    await expect(pay()).rejects.toThrow(`Invoice not found: ${INVOICE_ID}`)
    expect(walletService.debit).not.toHaveBeenCalled()
  })

  it('rejects credit notes, Overdue, and invoices that are not yet payable', async () => {
    mockQuery((sql) => {
      if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) {
        return { rows: [invoiceRow({ adjustment_kind: 'credit' })] }
      }
      if (sql.includes('FROM wallet_transactions')) {
        return { rows: [] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    })
    await expect(pay()).rejects.toThrow(PAY_INVOICE_WITH_WALLET_ERRORS.CREDIT_NOT_PAYABLE(INVOICE_ID))

    mockQuery((sql) => {
      if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) {
        return { rows: [invoiceRow({ state: 'Overdue' })] }
      }
      if (sql.includes('FROM wallet_transactions')) {
        return { rows: [] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    })
    await expect(pay()).rejects.toThrow(PAY_INVOICE_WITH_WALLET_ERRORS.STATE_NOT_PAYABLE('Overdue'))

    mockQuery((sql) => {
      if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) {
        return {
          rows: [invoiceRow({ payable_from: new Date('2026-12-01T00:00:00.000Z') })],
        }
      }
      if (sql.includes('FROM wallet_transactions')) {
        return { rows: [] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    })
    await expect(pay()).rejects.toThrow('Invoice is not payable until')
    expect(walletService.debit).not.toHaveBeenCalled()
  })

  it('rejects blank idempotency keys and invalid ids without opening a transaction', async () => {
    await expect(
      service.payInvoiceWithWallet(INVOICE_ID, PROFILE_ID, '   ', { actorUserId: ACTOR_ID }),
    ).rejects.toThrow(PAY_INVOICE_WITH_WALLET_ERRORS.IDEMPOTENCY_REQUIRED())
    await expect(
      service.payInvoiceWithWallet('not-a-uuid', PROFILE_ID, IDEMPOTENCY_KEY, {
        actorUserId: ACTOR_ID,
      }),
    ).rejects.toThrow(PAY_INVOICE_WITH_WALLET_ERRORS.BAD_INVOICE_ID())
    expect(mockPool.connect).not.toHaveBeenCalled()
  })

  it('rolls back when the invoice transition fails after the wallet debit', async () => {
    invoiceStateMachine.transition.mockRejectedValue(new ConflictException('state conflict'))
    mockQuery((sql) => {
      if (sql.includes('FROM invoices') && sql.includes('FOR UPDATE')) {
        return { rows: [invoiceRow()] }
      }
      if (sql.includes('FROM wallet_transactions')) {
        return { rows: [] }
      }
      if (sql.includes('SET paid_amount')) {
        return { rows: [{ paid_amount: '1000000', total_amount: '1000000' }] }
      }
      throw new Error(`unexpected sql: ${sql}`)
    })

    await expect(pay()).rejects.toThrow('state conflict')
    expect(walletService.debit).toHaveBeenCalledWith(
      PROFILE_ID,
      1_000_000n,
      expect.anything(),
      IDEMPOTENCY_KEY,
      mockClient,
    )
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT')
  })
})
