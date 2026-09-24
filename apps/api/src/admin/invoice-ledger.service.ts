import { Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { loadCustomerInvoiceActivity } from '../invoice/customer-invoice-activity.js';
import { electricityInvoicePeriod } from '../invoice/invoice-service-period.js';

type InvoiceReadSession = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;

export interface StaffInvoiceRow {
  invoiceId: string;
  profileId: string;
  orderId: string | null;
  type: string | null;
  state: string;
  totalAmount: string;
  paidAmount: string;
  refundedAmount: string;
  issuedAt: string | null;
  dueAt: string | null;
  periodStart?: string;
  periodEnd?: string;
  createdAt: string;
}

export interface StaffInvoiceLine {
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  vatRate: number;
  vatAmount: string;
}

export interface StaffInvoiceDetail extends StaffInvoiceRow {
  lines: StaffInvoiceLine[];
  activity: Awaited<ReturnType<typeof loadCustomerInvoiceActivity>>;
}

export interface StaffInvoiceFilter {
  state?: string | undefined;
  invoiceId?: string | undefined;
  beforeAt?: string | undefined;
  beforeId?: string | undefined;
}

interface InvoiceDbRow extends StaffInvoiceRow {
  calculationSnapshot: unknown;
}

interface InvoiceQueryRow extends InvoiceDbRow {
  cursorAt: string;
}

const invoiceColumns = `id AS "invoiceId", profile_id AS "profileId", order_id AS "orderId",
  type, state, total_amount::text AS "totalAmount", paid_amount::text AS "paidAmount",
  refunded_amount::text AS "refundedAmount", issued_at AS "issuedAt",
  due_at AS "dueAt", created_at AS "createdAt",
  invoice_calculation_snapshot AS "calculationSnapshot"`;

function stamp(value: Date | string | null): string | null {
  return value == null ? null : new Date(value).toISOString();
}

function serialize(row: InvoiceDbRow): StaffInvoiceRow {
  const { calculationSnapshot, ...invoice } = row;
  return {
    ...invoice,
    ...electricityInvoicePeriod(calculationSnapshot),
    issuedAt: stamp(row.issuedAt),
    dueAt: stamp(row.dueAt),
    createdAt: stamp(row.createdAt)!,
  };
}

@Injectable()
export class InvoiceLedgerService {
  private async read<T>(
    session: InvoiceReadSession,
    work: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireCurrentSession(client, session);
      const result = await work(client);
      await requireCurrentSession(client, session);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async list(session: InvoiceReadSession, filter: StaffInvoiceFilter) {
    return this.read(session, async (client) => {
      const result = await client.query<InvoiceQueryRow>(
        `SELECT ${invoiceColumns},
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt"
         FROM invoices
         WHERE ($1::text IS NULL OR state::text=$1)
           AND ($2::uuid IS NULL OR id=$2)
           AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid))
         ORDER BY created_at DESC,id DESC LIMIT 26`,
        [
          filter.state ?? null,
          filter.invoiceId ?? null,
          filter.beforeAt ?? null,
          filter.beforeId ?? null,
        ]
      );
      const items = result.rows
        .slice(0, 25)
        .map(({ cursorAt: _cursorAt, ...row }) => serialize(row));
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          result.rows.length > 25 && last
            ? { beforeAt: result.rows[24]!.cursorAt, beforeId: last.invoiceId }
            : null,
      };
    });
  }

  async get(session: InvoiceReadSession, invoiceId: string): Promise<StaffInvoiceDetail> {
    return this.read(session, async (client) => {
      const result = await client.query<InvoiceDbRow>(
        `SELECT ${invoiceColumns} FROM invoices WHERE id=$1::uuid`,
        [invoiceId]
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException('Invoice not found');
      const lines = await client.query<StaffInvoiceLine>(
        `SELECT description,quantity,unit_price::text AS "unitPrice",
                line_total::text AS "lineTotal",vat_rate AS "vatRate",
                vat_amount::text AS "vatAmount"
         FROM invoice_lines WHERE invoice_id=$1::uuid ORDER BY position,id`,
        [invoiceId]
      );
      return {
        ...serialize(row),
        lines: lines.rows,
        activity: await loadCustomerInvoiceActivity(client, invoiceId, row.profileId),
      };
    });
  }
}
