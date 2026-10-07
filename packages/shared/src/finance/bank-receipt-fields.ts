/** Shared receipt field guards without settlement or metadata writers. */
import { parseOnlineTopUpAmountIrR } from './wallet-topup-fields.js';

/** Channel discriminator stored on the Pending ledger row metadata. */
export const BANK_RECEIPT_TOPUP_CHANNEL = 'bank_receipt' as const;

/**
 * Intended-purpose value persisted on `storage_records.metadata` when a
 * customer uploads a bank-receipt scan. Top-up submission requires this
 * exact purpose so an unrelated verified object cannot back a claim.
 */
export const BANK_RECEIPT_STORAGE_PURPOSE = 'bank_receipt' as const;

export type BankReceiptStorageRejection =
  'missing' | 'unverified' | 'wrong_owner' | 'wrong_purpose';

/** Human-readable description written on the Pending ledger row. */
export const BANK_RECEIPT_TOPUP_DESCRIPTION = 'Bank receipt wallet top-up';

/** Allowed object-storage categories for a receipt scan or photo. */
export const BANK_RECEIPT_ATTACHMENT_CATEGORIES = ['document', 'image'] as const;

/** Receipt files: PDF scans or common photo formats. */
export const BANK_RECEIPT_ATTACHMENT_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
] as const;

const ATTACHMENT_KEY_RE =
  /^uploads\/(document|image)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.pdf|\.jpg|\.jpeg|\.png|\.webp)$/i;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MAX_PAYER_REFERENCE_LENGTH = 128;
const MAX_CUSTOMER_NOTE_LENGTH = 2000;

export interface BankReceiptTopUpDetails {
  bankName?: string | null;
  paymentDate: string;
  payerReference: string;
  attachmentKey: string;
  customerNote: string | null;
}

export interface BankReceiptTopUpParseSuccess {
  ok: true;
  amountIrR: bigint;
  receipt: BankReceiptTopUpDetails;
}

export interface BankReceiptTopUpParseFailure {
  ok: false;
  field:
    'amount' | 'paymentDate' | 'payerReference' | 'attachmentKey' | 'customerNote' | 'bankName';
  message: string;
}

export type BankReceiptTopUpParseResult =
  BankReceiptTopUpParseSuccess | BankReceiptTopUpParseFailure;

/**
 * Parse a bank-receipt top-up amount. Same positive-int8 rules as online
 * top-up amounts; the online per-transaction ceiling is **not** applied.
 */
export function parseBankReceiptTopUpAmountIrR(raw: unknown): bigint | null {
  return parseOnlineTopUpAmountIrR(raw);
}

/**
 * Parse a calendar payment date (`YYYY-MM-DD`). Rejects non-dates,
 * impossible calendar days, and dates after `todayIso` (UTC date by
 * default). Bank transfers cannot be dated in the future.
 */
export function parseBankReceiptPaymentDate(
  raw: unknown,
  todayIso: string = utcTodayIso()
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = ISO_DATE_RE.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  if (!ISO_DATE_RE.test(todayIso) || trimmed > todayIso) return null;
  return trimmed;
}

/** Payer / tracking reference from the bank slip. */
export function parseBankReceiptPayerReference(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_PAYER_REFERENCE_LENGTH) return null;
  // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted receipt text.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Object-storage key issued by the presigned upload flow. Must live under
 * `uploads/document/` or `uploads/image/` with a UUID file name and a
 * permitted receipt extension. Rejects path traversal.
 */
export function parseBankReceiptAttachmentKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.includes('..') || trimmed.includes('\\')) return null;
  if (!ATTACHMENT_KEY_RE.test(trimmed)) return null;
  return trimmed;
}

/** Optional customer note. Blank input becomes `null`. */
export function parseBankReceiptCustomerNote(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_CUSTOMER_NOTE_LENGTH) return undefined;
  // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted receipt text.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) return undefined;
  return trimmed;
}

export function utcTodayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Invoice states that can still absorb a bank-receipt allocation.
 * S-04.1.01 permits SubmitBankReceipt only from Unpaid / PartiallyFunded
 * (and ConfirmBankReceipt from PaymentUnderReview). S-04.1.03 also
 * permits payment when Overdue. Paid has remaining 0, so a linked
 * receipt is entirely verified wallet excess.
 */
export const BANK_RECEIPT_SETTLEABLE_INVOICE_STATES = [
  'Unpaid',
  'PaymentUnderReview',
  'PartiallyFunded',
  'Overdue',
] as const;
