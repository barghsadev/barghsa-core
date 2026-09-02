/**
 * Customer invoice bank-receipt upload helpers (T-04.3.01.02).
 *
 * Client-side amount/file guards plus the presign → PUT → verify →
 * record → submit sequence. Amounts stay decimal-digit strings so int8
 * IRR never passes through JSON Number.
 */

import {
  BANK_RECEIPT_STORAGE_PURPOSE,
  INVOICE_BANK_RECEIPT_FILE_ACCEPT,
  evaluateInvoiceBankReceiptClientFile,
  parseInvoiceBankReceiptAmountIrR,
} from '@barghsa/shared/finance'
import { withCsrf } from './csrf.js'

export { INVOICE_BANK_RECEIPT_FILE_ACCEPT }

export type InvoiceReceiptError =
  | 'invalid-amount'
  | 'invalid-date'
  | 'invalid-payer-ref'
  | 'invalid-file'
  | 'upload'
  | 'conflict'
  | 'no-profile'
  | 'generic'

/**
 * Map Persian (`۰`–`۹`) and Arabic-Indic (`٠`–`٩`) digits to ASCII, then
 * keep decimal digits only so localized keyboards can enter an IRR amount.
 */
export function normalizeIrrAmountDigits(raw: string): string {
  let ascii = ''
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x06f0 && code <= 0x06f9) {
      ascii += String(code - 0x06f0)
    } else if (code >= 0x0660 && code <= 0x0669) {
      ascii += String(code - 0x0660)
    } else {
      ascii += ch
    }
  }
  return ascii.replace(/[^\d]/g, '')
}

export function utcTodayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function isAllowedInvoiceReceiptFile(file: File): boolean {
  return evaluateInvoiceBankReceiptClientFile({
    name: file.name,
    type: file.type,
    size: file.size,
  }).ok
}

export function mapInvoiceReceiptSubmitError(status: number): InvoiceReceiptError {
  if (status === 409) return 'conflict'
  if (status === 404) return 'no-profile'
  if (status === 400) return 'generic'
  return 'generic'
}

export async function uploadInvoiceReceiptAttachment(
  file: File,
  profileId: string,
): Promise<string | null> {
  const evaluated = evaluateInvoiceBankReceiptClientFile({
    name: file.name,
    type: file.type,
    size: file.size,
  })
  if (!evaluated.ok) return null
  const category = evaluated.category
  const presignRes = await fetch('/api/upload/presigned-url', {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || (category === 'document' ? 'application/pdf' : 'image/jpeg'),
      fileSize: file.size,
      category,
      metadata: { recordType: 'receipt' },
    }),
  })
  const presign = (await presignRes.json().catch(() => ({}))) as {
    key?: string
    presignedUrl?: string
  }
  if (!presignRes.ok || typeof presign.key !== 'string' || typeof presign.presignedUrl !== 'string') {
    return null
  }

  const putRes = await fetch(presign.presignedUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type || (category === 'document' ? 'application/pdf' : 'image/jpeg'),
    },
  })
  if (!putRes.ok) return null

  const encodedKey = encodeURIComponent(presign.key)
  const verifyRes = await fetch(`/api/upload/${encodedKey}/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({ Accept: 'application/json' }),
  })
  const verify = (await verifyRes.json().catch(() => ({}))) as { status?: string }
  if (!verifyRes.ok || verify.status !== 'confirmed') return null

  const recordRes = await fetch(`/api/upload/${encodedKey}/record`, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || undefined,
      fileSize: file.size,
      category,
      purpose: BANK_RECEIPT_STORAGE_PURPOSE,
      profileId,
    }),
  })
  if (!recordRes.ok) return null
  return presign.key
}

export async function submitInvoiceBankReceipt(input: {
  invoiceId: string
  amountIrR: bigint
  paymentDate: string
  payerReference: string
  attachmentKey: string
  customerNote?: string
}): Promise<{ ok: true; state: 'Submitted'; amount: bigint } | { ok: false; status: number }> {
  const res = await fetch(`/api/invoices/${input.invoiceId}/bank-receipts`, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      amount: input.amountIrR.toString(),
      paymentDate: input.paymentDate,
      payerReference: input.payerReference,
      attachmentKey: input.attachmentKey,
      customerNote: input.customerNote,
    }),
  })
  const payload = (await res.json().catch(() => ({}))) as {
    state?: string
    amount?: unknown
  }
  const confirmedAmount = parseInvoiceBankReceiptAmountIrR(payload.amount)
  if (!res.ok || payload.state !== 'Submitted' || confirmedAmount !== input.amountIrR) {
    return { ok: false, status: res.status }
  }
  return { ok: true, state: 'Submitted', amount: confirmedAmount }
}

export async function fetchActiveProfileId(): Promise<string | null> {
  const res = await fetch('/api/profiles', { credentials: 'include' })
  if (!res.ok) return null
  const data = (await res.json().catch(() => ({}))) as { activeProfileId?: unknown }
  return typeof data.activeProfileId === 'string' && data.activeProfileId.length > 0
    ? data.activeProfileId
    : null
}
