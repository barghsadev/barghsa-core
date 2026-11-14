/**
 * Unit tests for CancelAndReplaceInvoiceService (T-04.1.05.02).
 *
 * Mocks `getDbPool` and verifies: unpaid lock → cancel → linked Draft
 * insert with `replaces_invoice_id` → issue on the SAME client → COMMIT.
 * Also covers no-payment / state / reason / line validation and rollback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import {
  CancelAndReplaceInvoiceService,
  CANCEL_AND_REPLACE_ERRORS,
  isReplaceableInvoiceState,
  REPLACEABLE_INVOICE_STATES,
} from './cancel-and-replace-invoice.service.js';
import { InvoiceStateMachineService } from './invoice-state-machine.service.js';
import { InvoiceAuditRepository } from './invoice-audit.repository.js';
import { DueAtCalculationRepository } from './due-at.repository.js';
import { DueAtCalculationService } from './due-at.service.js';

vi.mock('../admin/staff-mutation-permission.js', () => ({
  requireStaffMutationPermission: vi.fn().mockResolvedValue(undefined),
}));

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

const mockPool = {
  connect: vi.fn().mockResolvedValue(mockClient),
  query: vi.fn(),
};

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}));

const ids = vi.hoisted(() => ({ next: 0 }));
vi.mock('uuid', () => ({
  v7: vi.fn(() => `00000000-0000-7000-8000-00000000000${ids.next++}`),
}));

function mockQuery(handler: (sql: string, params?: unknown[]) => unknown) {
  let inserted: unknown[] | undefined;
  mockClient.query.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith('INSERT INTO invoices')) inserted = params;
    // The state machine now reads the locked stored amounts. Its issue read
    // must return the new draft, not the unrelated original invoice.
    if (
      sql.startsWith('SELECT id, state, adjustment_kind') &&
      inserted &&
      params?.[0] === inserted[0]
    ) {
      return {
        rows: [
          {
            id: inserted[0],
            state: 'Draft',
            adjustment_kind: null,
            total_amount: String(inserted[5]),
            paid_amount: '0',
            refunded_amount: '0',
          },
        ],
      };
    }
    return sql.startsWith('SELECT id, archived FROM profiles')
      ? { rows: [{ id: 'profile-001', archived: false }] }
      : handler(sql, params);
  });
}

function originalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-original',
    profile_id: 'profile-001',
    order_id: 'order-001',
    contract_id: 'contract-001',
    consultation_id: null,
    type: 'auto',
    state: 'Unpaid',
    total_amount: '1090000',
    paid_amount: '0',
    refunded_amount: '0',
    metadata: { source: 'auto' },
    ...overrides,
  };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    invoiceId: 'inv-original',
    reason: 'Wrong quantity on the issued lines',
    newLines: [
      { description: 'برق مصرفی — اصلاح شده', quantity: 2, unitPrice: 1_000_000n, vatRate: 900 },
    ],
    actorUserId: 'staff-001',
    now: new Date('2026-08-01T10:00:00.000Z'),
    ...overrides,
  };
}

describe('isReplaceableInvoiceState', () => {
  it('accepts only unpaid Draft / Unpaid / Overdue', () => {
    expect(REPLACEABLE_INVOICE_STATES).toEqual(['Draft', 'Unpaid', 'Overdue']);
    expect(isReplaceableInvoiceState('Draft')).toBe(true);
    expect(isReplaceableInvoiceState('Unpaid')).toBe(true);
    expect(isReplaceableInvoiceState('Overdue')).toBe(true);
    expect(isReplaceableInvoiceState('Paid')).toBe(false);
    expect(isReplaceableInvoiceState('PartiallyFunded')).toBe(false);
    expect(isReplaceableInvoiceState('PaymentUnderReview')).toBe(false);
    expect(isReplaceableInvoiceState('Cancelled')).toBe(false);
  });
});

describe('CancelAndReplaceInvoiceService', () => {
  let service: CancelAndReplaceInvoiceService;

  beforeEach(() => {
    vi.clearAllMocks();
    ids.next = 0;
    service = new CancelAndReplaceInvoiceService(
      new InvoiceStateMachineService(new InvoiceAuditRepository()),
      new DueAtCalculationService(new DueAtCalculationRepository())
    );
    mockPool.connect.mockResolvedValue(mockClient);
    mockClient.release.mockImplementation(() => {});
  });

  it.each([
    [{ source: 'auto' }, { source: 'auto' }],
    ['{"source":"auto","legacyBatch":"A-42"}', { source: 'auto', legacyBatch: 'A-42' }],
  ])('replaces an unpaid invoice atomically', async (metadata, preserved) => {
    const calls: string[] = [];
    let lockCount = 0;
    mockQuery((sql) => {
      calls.push(sql.trim().split(/\s+/)[0]!.toUpperCase());
      if (sql.includes('paid_amount') && sql.includes('FOR UPDATE')) {
        return { rows: [originalRow({ metadata })] };
      }
      if (sql.includes('FROM service_due_periods')) return { rows: [] };
      if (sql.startsWith('INSERT INTO invoices')) return { rows: [] };
      if (sql.startsWith('INSERT INTO invoice_lines')) return { rows: [] };
      if (sql.startsWith('SELECT id, state')) {
        lockCount += 1;
        return {
          rows: [
            {
              id: lockCount === 1 ? 'inv-original' : '00000000-0000-7000-8000-000000000001',
              state: lockCount === 1 ? 'Unpaid' : 'Draft',
            },
          ],
        };
      }
      if (sql.startsWith('UPDATE invoices SET state')) return { rows: [] };
      if (sql.startsWith('UPDATE invoices') && sql.includes('metadata')) return { rows: [] };
      if (sql.startsWith('INSERT INTO audit_log')) return { rows: [] };
      if (sql.includes('replaces_invoice_id') && sql.startsWith('SELECT id, profile_id')) {
        return {
          rows: [
            {
              id: '00000000-0000-7000-8000-000000000001',
              profile_id: 'profile-001',
              order_id: 'order-001',
              contract_id: 'contract-001',
              consultation_id: null,
              state: 'Unpaid',
              total_amount: '2180000',
              issued_at: new Date('2026-08-01T10:00:00.000Z'),
              payable_from: new Date('2026-08-01T10:00:00.000Z'),
              due_at: new Date('2026-08-08T10:00:00.000Z'),
              replaces_invoice_id: 'inv-original',
            },
          ],
        };
      }
      if (sql.startsWith('SELECT id, description')) {
        return {
          rows: [
            {
              id: '00000000-0000-7000-8000-000000000001',
              description: 'برق مصرفی — اصلاح شده',
              quantity: 2,
              unit_price: '1000000',
              line_total: '2000000',
              vat_rate: 900,
              vat_amount: '180000',
              is_taxable: true,
              position: 0,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await service.cancelAndReplaceInvoice(command());

    expect(result.originalInvoiceId).toBe('inv-original');
    expect(result.originalState).toBe('Cancelled');
    expect(result.replacementInvoiceId).toBe('00000000-0000-7000-8000-000000000001');
    expect(result.replacesInvoiceId).toBe('inv-original');
    expect(result.replacementState).toBe('Unpaid');
    expect(result.totalAmount).toBe(2_180_000n);
    expect(result.orderId).toBe('order-001');
    expect(result.cancelTransition.transition).toBe('Cancel');
    expect(result.issueTransition.transition).toBe('Issue');

    expect(calls.filter((c) => c === 'BEGIN')).toHaveLength(1);
    expect(calls.filter((c) => c === 'COMMIT')).toHaveLength(1);
    expect(mockPool.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.release).toHaveBeenCalledTimes(1);

    const insertCall = mockClient.query.mock.calls.find((c) =>
      (c[0] as string).startsWith('INSERT INTO invoices')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![0] as string).toContain('replaces_invoice_id');
    const params = insertCall![1] as unknown[];
    expect(params[params.length - 1]).toBe('inv-original');
    expect(insertCall![0] as string).toContain("'manual'");
    const snapshot = JSON.parse(params[8] as string) as {
      source: string;
      totals: { totalAmount: string };
    };
    expect(snapshot.source).toBe('manual');
    expect(snapshot.totals.totalAmount).toBe('2180000');

    const originalUpdate = mockClient.query.mock.calls.find(([sql]) =>
      String(sql).includes('SET metadata = $1::jsonb')
    );
    expect(JSON.parse(originalUpdate?.[1]?.[0] as string)).toEqual({
      ...preserved,
      replacedByInvoiceId: params[0],
      replacementReason: 'Wrong quantity on the issued lines',
    });

    const readIdx = mockClient.query.mock.calls.findIndex(
      (c) =>
        (c[0] as string).includes('replaces_invoice_id') &&
        (c[0] as string).startsWith('SELECT id, profile_id')
    );
    const commitIdx = mockClient.query.mock.calls.findIndex((c) => (c[0] as string) === 'COMMIT');
    expect(readIdx).toBeGreaterThanOrEqual(0);
    expect(commitIdx).toBeGreaterThan(readIdx);
  });

  it('rejects an empty reason without opening a connection', async () => {
    await expect(service.cancelAndReplaceInvoice(command({ reason: '   ' }))).rejects.toThrow(
      BadRequestException
    );
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('rejects invalid lines without opening a connection', async () => {
    await expect(
      service.cancelAndReplaceInvoice(
        command({
          newLines: [{ description: 'x', quantity: 0, unitPrice: 100n, vatRate: 0 }],
        })
      )
    ).rejects.toThrow(BadRequestException);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('rejects non-representable replacement totals in review and execution', async () => {
    const oversized = command({
      newLines: [
        {
          description: 'Large invoice',
          quantity: 2,
          unitPrice: 5_000_000_000_000_000_000n,
          vatRate: 0,
        },
      ],
    });
    await expect(service.cancelAndReplaceInvoice(oversized)).rejects.toThrow(
      'Invoice total exceeds int8 IRR'
    );
    await expect(
      service.review({
        ...oversized,
        actor: { userId: 'staff-001', sessionId: 'observed-session', csrfToken: 'fixture-csrf' },
      })
    ).rejects.toThrow('Invoice total exceeds int8 IRR');
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('rejects a past replacement due date before locking the original', async () => {
    await expect(
      service.cancelAndReplaceInvoice(
        command({
          dueAt: new Date('2026-07-31T09:00:00.000Z'),
        })
      )
    ).rejects.toThrow('dueAt cannot be in the past');
    expect(mockPool.connect).not.toHaveBeenCalled();
  });

  it('rolls back for mismatched staff sessions or an invoice whose profile changed', async () => {
    mockQuery((sql) => {
      if (sql.startsWith('SELECT profile_id')) return { rows: [{ profile_id: 'profile-001' }] };
      if (sql.includes('paid_amount') && sql.includes('FOR UPDATE')) {
        return { rows: [originalRow({ profile_id: 'different-profile' })] };
      }
      return { rows: [] };
    });
    await expect(
      service.cancelAndReplaceInvoice(
        command({
          actorSession: { userId: 'different-staff', sessionId: 'session', csrfToken: 'csrf' },
        })
      )
    ).rejects.toThrow('Invoice actor does not match the session');
    await expect(service.cancelAndReplaceInvoice(command())).rejects.toThrow(
      'Invoice profile changed; retry'
    );
    const writes = mockClient.query.mock.calls.map(([sql]) => String(sql));
    expect(writes.filter((sql) => sql === 'ROLLBACK')).toHaveLength(2);
    expect(writes.some((sql) => /^(UPDATE|INSERT|COMMIT)\b/.test(sql))).toBe(false);
  });

  it.each([
    [{ order_profile_id: 'different-profile' }, {}, 'Electricity invoice order linkage'],
    [{}, { adjustment_for_invoice_id: 'parent-invoice' }, 'require a contract change'],
    [{}, {}, 'financial lines must match the submitted order'],
  ])(
    'blocks unsafe corrections to electricity invoices before any writes',
    async (order, invoice, reason) => {
      mockQuery((sql) => {
        if (sql.includes('paid_amount') && sql.includes('FOR UPDATE')) {
          return { rows: [originalRow({ total_amount: '2180000', ...invoice })] };
        }
        if (sql.includes('FROM electricity_orders')) {
          return {
            rows: [
              {
                profile_id: 'profile-001',
                order_profile_id: 'profile-001',
                order_type: 'electricity',
                ...order,
              },
            ],
          };
        }
        if (sql.includes('FROM invoice_lines')) {
          return {
            rows: [{ quantity: 2, unit_price: '1000000', vat_rate: 900, is_taxable: false }],
          };
        }
        return { rows: [] };
      });
      await expect(service.cancelAndReplaceInvoice(command())).rejects.toThrow(reason);
      const statements = mockClient.query.mock.calls.map(([sql]) => String(sql));
      expect(statements).toContain('ROLLBACK');
      expect(statements.some((sql) => /^(UPDATE|INSERT|COMMIT)\b/.test(sql))).toBe(false);
    }
  );

  it('throws NotFoundException when the original is missing and rolls back', async () => {
    mockQuery((sql) => {
      if (sql.includes('FOR UPDATE')) return { rows: [] };
      return { rows: [] };
    });

    await expect(service.cancelAndReplaceInvoice(command())).rejects.toThrow(NotFoundException);
    const calls = mockClient.query.mock.calls.map((c) =>
      (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase()
    );
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
  });

  it('rejects a paid invoice with ConflictException', async () => {
    mockQuery((sql) => {
      if (sql.includes('paid_amount') && sql.includes('FOR UPDATE')) {
        return { rows: [originalRow({ paid_amount: '500000', state: 'PartiallyFunded' })] };
      }
      return { rows: [] };
    });

    const rejection = service.cancelAndReplaceInvoice(command());
    await expect(rejection).rejects.toThrow(ConflictException);
    await expect(rejection).rejects.toThrow(
      CANCEL_AND_REPLACE_ERRORS.HAS_PAYMENT('inv-original', 500_000n)
    );
    const calls = mockClient.query.mock.calls.map((c) =>
      (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase()
    );
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
  });

  it('rejects a Paid invoice even when paid_amount is somehow zero', async () => {
    mockQuery((sql) => {
      if (sql.includes('paid_amount') && sql.includes('FOR UPDATE')) {
        return { rows: [originalRow({ state: 'Paid' })] };
      }
      return { rows: [] };
    });

    await expect(service.cancelAndReplaceInvoice(command())).rejects.toThrow(ConflictException);
  });

  it('rolls back when the cancel transition fails', async () => {
    mockQuery((sql) => {
      if (sql.includes('paid_amount') && sql.includes('FOR UPDATE')) {
        return { rows: [originalRow()] };
      }
      if (sql.startsWith('SELECT id, state')) {
        return { rows: [{ id: 'inv-original', state: 'Unpaid' }] };
      }
      if (sql.startsWith('UPDATE invoices SET state')) throw new Error('DB down');
      return { rows: [] };
    });

    await expect(service.cancelAndReplaceInvoice(command())).rejects.toThrow(
      /^Invoice transition failed$/
    );
    const calls = mockClient.query.mock.calls.map((c) =>
      (c[0] as string).trim().split(/\s+/)[0]!.toUpperCase()
    );
    expect(calls).toContain('UPDATE');
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
  });

  it('keeps database error contents out of the invoice failure log', async () => {
    const error = new Error('Invoice write failed for private-payment-reference');
    mockQuery((sql) => {
      if (sql.includes('paid_amount') && sql.includes('FOR UPDATE')) throw error;
      return { rows: [] };
    });
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      await expect(service.cancelAndReplaceInvoice(command())).rejects.toBe(error);
      expect(log.mock.calls).toEqual([['Cancel-and-replace failed']]);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
    } finally {
      log.mockRestore();
    }
  });
});
