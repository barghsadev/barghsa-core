import { z } from 'zod';
import { parseBankReceiptBankName } from './bank-receipt-bank-name.js';
import {
  isBankReceiptChannel,
  readBankReceiptStaffDecision,
} from './wallet-bank-receipt-confirmation.js';

export interface WalletBankReceiptTimeline {
  events: {
    state: 'submitted' | 'approval_requested' | 'confirmed' | 'rejected';
    occurredAt: string | null;
  }[];
  awaiting: 'review' | 'second_approval' | null;
}

/** Customer-safe receipt details. Never return raw ledger metadata or approval bindings. */
export interface WalletBankReceiptHistory {
  paymentDate: string | null;
  payerReference: string | null;
  bankName: string | null;
  customerNote: string | null;
  rejectionReason: string | null;
  timeline: WalletBankReceiptTimeline;
}

const timestamp = z.string().datetime({ offset: true });
const depositDate = z.string().date();
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function eventTime(value: unknown): string | null {
  return timestamp.safeParse(value).success ? (value as string) : null;
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Events reflect durable receipt facts; missing legacy timestamps are never inferred. */
export function readWalletBankReceiptHistory(row: {
  type: string;
  state: string;
  createdAt: string;
  metadata: unknown;
}): WalletBankReceiptHistory | null {
  const metadata = record(row.metadata);
  // Settlement creates a separate credit with the same channel. It is not another receipt.
  if (
    row.type !== 'topup' ||
    row.state === 'Completed' ||
    !isBankReceiptChannel(metadata) ||
    'pendingTransactionId' in metadata
  )
    return null;
  const receipt = record(metadata.receipt);
  const approval = record(metadata.dualApproval);
  const hasApproval =
    typeof approval.requestId === 'string' &&
    typeof approval.initiatorId === 'string' &&
    typeof approval.fingerprint === 'string' &&
    (approval.invoiceId === null || typeof approval.invoiceId === 'string');
  const decision = readBankReceiptStaffDecision(metadata);
  const terminal =
    row.state === 'Released' ? 'confirmed' : row.state === 'Rejected' ? 'rejected' : null;
  const matchingDecision = terminal !== null && decision?.decision === terminal ? decision : null;
  const events: WalletBankReceiptTimeline['events'] = [
    { state: 'submitted', occurredAt: eventTime(row.createdAt) },
  ];
  if (hasApproval)
    events.push({ state: 'approval_requested', occurredAt: eventTime(approval.requestedAt) });
  if (terminal)
    events.push({ state: terminal, occurredAt: eventTime(matchingDecision?.decidedAt) });
  return {
    paymentDate: depositDate.safeParse(receipt.paymentDate).success
      ? (receipt.paymentDate as string)
      : null,
    payerReference: text(receipt.payerReference),
    bankName: parseBankReceiptBankName(receipt.bankName) ?? null,
    customerNote: text(receipt.customerNote),
    rejectionReason:
      terminal === 'rejected' && matchingDecision?.customerVisible
        ? text(matchingDecision.reason)
        : null,
    timeline: {
      events,
      awaiting: row.state === 'Pending' ? (hasApproval ? 'second_approval' : 'review') : null,
    },
  };
}
