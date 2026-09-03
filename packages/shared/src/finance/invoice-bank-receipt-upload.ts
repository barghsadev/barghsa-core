/**
 * Customer invoice bank-receipt upload contract (S-04.3.01, T-04.3.01.02).
 *
 * Customers submit a receipt against an invoice (amount, payment date,
 * payer reference, attachment, optional note). The API creates a
 * `Submitted` `bank_receipts` row. Finance confirmation, wallet credit,
 * and invoice settlement are later tasks.
 *
 * Amount must be a positive int8 IRR value. The attachment must be a
 * PDF or common photo, within the category size cap (document 10 MB,
 * image 20 MB) — matching the deployment upload defaults.
 *
 * @module finance
 */

import { BANK_RECEIPT_SETTLEABLE_INVOICE_STATES } from './invoice-overpayment.js'
import {
  BANK_RECEIPT_ATTACHMENT_EXTENSIONS,
  parseBankReceiptAttachmentKey,
  parseBankReceiptCustomerNote,
  parseBankReceiptPayerReference,
  parseBankReceiptPaymentDate,
  parseBankReceiptTopUpAmountIrR,
  utcTodayIso,
  type BankReceiptTopUpDetails,
} from './wallet-bank-receipt-topup.js'

const MB = 1024 * 1024

/** PDF scans use the document upload category (deployment default 10 MB). */
export const INVOICE_BANK_RECEIPT_DOCUMENT_MAX_BYTES = 10 * MB

/** Photo receipts use the image upload category (deployment default 20 MB). */
export const INVOICE_BANK_RECEIPT_IMAGE_MAX_BYTES = 20 * MB

export const INVOICE_BANK_RECEIPT_ALLOWED_EXTENSIONS = BANK_RECEIPT_ATTACHMENT_EXTENSIONS

export const INVOICE_BANK_RECEIPT_ALLOWED_MIME_BY_CATEGORY = {
  document: ['application/pdf'],
  image: ['image/jpeg', 'image/png', 'image/webp'],
} as const

export type InvoiceBankReceiptFileCategory = keyof typeof INVOICE_BANK_RECEIPT_ALLOWED_MIME_BY_CATEGORY

export const INVOICE_BANK_RECEIPT_FILE_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp'

/**
 * Invoice states from which a customer may submit a bank receipt.
 * Same set as staff settleable states: Unpaid, PaymentUnderReview,
 * PartiallyFunded. Credit notes are rejected separately.
 */
export const INVOICE_BANK_RECEIPT_SUBMITTABLE_STATES =
  BANK_RECEIPT_SETTLEABLE_INVOICE_STATES

export type InvoiceBankReceiptSubmittableState =
  (typeof INVOICE_BANK_RECEIPT_SUBMITTABLE_STATES)[number]

export type InvoiceBankReceiptFileRejection = 'type' | 'size' | 'empty'

export interface InvoiceBankReceiptFileOk {
  ok: true
  category: InvoiceBankReceiptFileCategory
  fileSize: number
}

export interface InvoiceBankReceiptFileFailure {
  ok: false
  reason: InvoiceBankReceiptFileRejection
}

export type InvoiceBankReceiptFileResult =
  | InvoiceBankReceiptFileOk
  | InvoiceBankReceiptFileFailure

export interface InvoiceBankReceiptParseSuccess {
  ok: true
  amountIrR: bigint
  receipt: BankReceiptTopUpDetails
}

export interface InvoiceBankReceiptParseFailure {
  ok: false
  field: 'amount' | 'paymentDate' | 'payerReference' | 'attachmentKey' | 'customerNote'
  message: string
}

export type InvoiceBankReceiptParseResult =
  | InvoiceBankReceiptParseSuccess
  | InvoiceBankReceiptParseFailure

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export function invoiceBankReceiptMaxBytes(
  category: InvoiceBankReceiptFileCategory,
): number {
  return category === 'document'
    ? INVOICE_BANK_RECEIPT_DOCUMENT_MAX_BYTES
    : INVOICE_BANK_RECEIPT_IMAGE_MAX_BYTES
}

export function invoiceBankReceiptCategoryFromKey(
  attachmentKey: string,
): InvoiceBankReceiptFileCategory | null {
  if (attachmentKey.startsWith('uploads/document/')) return 'document'
  if (attachmentKey.startsWith('uploads/image/')) return 'image'
  return null
}

export function invoiceBankReceiptExtensionFromName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const trimmed = name.trim().toLowerCase()
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const base = slash === -1 ? trimmed : trimmed.slice(slash + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = base.slice(dot)
  return (INVOICE_BANK_RECEIPT_ALLOWED_EXTENSIONS as readonly string[]).includes(ext)
    ? ext
    : null
}

/**
 * Classify a browser File (name + MIME) as a receipt document or image.
 * Unknown combinations are rejected rather than guessed.
 */
export function invoiceBankReceiptCategoryFromClientFile(input: {
  name: unknown
  type: unknown
}): InvoiceBankReceiptFileCategory | null {
  const name = typeof input.name === 'string' ? input.name.toLowerCase() : ''
  const type = typeof input.type === 'string' ? input.type.toLowerCase() : ''
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'document'
  if (
    type === 'image/jpeg' ||
    type === 'image/png' ||
    type === 'image/webp' ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.png') ||
    name.endsWith('.webp')
  ) {
    return 'image'
  }
  return null
}

