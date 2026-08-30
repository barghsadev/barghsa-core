/**
 * InvoiceAuditRepository — append-only audit trail for invoice state
 * transitions (T-04.1.01.05).
 *
 * Every invoice state transition must produce exactly one durable audit
 * entry recording the actor, previous/new state, transition name,
 * timestamp, reason, and correlation ID (S-04.1.01 requirement #6).
 *
 * This repository is the single write path for those entries. It operates
 * on a transaction-scoped client so the audit insert commits (or rolls
 * back) atomically with the invoice state change in the calling service —
 * a transition is never persisted without its audit record and vice versa.
 */

import { Injectable } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import {
  DUE_AT_OVERRIDE_EVENT,
  type InvoiceDueAtOverrideSnapshot,
} from '@barghsa/shared/finance'
import {
  type InvoiceState,
  type InvoiceTransition,
  TRANSITION_LABELS,
} from './invoice-state.model.js'

/**
 * Minimal transaction-scoped client accepted by the repository.
 *
 * Structural type (query only) so the repository stays decoupled from the
 * `pg` driver and is trivially mockable in tests. A `pg` PoolClient
 * satisfies it; connection lifecycle (connect/release) belongs to the
 * caller that owns the transaction.
 */
export interface TransactionClient {
  query(text: string, params?: unknown[]): Promise<unknown>
}

/** Audit context for one invoice state transition (T-04.1.01.05). */
export interface InvoiceAuditEntry {
  /** The invoice whose state changed. */
  invoiceId: string
  /** State the invoice was in before the transition. */
  fromState: InvoiceState
  /** State the invoice is in after the transition. */
  toState: InvoiceState
  /** Named transition applied (one of the S-04.1.01 transition set). */
  transition: InvoiceTransition
  /** The user who performed the action (FK to `users.userId`). */
  actorUserId: string
  /** Opaque correlation ID linking related events. */
  correlationId?: string | undefined
  /** Human-readable reason (required for cancellations, refunds). */
  reason?: string | undefined
  /** Source IP of the requesting user; omit for system-initiated steps. */
  ip?: string | undefined
}

@Injectable()
export class InvoiceAuditRepository {
  /**
   * Record one append-only audit entry for an invoice state transition.
   *
   * Must be called inside the same DB transaction that applies the state
   * change; the insert uses the passed transaction-scoped client so it
   * commits or rolls back atomically with the transition itself.
   *
   * @param client transaction-scoped client (from `pool.connect()` after BEGIN)
   * @param entry  audit context for the transition
   * @param occurredAt when the transition occurred (overridable in tests)
   * @returns the generated audit entry id (UUIDv7)
   */
  async recordTransition(
    client: TransactionClient,
    entry: InvoiceAuditEntry,
    occurredAt: Date,
  ): Promise<string> {
    const auditId = uuidv7()
    const label = TRANSITION_LABELS[entry.transition]
    const event = `invoice.${label}`
    const metadata = JSON.stringify({
      invoiceId: entry.invoiceId,
      fromState: entry.fromState,
      toState: entry.toState,
      transition: label,
      reason: entry.reason ?? null,
    })

    await client.query(
      `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        auditId,
        entry.actorUserId,
        event,
        metadata,
        entry.correlationId ?? null,
        entry.ip ?? null,
        occurredAt,
      ],
    )

    return auditId
  }

  /**
   * Record one append-only audit entry for a staff `dueAt` override
   * (T-04.1.03.03). The customer-visible reason is stored in metadata
   * alongside previous/new due instants.
   *
   * Must run inside the same DB transaction that updates `invoices.due_at`
   * and invoice metadata.
   */
  async recordDueAtOverride(
    client: TransactionClient,
    entry: {
      invoiceId: string
      actorUserId: string
      snapshot: InvoiceDueAtOverrideSnapshot
      invoiceState: InvoiceState
      correlationId?: string | undefined
      ip?: string | undefined
    },
    occurredAt: Date,
  ): Promise<string> {
    const auditId = uuidv7()
    const metadata = JSON.stringify({
      invoiceId: entry.invoiceId,
      invoiceState: entry.invoiceState,
      previousDueAt: entry.snapshot.previousDueAt,
      newDueAt: entry.snapshot.dueAt,
      reason: entry.snapshot.reason,
      customerVisible: true,
    })

    await client.query(
      `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        auditId,
        entry.actorUserId,
        DUE_AT_OVERRIDE_EVENT,
        metadata,
        entry.correlationId ?? null,
        entry.ip ?? null,
        occurredAt,
      ],
    )

    return auditId
  }
}
