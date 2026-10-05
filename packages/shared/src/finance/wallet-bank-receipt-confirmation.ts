/**
 * Staff bank-receipt top-up confirmation contract (S-04.2.02, T-04.2.02.04).
 *
 * Finance staff review a Pending bank-receipt top-up, then confirm or
 * reject it. Confirm calls `WalletService.credit()` with a stable
 * idempotency key derived from the pending ledger id, then notifies the
 * customer via `payment.wallet_topup_completed`. Reject stores a
 * customer-visible reason, never increases wallet balance, and notifies
 * via `payment.wallet_topup_failed`.
 *
 * @module finance
 */

import type { NotificationChannel } from '../notifications/notification-transport.js';
import {
  bankReceiptOverpaymentCompletedNoticeFields,
  type BankReceiptOverpaymentSnapshot,
} from './invoice-overpayment.js';
import { BANK_RECEIPT_TOPUP_CHANNEL } from './wallet-bank-receipt-topup.js';
export {
  BANK_RECEIPT_REJECT_REASON_MIN_LENGTH,
  BANK_RECEIPT_REJECT_REASON_MAX_LENGTH,
  BANK_RECEIPT_CONFIRM_ERRORS,
  parseBankReceiptRejectReason,
  type ParseRejectReasonSuccess,
  type ParseRejectReasonFailure,
  type ParseRejectReasonResult,
} from './receipt-rejection-fields.js';

/** Capability gate documented on the staff API (mapped to isAdmin today). */
export const BANK_RECEIPT_CONFIRM_PERMISSION = 'admin:finance:wallet:bank-receipt-confirm' as const;

/** Canonical audit event when staff confirm a bank-receipt top-up. */
export const BANK_RECEIPT_CONFIRMED_EVENT = 'wallet.bank_receipt.confirmed' as const;

/** Canonical audit event when staff reject a bank-receipt top-up. */
export const BANK_RECEIPT_REJECTED_EVENT = 'wallet.bank_receipt.rejected' as const;

/** Human-readable description written on the Completed credit ledger row. */
export const BANK_RECEIPT_CREDIT_DESCRIPTION = 'Bank receipt wallet top-up';

/**
 * Customer notification events (E-05 registry). Distinct from the audit
 * events so template lookup stays on the `payment.*` namespace.
 */
export const BANK_RECEIPT_TOPUP_COMPLETED_NOTIFICATION_EVENT_KEY =
  'payment.wallet_topup_completed' as const;

export const BANK_RECEIPT_TOPUP_FAILED_NOTIFICATION_EVENT_KEY =
  'payment.wallet_topup_failed' as const;

/** In-app is the customer push; email is the durable fallback. */
export const BANK_RECEIPT_NOTIFY_CHANNELS: readonly NotificationChannel[] = ['in_app', 'email'];

/** Customer wallet history deep-link persisted onto the in-app push. */
export const BANK_RECEIPT_CUSTOMER_WALLET_ROUTE = '/wallet' as const;

export type BankReceiptStaffDecision = 'confirmed' | 'rejected';

export interface BankReceiptStaffDecisionSnapshot {
  decision: BankReceiptStaffDecision;
  actorUserId: string;
  decidedAt: string;
  reason: string | null;
  customerVisible: boolean;
  creditTransactionId: string | null;
}

/**
 * Stable credit idempotency key for a pending bank-receipt top-up.
 *
 * Distinct from the customer's submission key so `WalletService.credit()`
 * can insert the Completed credit row without colliding with the Pending
 * intent (same pattern as online top-up confirmation).
 */
export function bankReceiptCreditIdempotencyKey(pendingTransactionId: string): string {
  return `wallet-bank-receipt-topup-credit:${pendingTransactionId}`;
}

export function isPendingBankReceiptTopUp(row: {
  type: string;
  state: string;
  metadata?: unknown;
}): boolean {
  return row.type === 'topup' && row.state === 'Pending' && isBankReceiptChannel(row.metadata);
}

export function isBankReceiptChannel(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  return (metadata as { channel?: unknown }).channel === BANK_RECEIPT_TOPUP_CHANNEL;
}

