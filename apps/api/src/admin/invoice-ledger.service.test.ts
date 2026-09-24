import { beforeEach, expect, it, vi } from 'vitest';
import { InvoiceLedgerService } from './invoice-ledger.service.js';
import type { ValidatedSession } from '../session/session.service.js';

const fixture = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  checkSession: vi.fn(),
  activity: vi.fn(),
}));
vi.mock('@barghsa/db', () => ({
  getDbPool: () => ({ connect: async () => ({ query: fixture.query, release: fixture.release }) }),
}));
vi.mock('../session/session-step-up.js', () => ({ requireCurrentSession: fixture.checkSession }));
vi.mock('../invoice/customer-invoice-activity.js', () => ({
  loadCustomerInvoiceActivity: fixture.activity,
}));

const session = { userId: 'staff', sessionId: 'session', csrfToken: 'csrf' } as ValidatedSession;
const id = (n: number) => `11111111-1111-7111-8111-${String(n).padStart(12, '0')}`;
const row = (n: number) => ({
  invoiceId: id(n),
  profileId: id(100),
  orderId: null,
  type: 'manual',
  state: 'Unpaid',
  totalAmount: '9007199254740993',
  paidAmount: '0',
  refundedAmount: '0',
  issuedAt: new Date('2026-09-01T00:00:00Z'),
  dueAt: null,
  createdAt: new Date(`2026-09-${String(n).padStart(2, '0')}T00:00:00Z`),
  cursorAt: `2026-09-${String(n).padStart(2, '0')}T00:00:00.123456Z`,
});

beforeEach(() => {
  fixture.query.mockReset();
  fixture.release.mockReset();
  fixture.checkSession.mockReset();
  fixture.activity.mockReset();
  fixture.query.mockResolvedValue({ rows: [] });
  fixture.activity.mockResolvedValue({ payments: [], bankReceipts: [], refunds: [] });
});

it('pages at 25 rows with stable timestamp and ID cursor, retaining exact IRR strings', async () => {
  const rows = Array.from({ length: 26 }, (_, index) => row(index + 1));
  fixture.query.mockImplementation(async (sql: string) =>
    sql.includes('FROM invoices') ? { rows } : { rows: [] }
  );
  const page = await new InvoiceLedgerService().list(session, { state: 'Unpaid' });
  expect(page.items).toHaveLength(25);
  expect(page.items[0]?.totalAmount).toBe('9007199254740993');
  expect(page.nextCursor).toEqual({
    beforeAt: rows[24]!.cursorAt,
    beforeId: rows[24]!.invoiceId,
  });
  expect(
    fixture.query.mock.calls.find(([sql]) => String(sql).includes('FROM invoices'))?.[1]
  ).toEqual(['Unpaid', null, null, null]);
  expect(fixture.checkSession).toHaveBeenCalledTimes(2);
  expect(fixture.release).toHaveBeenCalledOnce();
});

it('loads lines and payment activity for the selected invoice only', async () => {
  fixture.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM invoices')) return { rows: [row(1)] };
    if (sql.includes('FROM invoice_lines'))
      return {
        rows: [
          {
            description: 'Power',
            quantity: 1,
            unitPrice: '100',
            lineTotal: '100',
            vatRate: 900,
            vatAmount: '9',
          },
        ],
      };
    return { rows: [] };
  });
  const detail = await new InvoiceLedgerService().get(session, id(1));
  expect(detail.lines[0]?.vatAmount).toBe('9');
  expect(detail.activity.payments).toEqual([]);
  expect(fixture.activity).toHaveBeenCalledWith(expect.anything(), id(1), id(100));
});

it('returns the saved electricity period without exposing its calculation snapshot', async () => {
  fixture.query.mockImplementation(async (sql: string) =>
    sql.includes('FROM invoices')
      ? {
          rows: [
            {
              ...row(1),
              calculationSnapshot: {
                schemaVersion: 1,
                totalKwh: '100',
                periodStart: '2026-10-01T00:00:00Z',
                periodEnd: '2026-11-01T00:00:00Z',
              },
            },
          ],
        }
      : { rows: [] }
  );
  const item = (await new InvoiceLedgerService().list(session, {})).items[0]!;
  expect(item.periodStart).toBe('2026-10-01T00:00:00.000Z');
  expect(item.periodEnd).toBe('2026-11-01T00:00:00.000Z');
  expect(JSON.stringify(item)).not.toContain('calculationSnapshot');
});

it('returns not found for an unknown invoice', async () => {
  await expect(new InvoiceLedgerService().get(session, id(9))).rejects.toMatchObject({
    status: 404,
  });
  expect(fixture.activity).not.toHaveBeenCalled();
  expect(fixture.release).toHaveBeenCalledOnce();
});
