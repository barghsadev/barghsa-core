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

import { parseOnlineTopUpAmountIrR } from './wallet-topup-config.js'

/** Channel discriminator stored on the Pending ledger row metadata. */
export const BANK_RECEIPT_TOPUP_CHANNEL = 'bank_receipt' as const

/** Human-readable description written on the Pending ledger row. */
export const BANK_RECEIPT_TOPUP_DESCRIPTION = 'Bank receipt wallet top-up'

/** Allowed object-storage categories for a receipt scan or photo. */
export const BANK_RECEIPT_ATTACHMENT_CATEGORIES = ['document', 'image'] as const

/** Receipt files: PDF scans or common photo formats. */
export const BANK_RECEIPT_ATTACHMENT_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
] as const

const ATTACHMENT_KEY_RE =
  /^uploads\/(document|image)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.pdf|\.jpg|\.jpeg|\.png|\.webp)$/i

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const MAX_PAYER_REFERENCE_LENGTH = 128
const MAX_CUSTOMER_NOTE_LENGTH = 2000

export interface BankReceiptTopUpDetails {
  paymentDate: string
  payerReference: string
  attachmentKey: string
  customerNote: string | null
}

export interface BankReceiptTopUpParseSuccess {
  ok: true
  amountIrR: bigint
  receipt: BankReceiptTopUpDetails
}

export interface BankReceiptTopUpParseFailure {
  ok: false
  field:
    | 'amount'
    | 'paymentDate'
    | 'payerReference'
    | 'attachmentKey'
    | 'customerNote'
  message: string
}

export type BankReceiptTopUpParseResult =
  | BankReceiptTopUpParseSuccess
  | BankReceiptTopUpParseFailure

/**
 * Parse a bank-receipt top-up amount. Same positive-int8 rules as online
 * top-up amounts; the online per-transaction ceiling is **not** applied.
 */
export function parseBankReceiptTopUpAmountIrR(raw: unknown): bigint | null {
  return parseOnlineTopUpAmountIrR(raw)
}

/**
 * Parse a calendar payment date (`YYYY-MM-DD`). Rejects non-dates,
 * impossible calendar days, and dates after `todayIso` (UTC date by
 * default). Bank transfers cannot be dated in the future.
 */
export function parseBankReceiptPaymentDate(
  raw: unknown,
  todayIso: string = utcTodayIso(),
): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  const match = ISO_DATE_RE.exec(trimmed)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null
  }
  if (!ISO_DATE_RE.test(todayIso) || trimmed > todayIso) return null
  return trimmed
}

/** Payer / tracking reference from the bank slip. */
export function parseBankReceiptPayerReference(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length < 1 || trimmed.length > MAX_PAYER_REFERENCE_LENGTH) return null
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null
  return trimmed
}

/**
 * Object-storage key issued by the presigned upload flow. Must live under
 * `uploads/document/` or `uploads/image/` with a UUID file name and a
 * permitted receipt extension. Rejects path traversal.
 */
export function parseBankReceiptAttachmentKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.includes('..') || trimmed.includes('\\')) return null
  if (!ATTACHMENT_KEY_RE.test(trimmed)) return null
  return trimmed
}

/** Optional customer note. Blank input becomes `null`. */
export function parseBankReceiptCustomerNote(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > MAX_CUSTOMER_NOTE_LENGTH) return undefined
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) return undefined
  return trimmed
}

export function utcTodayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/**
 * Validate the full customer submission payload. Does not apply the
 * online top-up limit and does not credit the wallet.
 */
export function parseBankReceiptTopUpSubmission(
  input: unknown,
  todayIso: string = utcTodayIso(),
): BankReceiptTopUpParseResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, field: 'amount', message: 'Bank receipt top-up body must be an object' }
  }
  const body = input as Record<string, unknown>

  const amountIrR = parseBankReceiptTopUpAmountIrR(body.amount)
  if (amountIrR === null) {
    return {
      ok: false,
      field: 'amount',
      message: 'Bank receipt top-up amount must be a positive integer IRR value',
    }
  }

  const paymentDate = parseBankReceiptPaymentDate(body.paymentDate, todayIso)
  if (paymentDate === null) {
    return {
      ok: false,
      field: 'paymentDate',
      message: 'Payment date must be a calendar YYYY-MM-DD value that is not in the future',
    }
  }

  const payerReference = parseBankReceiptPayerReference(body.payerReference)
  if (payerReference === null) {
    return {
      ok: false,
      field: 'payerReference',
      message: 'Payer reference is required (1–128 characters)',
    }
  }

  const attachmentKey = parseBankReceiptAttachmentKey(body.attachmentKey)
  if (attachmentKey === null) {
    return {
      ok: false,
      field: 'attachmentKey',
      message:
        'Attachment key must be a verified uploads/document or uploads/image object with a PDF or image extension',
    }
  }

  const customerNote = parseBankReceiptCustomerNote(body.customerNote)
  if (customerNote === undefined) {
    return {
      ok: false,
      field: 'customerNote',
      message: 'Customer note must be at most 2000 characters',
    }
  }

  return {
    ok: true,
    amountIrR,
    receipt: {
      paymentDate,
      payerReference,
      attachmentKey,
      customerNote,
    },
  }
}

/** Metadata written onto the Pending `topup` ledger row. */
export function bankReceiptTopUpMetadata(
  receipt: BankReceiptTopUpDetails,
): Record<string, unknown> {
  return {
    channel: BANK_RECEIPT_TOPUP_CHANNEL,
    receipt: {
      paymentDate: receipt.paymentDate,
      payerReference: receipt.payerReference,
      attachmentKey: receipt.attachmentKey,
      customerNote: receipt.customerNote,
    },
  }
}

export function isBankReceiptTopUpMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  return (metadata as { channel?: unknown }).channel === BANK_RECEIPT_TOPUP_CHANNEL
}

export function receiptDetailsMatch(
  metadata: unknown,
  receipt: BankReceiptTopUpDetails,
): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  const record = metadata as { channel?: unknown; receipt?: unknown }
  if (record.channel !== BANK_RECEIPT_TOPUP_CHANNEL) return false
  if (!record.receipt || typeof record.receipt !== 'object') return false
  const stored = record.receipt as Record<string, unknown>
  return (
    stored.paymentDate === receipt.paymentDate &&
    stored.payerReference === receipt.payerReference &&
    stored.attachmentKey === receipt.attachmentKey &&
    (stored.customerNote ?? null) === receipt.customerNote
  )
}