export function parsePositiveByteCount(raw: unknown): number | null {
  if (typeof raw === 'bigint') {
    if (raw <= 0n || raw > BigInt(Number.MAX_SAFE_INTEGER)) return null
    return Number(raw)
  }
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw <= 0) return null
    return raw
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!/^[1-9][0-9]{0,15}$/.test(trimmed)) return null
    const value = Number(trimmed)
    if (!Number.isSafeInteger(value) || value <= 0) return null
    return value
  }
  return null
}

/**
 * Client-side file type and size guard used before presign. Empty files
 * and oversize files are distinct from disallowed types.
 */
export function evaluateInvoiceBankReceiptClientFile(input: {
  name: unknown
  type: unknown
  size: unknown
}): InvoiceBankReceiptFileResult {
  const category = invoiceBankReceiptCategoryFromClientFile(input)
  if (category === null) return { ok: false, reason: 'type' }
  const size = parsePositiveByteCount(input.size)
  if (size === null) {
    if (input.size === 0 || input.size === 0n || input.size === '0') {
      return { ok: false, reason: 'empty' }
    }
    return { ok: false, reason: 'size' }
  }
  if (size > invoiceBankReceiptMaxBytes(category)) {
    return { ok: false, reason: 'size' }
  }
  return { ok: true, category, fileSize: size }
}

/**
 * Authoritative type/size check against the stored object. `fileSize` must
 * be the trusted object byte count from storage metadata, not a
 * client-declared value. Missing size fails closed. Declared
 * MIME/category/name, when present, must agree with the attachment key.
 */
export function evaluateInvoiceBankReceiptStoredFile(input: {
  attachmentKey: string
  fileSize: unknown
  contentType?: unknown
  category?: unknown
  fileName?: unknown
}): InvoiceBankReceiptFileResult {
  const keyCategory = invoiceBankReceiptCategoryFromKey(input.attachmentKey)
  if (keyCategory === null) return { ok: false, reason: 'type' }

  const keyExt = invoiceBankReceiptExtensionFromName(input.attachmentKey)
  if (keyExt === null) return { ok: false, reason: 'type' }

  if (typeof input.category === 'string' && input.category.trim() !== '') {
    if (input.category.trim() !== keyCategory) return { ok: false, reason: 'type' }
  }

  if (typeof input.fileName === 'string' && input.fileName.trim() !== '') {
    const nameExt = invoiceBankReceiptExtensionFromName(input.fileName)
    if (nameExt === null || nameExt !== keyExt) return { ok: false, reason: 'type' }
  }

  if (typeof input.contentType === 'string' && input.contentType.trim() !== '') {
    const mime = input.contentType.trim().toLowerCase()
    const allowed = INVOICE_BANK_RECEIPT_ALLOWED_MIME_BY_CATEGORY[keyCategory] as readonly string[]
    const expected = MIME_BY_EXTENSION[keyExt]
    if (!allowed.includes(mime) || (expected !== undefined && mime !== expected)) {
      return { ok: false, reason: 'type' }
    }
  }

  if (input.fileSize === 0 || input.fileSize === 0n || input.fileSize === '0') {
    return { ok: false, reason: 'empty' }
  }
  const fileSize = parsePositiveByteCount(input.fileSize)
  if (fileSize === null) return { ok: false, reason: 'empty' }
  if (fileSize > invoiceBankReceiptMaxBytes(keyCategory)) {
    return { ok: false, reason: 'size' }
  }
  return { ok: true, category: keyCategory, fileSize }
}

export function canCustomerSubmitInvoiceBankReceipt(input: {
  state: string
  adjustmentKind?: string | null
}): boolean {
  if (input.adjustmentKind === 'credit') return false
  return (INVOICE_BANK_RECEIPT_SUBMITTABLE_STATES as readonly string[]).includes(
    input.state,
  )
}

export function parseInvoiceBankReceiptAmountIrR(raw: unknown): bigint | null {
  return parseBankReceiptTopUpAmountIrR(raw)
}

/**
 * Validate the customer invoice-receipt payload. Does not credit a wallet
 * and does not change invoice state.
 */
export function parseInvoiceBankReceiptSubmission(
  input: unknown,
  todayIso: string = utcTodayIso(),
): InvoiceBankReceiptParseResult {
  if (!input || typeof input !== 'object') {
    return {
      ok: false,
      field: 'amount',
      message: 'Invoice bank receipt body must be an object',
    }
  }
  const body = input as Record<string, unknown>

  const amountIrR = parseInvoiceBankReceiptAmountIrR(body.amount)
  if (amountIrR === null) {
    return {
      ok: false,
      field: 'amount',
      message: 'Invoice bank receipt amount must be a positive integer IRR value',
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

export function invoiceBankReceiptDetailsMatch(
  row: {
    amount: string | number | bigint
    paymentDate: string
    payerReference: string
    attachmentKey: string
    customerNote: string | null
  },
  amountIrR: bigint,
  receipt: BankReceiptTopUpDetails,
): boolean {
  return (
    BigInt(row.amount) === amountIrR &&
    row.paymentDate === receipt.paymentDate &&
    row.payerReference === receipt.payerReference &&
    row.attachmentKey === receipt.attachmentKey &&
    (row.customerNote ?? null) === receipt.customerNote
  )
}
