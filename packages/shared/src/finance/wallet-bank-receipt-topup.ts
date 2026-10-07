import { parseBankReceiptBankName } from './bank-receipt-bank-name.js';
import {
  BANK_RECEIPT_TOPUP_CHANNEL,
  BANK_RECEIPT_STORAGE_PURPOSE,
  parseBankReceiptTopUpAmountIrR,
  parseBankReceiptPaymentDate,
  parseBankReceiptPayerReference,
  parseBankReceiptAttachmentKey,
  parseBankReceiptCustomerNote,
  utcTodayIso,
  type BankReceiptTopUpDetails,
  type BankReceiptTopUpParseResult,
  type BankReceiptStorageRejection,
} from './bank-receipt-fields.js';
export * from './bank-receipt-fields.js';

/**
 * Bank-receipt wallet top-up submission contract (S-04.2.02, T-04.2.02.03).
 *
 * Customers submit a receipt (amount, payment date, payer reference,
 * attachment, optional note). The API creates a Pending `topup` ledger
 * row and does **not** credit the wallet — finance staff confirmation
 * (T-04.2.02.04) is the only path that calls `WalletService.credit()`.
 *
 * Unlike online top-ups, bank-receipt top-ups have **no configured
 * maximum**. Amount validation is limited to a positive int8 IRR value.
 *
 * @module finance
 */

/**
 * Validate the full customer submission payload. Does not apply the
 * online top-up limit and does not credit the wallet.
 */
export function parseBankReceiptTopUpSubmission(
  input: unknown,
  todayIso: string = utcTodayIso()
): BankReceiptTopUpParseResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, field: 'amount', message: 'Bank receipt top-up body must be an object' };
  }
  const body = input as Record<string, unknown>;

  const amountIrR = parseBankReceiptTopUpAmountIrR(body.amount);
  if (amountIrR === null) {
    return {
      ok: false,
      field: 'amount',
      message: 'Bank receipt top-up amount must be a positive integer IRR value',
    };
  }

  const paymentDate = parseBankReceiptPaymentDate(body.paymentDate, todayIso);
  if (paymentDate === null) {
    return {
      ok: false,
      field: 'paymentDate',
      message: 'Payment date must be a calendar YYYY-MM-DD value that is not in the future',
    };
  }

  const payerReference = parseBankReceiptPayerReference(body.payerReference);
  if (payerReference === null) {
    return {
      ok: false,
      field: 'payerReference',
      message: 'Payer reference is required (1–128 characters)',
    };
  }

  const attachmentKey = parseBankReceiptAttachmentKey(body.attachmentKey);
  if (attachmentKey === null) {
    return {
      ok: false,
      field: 'attachmentKey',
      message:
        'Attachment key must be a verified uploads/document or uploads/image object with a PDF or image extension',
    };
  }

  const bankName = parseBankReceiptBankName(body.bankName);
  if (bankName === undefined) {
    return {
      ok: false,
      field: 'bankName',
      message: 'Bank name must be at most 128 characters on one line',
    };
  }

  const customerNote = parseBankReceiptCustomerNote(body.customerNote);
  if (customerNote === undefined) {
    return {
      ok: false,
      field: 'customerNote',
      message: 'Customer note must be at most 2000 characters',
    };
  }

  return {
    ok: true,
    amountIrR,
    receipt: {
      paymentDate,
      payerReference,
      attachmentKey,
      customerNote,
      ...(bankName ? { bankName } : {}),
    },
  };
}

/** Metadata written onto the Pending `topup` ledger row. */
export function bankReceiptTopUpMetadata(
  receipt: BankReceiptTopUpDetails
): Record<string, unknown> {
  return {
    channel: BANK_RECEIPT_TOPUP_CHANNEL,
    receipt: {
      paymentDate: receipt.paymentDate,
      payerReference: receipt.payerReference,
      attachmentKey: receipt.attachmentKey,
      customerNote: receipt.customerNote,
      ...(receipt.bankName ? { bankName: receipt.bankName } : {}),
    },
  };
}

export function isBankReceiptTopUpMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return (metadata as { channel?: unknown }).channel === BANK_RECEIPT_TOPUP_CHANNEL;
}

export function receiptDetailsMatch(metadata: unknown, receipt: BankReceiptTopUpDetails): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const record = metadata as { channel?: unknown; receipt?: unknown };
  if (record.channel !== BANK_RECEIPT_TOPUP_CHANNEL) return false;
  if (!record.receipt || typeof record.receipt !== 'object') return false;
  const stored = record.receipt as Record<string, unknown>;
  return (
    stored.paymentDate === receipt.paymentDate &&
    stored.payerReference === receipt.payerReference &&
    stored.attachmentKey === receipt.attachmentKey &&
    (stored.customerNote ?? null) === receipt.customerNote &&
    (stored.bankName ?? null) === (receipt.bankName ?? null)
  );
}

/**
 * Authoritative storage-record provenance written after upload
 * verification succeeds. `verified` is never inferred from row
 * existence — the record endpoint must persist this payload.
 */
export function bankReceiptStorageProvenance(input: {
  uploadedBy: string;
  profileId?: string;
  purpose?: string;
  verifiedAt?: string;
}): Record<string, unknown> {
  return {
    verified: true,
    verifiedAt: input.verifiedAt ?? new Date().toISOString(),
    uploadedBy: input.uploadedBy,
    profileId: input.profileId ?? null,
    purpose: input.purpose ?? BANK_RECEIPT_STORAGE_PURPOSE,
  };
}

/**
 * Require a verified bank-receipt object owned by the submitting actor
 * or bound to the accessible profile. Unverified, other-purpose, and
 * other-owner keys are distinct rejections for tests and API messages.
 */
export function evaluateBankReceiptStorageMetadata(
  metadata: unknown,
  actorId: string,
  profileId: string
): { ok: true } | { ok: false; reason: BankReceiptStorageRejection } {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { ok: false, reason: 'missing' };
  }
  const record = metadata as Record<string, unknown>;
  if (record.verified !== true) {
    return { ok: false, reason: 'unverified' };
  }
  if (record.purpose !== BANK_RECEIPT_STORAGE_PURPOSE) {
    return { ok: false, reason: 'wrong_purpose' };
  }
  const uploadedBy = typeof record.uploadedBy === 'string' ? record.uploadedBy : '';
  const boundProfile = typeof record.profileId === 'string' ? record.profileId : '';
  if (uploadedBy !== actorId && boundProfile !== profileId) {
    return { ok: false, reason: 'wrong_owner' };
  }
  return { ok: true };
}
