import { getDbPool } from '@barghsa/db';
import { NotFoundException } from '@nestjs/common';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';
import { lockInvoiceProfile } from './invoice-profile-lock.js';
import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { InvoiceState } from './invoice-state.model.js';
import type { TransitionResult } from './invoice-state-machine.service.js';

export function correctionFingerprint(payload: unknown): string {
  return createHash('sha256')
    .update(
      JSON.stringify(payload, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    )
    .digest('hex');
}

/** Caller holds the original invoice lock for the entire lookup/create transaction. */
export async function findCorrectionReplay(
  client: PoolClient,
  originalId: string,
  kind: 'replacement' | 'adjustment',
  key: string | undefined,
  fingerprint: string
): Promise<{ id: string; originalState: InvoiceState } | null> {
  if (!key) return null;
  const column = kind === 'replacement' ? 'replaces_invoice_id' : 'adjustment_for_invoice_id';
  const result = await client.query<{
    id: string;
    request: {
      fingerprint: string;
      originalState: InvoiceState;
    };
  }>(
    `SELECT id, metadata->'correctionRequest' AS request FROM invoices
    WHERE ${column}=$1 AND metadata->'correctionRequest'->>'key'=$2 LIMIT 2`,
    [originalId, key]
  );
  if (!result.rows.length) return null;
  if (result.rows.length !== 1 || result.rows[0]!.request?.fingerprint !== fingerprint)
    throw new ConflictException('Correction request key already used with another payload');
  return { id: result.rows[0]!.id, originalState: result.rows[0]!.request.originalState };
}

export async function correctionTransition(
  client: PoolClient,
  invoiceId: string,
  transition: 'Issue' | 'Cancel'
): Promise<TransitionResult> {
  const result = await client.query<{
    id: string;
    metadata: { fromState: InvoiceState; toState: InvoiceState };
  }>(
    `SELECT id, metadata::jsonb AS metadata FROM audit_log
     WHERE event=$1 AND metadata::jsonb->>'invoiceId'=$2 LIMIT 2`,
    [`invoice.${transition.toLowerCase()}`, invoiceId]
  );
  if (result.rows.length !== 1)
    throw new ConflictException('Correction audit needs reconciliation');
  const row = result.rows[0]!;
  return {
    invoiceId,
    transition,
    fromState: row.metadata.fromState,
    toState: row.metadata.toState,
    auditId: row.id,
  };
}

export async function invoiceCorrectionContext(
  invoiceId: string,
  actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>
) {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await lockInvoiceProfile(client, 'invoice', invoiceId);
    await requireStaffMutationPermission(client, actor.userId, 'invoices:write');
    await requireCurrentSession(client, actor);
    const invoice = (
      await client.query<{
        id: string;
        profile_id: string;
        state: InvoiceState;
        paid_amount: string;
        total_amount: string;
      }>(
        `SELECT id, profile_id, state, paid_amount, total_amount FROM invoices WHERE id=$1 FOR SHARE`,
        [invoiceId]
      )
    ).rows[0];
    if (!invoice) throw new NotFoundException('Invoice not found');
    const lines = await client.query<{
      description: string;
      quantity: number;
      unitPrice: string;
      vatRate: number;
      isTaxable: boolean;
    }>(
      `SELECT description, quantity, unit_price AS "unitPrice", vat_rate AS "vatRate", is_taxable AS "isTaxable"
       FROM invoice_lines WHERE invoice_id=$1 ORDER BY position, id`,
      [invoiceId]
    );
    await requireCurrentSession(client, actor);
    await client.query('COMMIT');
    return {
      invoiceId: invoice.id,
      profileId: invoice.profile_id,
      state: invoice.state,
      paidAmount: invoice.paid_amount,
      totalAmount: invoice.total_amount,
      lines: lines.rows,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