export function readBankReceiptStaffDecision(
  metadata: unknown
): BankReceiptStaffDecisionSnapshot | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const record = (metadata as { staffDecision?: unknown }).staffDecision;
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const snap = record as Record<string, unknown>;
  if (snap.decision !== 'confirmed' && snap.decision !== 'rejected') return null;
  if (typeof snap.actorUserId !== 'string' || typeof snap.decidedAt !== 'string') return null;
  return {
    decision: snap.decision,
    actorUserId: snap.actorUserId,
    decidedAt: snap.decidedAt,
    reason: typeof snap.reason === 'string' ? snap.reason : null,
    customerVisible: snap.customerVisible === true,
    creditTransactionId:
      typeof snap.creditTransactionId === 'string' ? snap.creditTransactionId : null,
  };
}

export function bankReceiptStaffDecisionMetadata(input: {
  decision: BankReceiptStaffDecision;
  actorUserId: string;
  decidedAt: Date;
  reason?: string | null;
  creditTransactionId?: string | null;
}): Record<string, unknown> {
  return {
    staffDecision: {
      decision: input.decision,
      actorUserId: input.actorUserId,
      decidedAt: input.decidedAt.toISOString(),
      reason: input.reason ?? null,
      customerVisible: input.decision === 'rejected',
      creditTransactionId: input.creditTransactionId ?? null,
    } satisfies BankReceiptStaffDecisionSnapshot,
  };
}

export function bankReceiptCreditMetadata(input: {
  pendingTransactionId: string;
  confirmedBy: string;
  confirmedAt: Date;
  receipt: unknown;
}): Record<string, unknown> {
  return {
    channel: BANK_RECEIPT_TOPUP_CHANNEL,
    pendingTransactionId: input.pendingTransactionId,
    confirmedBy: input.confirmedBy,
    confirmedAt: input.confirmedAt.toISOString(),
    receipt: input.receipt ?? null,
  };
}

/** Outbox idempotency key: one completed notice per pending receipt. */
export function bankReceiptTopUpCompletedNotificationIdempotencyKey(
  pendingTransactionId: string
): string {
  return `${BANK_RECEIPT_TOPUP_COMPLETED_NOTIFICATION_EVENT_KEY}:${pendingTransactionId}`;
}

/** Outbox idempotency key: one failure notice per pending receipt. */
export function bankReceiptTopUpFailedNotificationIdempotencyKey(
  pendingTransactionId: string
): string {
  return `${BANK_RECEIPT_TOPUP_FAILED_NOTIFICATION_EVENT_KEY}:${pendingTransactionId}`;
}

export interface BankReceiptTopUpCompletedNotificationPayload {
  amount: string;
  transactionId: string;
  pending_transaction_id: string;
  link_route: string;
  invoice_id?: string;
  invoice_allocation?: string;
  remaining_before?: string;
  wallet_credit_amount?: string;
  is_overpayment?: true;
}

export interface BankReceiptTopUpFailedNotificationPayload {
  amount: string;
  reason: string;
  pending_transaction_id: string;
  link_route: string;
}

export function buildBankReceiptTopUpCompletedNotificationPayload(input: {
  amount: string;
  creditTransactionId: string;
  pendingTransactionId: string;
  overpayment?: BankReceiptOverpaymentSnapshot | null;
}): BankReceiptTopUpCompletedNotificationPayload {
  const overpaymentFields = bankReceiptOverpaymentCompletedNoticeFields(input.overpayment);
  return {
    amount: input.amount,
    transactionId: input.creditTransactionId,
    pending_transaction_id: input.pendingTransactionId,
    link_route: BANK_RECEIPT_CUSTOMER_WALLET_ROUTE,
    ...(overpaymentFields ?? {}),
  };
}

export function buildBankReceiptTopUpFailedNotificationPayload(input: {
  amount: string;
  reason: string;
  pendingTransactionId: string;
}): BankReceiptTopUpFailedNotificationPayload {
  return {
    amount: input.amount,
    reason: input.reason,
    pending_transaction_id: input.pendingTransactionId,
    link_route: BANK_RECEIPT_CUSTOMER_WALLET_ROUTE,
  };
}
