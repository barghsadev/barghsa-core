/**
 * Tests for InvoiceAuditRepository (T-04.1.01.05).
 *
 * Verifies the append-only audit insert for invoice state transitions:
 * canonical event naming (`invoice.<label>`), full metadata payload,
 * correlation/ip passthrough, and the generated UUIDv7 audit id.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InvoiceAuditRepository } from './invoice-audit.repository.js'
import {
  INVOICE_TRANSITIONS,
  TRANSITION_LABELS,
  type InvoiceTransition,
} from './invoice-state.model.js'

// ---- Mocks ----
const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}

vi.mock('uuid', () => ({
  v7: vi.fn(() => 'audit-0000-0000-7000-000000000000'),
}))

function insertCall() {
  const calls = mockClient.query.mock.calls.filter(
    (c: unknown[]) => (c[0] as string).includes('INSERT INTO audit_log'),
  )
  return calls[calls.length - 1]
}

describe('InvoiceAuditRepository', () => {
  let repo: InvoiceAuditRepository

  beforeEach(() => {
    vi.clearAllMocks()
    repo = new InvoiceAuditRepository()
    mockClient.query.mockResolvedValue({ rows: [] })
  })

  it('inserts a full audit entry for a transition', async () => {
    const occurredAt = new Date('2026-08-29T18:00:00Z')

    const auditId = await repo.recordTransition(
      mockClient,
      {
        invoiceId: 'inv-001',
        fromState: 'Draft',
        toState: 'Unpaid',
        transition: 'Issue',
        actorUserId: 'user-001',
        reason: 'Manual invoice issue',
        correlationId: 'corr-123',
        ip: '192.168.1.1',
      },
      occurredAt,
    )

    expect(auditId).toBe('audit-0000-0000-7000-000000000000')
    const call = insertCall()!
    expect(call[0]).toContain('INSERT INTO audit_log')
    expect(call[0]).toContain('(id, user_id, event, metadata, correlation_id, ip, created_at)')

    const params = call[1] as unknown[]
    expect(params[0]).toBe('audit-0000-0000-7000-000000000000') // id
    expect(params[1]).toBe('user-001') // user_id
    expect(params[2]).toBe('invoice.issue') // event
    expect(params[3]).toContain('"invoiceId":"inv-001"') // metadata
    expect(params[3]).toContain('"fromState":"Draft"')
    expect(params[3]).toContain('"toState":"Unpaid"')
    expect(params[3]).toContain('"reason":"Manual invoice issue"')
    expect(params[4]).toBe('corr-123') // correlation_id
    expect(params[5]).toBe('192.168.1.1') // ip
    expect(params[6]).toBe(occurredAt) // created_at
  })

  it('uses nulls when optional fields are omitted', async () => {
    await repo.recordTransition(
      mockClient,
      {
        invoiceId: 'inv-002',
        fromState: 'Unpaid',
        toState: 'Overdue',
        transition: 'MarkOverdue',
        actorUserId: 'system',
      },
      new Date(),
    )

    const params = insertCall()![1] as unknown[]
    expect(params[3]).toContain('"reason":null')
    expect(params[4]).toBeNull() // correlation_id
    expect(params[5]).toBeNull() // ip
  })

  it('records every transition under its canonical invoice.<label> event', async () => {
    for (const transition of INVOICE_TRANSITIONS as readonly InvoiceTransition[]) {
      const expected = `invoice.${TRANSITION_LABELS[transition]}`
      await repo.recordTransition(
        mockClient,
        {
          invoiceId: 'inv-x',
          fromState: 'Draft',
          toState: 'Unpaid',
          transition,
          actorUserId: 'user-001',
        },
        new Date(),
      )
      const last = insertCall()!
      const lastParams = last[1] as unknown[]
      expect(lastParams[2], `event for ${transition}`).toBe(expected)
      // Compare SQL with collapsed whitespace so reformatting the query
      // does not break the assertion.
      const normalized = (sql: string) => sql.replace(/\s+/g, ' ').trim()
      expect(normalized(last[0] as string)).toBe(
        'INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      )
    }
    expect(mockClient.query).toHaveBeenCalledTimes(INVOICE_TRANSITIONS.length)
  })

  it('records a staff dueAt override with the customer-visible reason', async () => {
    const occurredAt = new Date('2026-08-02T12:00:00Z')
    const auditId = await repo.recordDueAtOverride(
      mockClient,
      {
        invoiceId: 'inv-override',
        actorUserId: 'staff-001',
        invoiceState: 'Unpaid',
        snapshot: {
          dueAt: '2026-09-15T08:00:00.000Z',
          previousDueAt: '2026-08-08T10:00:00.000Z',
          reason: 'Customer requested an extension',
          actorUserId: 'staff-001',
          overriddenAt: occurredAt.toISOString(),
          customerVisible: true,
        },
        correlationId: 'corr-override',
        ip: '10.0.0.9',
      },
      occurredAt,
    )

    expect(auditId).toBe('audit-0000-0000-7000-000000000000')
    const params = insertCall()![1] as unknown[]
    expect(params[2]).toBe('invoice.due_at.override')
    expect(params[3]).toContain('"invoiceId":"inv-override"')
    expect(params[3]).toContain('"previousDueAt":"2026-08-08T10:00:00.000Z"')
    expect(params[3]).toContain('"newDueAt":"2026-09-15T08:00:00.000Z"')
    expect(params[3]).toContain('"reason":"Customer requested an extension"')
    expect(params[3]).toContain('"customerVisible":true')
    expect(params[4]).toBe('corr-override')
    expect(params[5]).toBe('10.0.0.9')
    expect(params[6]).toBe(occurredAt)
  })
})
