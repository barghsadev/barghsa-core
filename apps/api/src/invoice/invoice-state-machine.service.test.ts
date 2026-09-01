/**
 * Tests for InvoiceStateMachineService.
 *
 * These tests mock `getDbPool` from @barghsa/db and verify the transition
 * flow: validation → DB lock → UPDATE → audit INSERT → COMMIT.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { InvoiceStateMachineService } from './invoice-state-machine.service.js'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'
import {
  ALLOWED_TRANSITIONS,
  TRANSITION_LABELS,
  transitionName,
  type InvoiceState,
  type TransitionContext,
} from './invoice-state.model.js'

// ---- Mocks ----
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

vi.mock('uuid', () => ({
  v7: vi.fn(() => '00000000-0000-7000-8000-000000000000'),
}))

// ---- Helpers ----
function makeInvoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-001',
    state: 'Draft',
    ...overrides,
  }
}

function mockTransitionFlowSuccess(
  fromState: string,
  updateParamCount: number,
) {
  // BEGIN → SELECT ... FOR UPDATE → idempotency check (none) → UPDATE → INSERT audit → COMMIT
  mockClient.query
    .mockReset()
    .mockResolvedValueOnce({ rows: [] }) // BEGIN
    .mockResolvedValueOnce({ rows: [makeInvoiceRow({ state: fromState })] }) // FOR UPDATE
    .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE
    .mockResolvedValueOnce({ rows: [] }) // INSERT audit
    .mockResolvedValueOnce({ rows: [] }) // COMMIT
  mockClient.release.mockReset()
}

describe('InvoiceStateMachineService', () => {
  let service: InvoiceStateMachineService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new InvoiceStateMachineService(new InvoiceAuditRepository())
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.release.mockImplementation(() => {})
  })

  describe('transition', () => {
    it('transitions Draft → Unpaid (Issue) successfully', async () => {
      mockTransitionFlowSuccess('Draft', 3)

      const result = await service.transition('inv-001', 'Draft', 'Unpaid', {
        actorUserId: 'user-001',
        reason: 'Issuing invoice',
      })

      expect(result.invoiceId).toBe('inv-001')
      expect(result.fromState).toBe('Draft')
      expect(result.toState).toBe('Unpaid')
      expect(result.transition).toBe('Issue')
      expect(result.auditId).toBe('00000000-0000-7000-8000-000000000000')

      // Verify UPDATE SET clauses
      const updateCall = mockClient.query.mock.calls.find(
        (c: unknown[]) => (c[0] as string).startsWith('UPDATE'),
      )
      expect(updateCall).toBeDefined()
      const updateSql = updateCall![0] as string
      expect(updateSql).toContain('state = $2')
      expect(updateSql).toContain('issued_at')
      expect(updateSql).toContain('payable_from')

      // Verify audit INSERT
      const auditCall = mockClient.query.mock.calls.find(
        (c: unknown[]) => (c[0] as string).includes('INSERT INTO audit_log'),
      )
      expect(auditCall).toBeDefined()
      expect(auditCall![1]).toContain('user-001')
      expect(auditCall![1]).toContain('invoice.issue')

      // Verify COMMIT was called
      expect(mockClient.query.mock.calls.some((c: unknown[]) => (c[0] as string) === 'COMMIT')).toBe(true)
    })

    it('transitions Unpaid → Overdue successfully', async () => {
      mockTransitionFlowSuccess('Unpaid', 3)

      const result = await service.transition('inv-001', 'Unpaid', 'Overdue', {
        actorUserId: 'system',
        reason: 'Marked overdue by cron',
      })

      expect(result.transition).toBe('MarkOverdue')
      expect(result.toState).toBe('Overdue')
    })

    it('transitions Unpaid → Cancelled successfully', async () => {
      mockTransitionFlowSuccess('Unpaid', 3)

      const result = await service.transition('inv-001', 'Unpaid', 'Cancelled', {
        actorUserId: 'staff-001',
        reason: 'Customer requested cancellation',
      })

      expect(result.transition).toBe('Cancel')
      expect(result.toState).toBe('Cancelled')
      // Verify cancelled_at is set
      const updateCall = mockClient.query.mock.calls.find(
        (c: unknown[]) => (c[0] as string).startsWith('UPDATE'),
      )
      expect(updateCall![0] as string).toContain('cancelled_at')
    })

    it('rejects PayFromWallet and SubmitBankReceipt on a credit note', async () => {
      mockClient.query
        .mockReset()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [makeInvoiceRow({ state: 'Unpaid', adjustment_kind: 'credit' })],
        })
        .mockResolvedValueOnce({ rows: [] })

      await expect(
        service.transition('inv-001', 'Unpaid', 'Paid', {
          actorUserId: 'user-001',
        }),
      ).rejects.toThrow(/credit note/)

      mockClient.query
        .mockReset()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [makeInvoiceRow({ state: 'Unpaid', adjustment_kind: 'credit' })],
        })
        .mockResolvedValueOnce({ rows: [] })

      await expect(
        service.transition('inv-001', 'Unpaid', 'PaymentUnderReview', {
          actorUserId: 'user-001',
        }),
      ).rejects.toThrow(/credit note/)
    })

    it('transitions Paid → Refunded successfully', async () => {
      mockTransitionFlowSuccess('Paid', 3)

      const result = await service.transition(
        'inv-001',
        'Paid',
        'Refunded',
        {
          actorUserId: 'staff-001',
          reason: 'Full refund approved',
          financials: {
            paidAmount: 1_000_000n,
            totalAmount: 1_000_000n,
            refundedAmount: 1_000_000n,
          },
        },
      )

      expect(result.transition).toBe('FullRefund')
      expect(result.toState).toBe('Refunded')
    })

    it('throws BadRequestException for illegal transition', async () => {
      await expect(
        service.transition('inv-001', 'Draft', 'Paid', {
          actorUserId: 'user-001',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('runs on a caller-provided client without its own transaction (join path)', async () => {
      // Caller owns the tx: no pool.connect, no BEGIN/COMMIT/ROLLBACK/release.
      const callerClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [makeInvoiceRow({ state: 'Draft' })] }) // FOR UPDATE
          .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE
          .mockResolvedValueOnce({ rows: [] }), // INSERT audit
      }

      const result = await service.transition('inv-001', 'Draft', 'Unpaid', {
        actorUserId: 'user-001',
        client: callerClient,
      })

      expect(result.transition).toBe('Issue')
      expect(mockPool.connect).not.toHaveBeenCalled()
      expect(mockClient.release).not.toHaveBeenCalled()

      const calls = callerClient.query.mock.calls.map((c) => (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase())
      expect(calls).not.toContain('BEGIN')
      expect(calls).not.toContain('COMMIT')
      expect(calls).not.toContain('ROLLBACK')
      // Lock + UPDATE + audit INSERT ran on the caller's transaction
      expect(calls.filter((c) => c === 'SELECT')).toHaveLength(1)
      expect(calls).toContain('UPDATE')
      const auditSql = callerClient.query.mock.calls
        .map((c) => c[0] as string)
        .find((sql) => sql.includes('INSERT INTO audit_log'))
      expect(auditSql).toBeDefined()
    })

    it('does not issue ROLLBACK on failure when a caller client is provided', async () => {
      const callerClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] }) // FOR UPDATE → empty (NotFound)
          .mockResolvedValueOnce({ rows: [] }), // caller's own ROLLBACK later
      }

      await expect(
        service.transition('inv-999', 'Draft', 'Unpaid', {
          actorUserId: 'user-001',
          client: callerClient,
        }),
      ).rejects.toThrow(NotFoundException)

      // The service must not COMMIT/ROLLBACK/release — the caller owns them
      const queries = callerClient.query.mock.calls.map((c) => (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase())
      expect(queries).not.toContain('COMMIT')
      expect(queries).not.toContain('ROLLBACK')
      expect(mockClient.release).not.toHaveBeenCalled()
    })

    it('throws BadRequestException when amount constraints fail', async () => {
      await expect(
        service.transition('inv-001', 'Unpaid', 'Paid', {
          actorUserId: 'user-001',
          financials: {
            paidAmount: 500_000n,
            totalAmount: 1_000_000n,
            refundedAmount: 0n,
          },
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws NotFoundException for missing invoice', async () => {
      mockClient.query
        .mockReset()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // FOR UPDATE → empty
        .mockResolvedValueOnce({ rows: [] }) // ROLLBACK

      await expect(
        service.transition('inv-999', 'Draft', 'Unpaid', {
          actorUserId: 'user-001',
        }),
      ).rejects.toThrow(NotFoundException)
      // Verify ROLLBACK on error
      expect(mockClient.query.mock.calls.some((c: unknown[]) => (c[0] as string) === 'ROLLBACK')).toBe(true)
    })

    it('throws BadRequestException on state conflict', async () => {
      mockClient.query
        .mockReset()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [makeInvoiceRow({ state: 'Paid' })] }) // FOR UPDATE shows Paid instead of Draft
        .mockResolvedValueOnce({ rows: [] }) // ROLLBACK

      await expect(
        service.transition('inv-001', 'Draft', 'Unpaid', {
          actorUserId: 'user-001',
        }),
      ).rejects.toThrow(BadRequestException)
      expect(mockClient.query.mock.calls.some((c: unknown[]) => (c[0] as string) === 'ROLLBACK')).toBe(true)
    })

    it('rolls back on error', async () => {
      mockClient.query
        .mockReset()
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [makeInvoiceRow({ state: 'Draft' })] }) // FOR UPDATE
        .mockRejectedValueOnce(new Error('DB failure')) // UPDATE fails
        .mockResolvedValueOnce({ rows: [] }) // ROLLBACK

      await expect(
        service.transition('inv-001', 'Draft', 'Unpaid', {
          actorUserId: 'user-001',
        }),
      ).rejects.toThrow(InternalServerErrorException)

      expect(mockClient.query.mock.calls.some((c: unknown[]) => (c[0] as string) === 'ROLLBACK')).toBe(true)
      expect(mockClient.release).toHaveBeenCalled()
    })

    it('records audit metadata with reason and correlationId', async () => {
      mockTransitionFlowSuccess('Draft', 3)

      await service.transition('inv-001', 'Draft', 'Unpaid', {
        actorUserId: 'user-001',
        reason: 'Manual invoice issue',
        correlationId: 'corr-123',
        ip: '192.168.1.1',
      })

      const auditCall = mockClient.query.mock.calls.find(
        (c: unknown[]) => (c[0] as string).includes('INSERT INTO audit_log'),
      )
      expect(auditCall).toBeDefined()
      const params = auditCall![1] as unknown[]
      expect(params[1]).toBe('user-001') // user_id
      expect(params[2]).toBe('invoice.issue') // event
      expect(params[3]).toContain('Manual invoice issue') // metadata JSON
      expect(params[4]).toBe('corr-123') // correlation_id
      expect(params[5]).toBe('192.168.1.1') // ip
    })
  })

  describe('guard methods', () => {
    it('canIssue', () => {
      expect(service.canIssue('Draft')).toBe(true)
      expect(service.canIssue('Unpaid')).toBe(false)
      expect(service.canIssue('Paid')).toBe(false)
    })

    it('canSubmitBankReceipt', () => {
      expect(service.canSubmitBankReceipt('Unpaid')).toBe(true)
      expect(service.canSubmitBankReceipt('PartiallyFunded')).toBe(true)
      expect(service.canSubmitBankReceipt('Overdue')).toBe(true)
      expect(service.canSubmitBankReceipt('Draft')).toBe(false)
      expect(service.canSubmitBankReceipt('Paid')).toBe(false)
      expect(service.canSubmitBankReceipt('Unpaid', 'credit')).toBe(false)
      expect(service.canSubmitBankReceipt('Overdue', 'credit')).toBe(false)
    })

    it('canConfirmBankReceipt', () => {
      expect(service.canConfirmBankReceipt('PaymentUnderReview')).toBe(true)
      expect(service.canConfirmBankReceipt('Unpaid')).toBe(false)
    })

    it('canPayFromWallet', () => {
      expect(service.canPayFromWallet('Unpaid')).toBe(true)
      expect(service.canPayFromWallet('PartiallyFunded')).toBe(true)
      expect(service.canPayFromWallet('Draft')).toBe(false)
      expect(service.canPayFromWallet('Paid')).toBe(false)
      expect(service.canPayFromWallet('Unpaid', 'credit')).toBe(false)
      expect(service.canPayFromWallet('Unpaid', 'charge')).toBe(true)
    })

    it('canMarkOverdue', () => {
      expect(service.canMarkOverdue('Unpaid')).toBe(true)
      expect(service.canMarkOverdue('PartiallyFunded')).toBe(true)
      expect(service.canMarkOverdue('Overdue')).toBe(false)
      expect(service.canMarkOverdue('Unpaid', 'credit')).toBe(false)
    })

    it('canCancel', () => {
      expect(service.canCancel('Draft')).toBe(true)
      expect(service.canCancel('Unpaid')).toBe(true)
      expect(service.canCancel('Overdue')).toBe(true)
      expect(service.canCancel('PartiallyFunded')).toBe(true)
      expect(service.canCancel('Paid')).toBe(false)
      expect(service.canCancel('Cancelled')).toBe(false)
    })

    it('canPartialRefund', () => {
      expect(service.canPartialRefund('Paid')).toBe(true)
      expect(service.canPartialRefund('PartiallyRefunded')).toBe(true)
      expect(service.canPartialRefund('Unpaid')).toBe(false)
    })

    it('canFullRefund', () => {
      expect(service.canFullRefund('Paid')).toBe(true)
      expect(service.canFullRefund('PartiallyRefunded')).toBe(false)
      expect(service.canFullRefund('Unpaid')).toBe(false)
    })
  })

  describe('audit entry for every transition (T-04.1.01.05)', () => {
    /** Financials that satisfy the amount-based guards for each target state. */
    function financialsFor(to: InvoiceState): TransitionContext | undefined {
      switch (to) {
        case 'Paid':
          return { paidAmount: 1_000_000n, totalAmount: 1_000_000n, refundedAmount: 0n }
        case 'Refunded':
          return { paidAmount: 1_000_000n, totalAmount: 1_000_000n, refundedAmount: 1_000_000n }
        case 'PartiallyFunded':
          return { paidAmount: 500_000n, totalAmount: 1_000_000n, refundedAmount: 0n }
        case 'PartiallyRefunded':
          return { paidAmount: 1_000_000n, totalAmount: 1_000_000n, refundedAmount: 200_000n }
        default:
          return undefined
      }
    }

    it('writes one audit entry with the canonical event for every allowed transition', async () => {
      let pairs = 0
      for (const from of Object.keys(ALLOWED_TRANSITIONS) as InvoiceState[]) {
        for (const to of ALLOWED_TRANSITIONS[from]) {
          pairs += 1
          mockTransitionFlowSuccess(from, 3)

          const financials = financialsFor(to)
          await service.transition('inv-001', from, to, {
            actorUserId: 'user-001',
            ...(financials ? { financials } : {}),
          })

          const name = transitionName(from, to)!
          const auditCalls = mockClient.query.mock.calls.filter(
            (c: unknown[]) => (c[0] as string).includes('INSERT INTO audit_log'),
          )
          const auditCall = auditCalls[auditCalls.length - 1]
          expect(auditCall, `audit insert for ${from} → ${to}`).toBeDefined()
          const params = auditCall![1] as unknown[]
          expect(params[2], `event for ${from} → ${to}`).toBe(
            `invoice.${TRANSITION_LABELS[name]}`,
          )
          expect(params[1], `actor for ${from} → ${to}`).toBe('user-001')
        }
      }
      expect(pairs).toBeGreaterThan(0)
    })
  })
})
