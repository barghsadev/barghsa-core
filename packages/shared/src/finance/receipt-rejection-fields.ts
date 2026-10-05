/** Pure customer-visible receipt rejection fields shared by wallet and invoice forms. */

/** Minimum trimmed length of the customer-visible rejection reason. */
export const BANK_RECEIPT_REJECT_REASON_MIN_LENGTH = 1;

/** Maximum trimmed length of the customer-visible rejection reason. */
export const BANK_RECEIPT_REJECT_REASON_MAX_LENGTH = 2000;

export const BANK_RECEIPT_CONFIRM_ERRORS = {
  BAD_REASON: () =>
    `reason is required (${BANK_RECEIPT_REJECT_REASON_MIN_LENGTH}–${BANK_RECEIPT_REJECT_REASON_MAX_LENGTH} characters) and is customer-visible`,
  NOT_PENDING: (state: string) => `Bank receipt top-up cannot be reviewed while it is ${state}`,
  NOT_BANK_RECEIPT: () => 'Transaction is not a pending bank-receipt top-up',
  ALREADY_CONFIRMED: () => 'Bank receipt top-up has already been confirmed',
  ALREADY_REJECTED: () => 'Bank receipt top-up has already been rejected',
  OWNER_UNNOTIFIABLE: () =>
    'Bank receipt top-up cannot be rejected because the customer owner cannot be notified',
} as const;

export const INVOICE_BANK_RECEIPT_REJECT_ERRORS = {
  BAD_REASON: () =>
    `reason is required (${BANK_RECEIPT_REJECT_REASON_MIN_LENGTH}–${BANK_RECEIPT_REJECT_REASON_MAX_LENGTH} characters) and is customer-visible`,
  NOT_REJECTABLE: (state: string) => `Invoice bank receipt cannot be rejected while it is ${state}`,
  OWNER_UNNOTIFIABLE: () =>
    'Invoice bank receipt cannot be rejected because the customer owner cannot be notified',
} as const;

export interface ParseRejectReasonSuccess {
  ok: true;
  reason: string;
}

export interface ParseRejectReasonFailure {
  ok: false;
  message: string;
}

export type ParseRejectReasonResult = ParseRejectReasonSuccess | ParseRejectReasonFailure;

/**
 * Parse the customer-visible rejection reason. Blank / oversized /
 * control-character values are rejected.
 */
export function parseBankReceiptRejectReason(raw: unknown): ParseRejectReasonResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: BANK_RECEIPT_CONFIRM_ERRORS.BAD_REASON() };
  }
  const body = raw as Record<string, unknown>;
  const value = body.reason;
  if (typeof value !== 'string') {
    return { ok: false, message: BANK_RECEIPT_CONFIRM_ERRORS.BAD_REASON() };
  }
  const trimmed = value.trim();
  if (
    trimmed.length < BANK_RECEIPT_REJECT_REASON_MIN_LENGTH ||
    trimmed.length > BANK_RECEIPT_REJECT_REASON_MAX_LENGTH
  ) {
    return { ok: false, message: BANK_RECEIPT_CONFIRM_ERRORS.BAD_REASON() };
  }
  // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted receipt text.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) {
    return { ok: false, message: BANK_RECEIPT_CONFIRM_ERRORS.BAD_REASON() };
  }
  return { ok: true, reason: trimmed };
}

/**
 * Parse the customer-visible rejection reason. Blank / oversized /
 * control-character values are rejected.
 */
export function parseInvoiceBankReceiptRejectReason(raw: unknown): ParseRejectReasonResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: INVOICE_BANK_RECEIPT_REJECT_ERRORS.BAD_REASON() };
  }
  const body = raw as Record<string, unknown>;
  const value = body.reason;
  if (typeof value !== 'string') {
    return { ok: false, message: INVOICE_BANK_RECEIPT_REJECT_ERRORS.BAD_REASON() };
  }
  const trimmed = value.trim();
  if (
    trimmed.length < BANK_RECEIPT_REJECT_REASON_MIN_LENGTH ||
    trimmed.length > BANK_RECEIPT_REJECT_REASON_MAX_LENGTH
  ) {
    return { ok: false, message: INVOICE_BANK_RECEIPT_REJECT_ERRORS.BAD_REASON() };
  }
  // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted receipt text.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) {
    return { ok: false, message: INVOICE_BANK_RECEIPT_REJECT_ERRORS.BAD_REASON() };
  }
  return { ok: true, reason: trimmed };
}
