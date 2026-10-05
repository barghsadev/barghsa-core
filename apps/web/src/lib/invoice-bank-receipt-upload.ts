import { inputErrorFields } from './input-error-fields.js';
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
  invoiceBankReceiptContentTypeFromName,
  parseInvoiceBankReceiptAmountIrR,
} from '@barghsa/shared/finance/browser';
import { withCsrf } from './csrf.js';

export { INVOICE_BANK_RECEIPT_FILE_ACCEPT };
export {
  isAllowedInvoiceReceiptFile,
  normalizeIrrAmountDigits,
} from './invoice-bank-receipt-fields.js';

/** Malformed server JSON is an unavailable acknowledgement, never a typed record. */
async function readResponseObject(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null);
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export type InvoiceReceiptError =
  | 'invalid-amount'
  | 'invalid-date'
  | 'invalid-payer-ref'
  | 'invalid-file'
  | 'upload'
  | 'conflict'
  | 'no-profile'
  | 'generic';

export function utcTodayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function mapInvoiceReceiptSubmitError(status: number): InvoiceReceiptError {
  if (status === 409) return 'conflict';
  if (status === 404) return 'no-profile';
  if (status === 400) return 'generic';
  return 'generic';
}

export async function uploadInvoiceReceiptAttachment(
  file: File,
  profileId: string
): Promise<string | null> {
  return uploadVerifiedAttachment(file, profileId, BANK_RECEIPT_STORAGE_PURPOSE);
}

export async function uploadVerificationEvidence(
  file: File,
  profileId: string
): Promise<string | null> {
  return uploadVerifiedAttachment(file, profileId, 'verification_evidence');
}

export async function uploadTicketAttachment(
  file: File,
  profileId: string | null
): Promise<string | null> {
  return uploadVerifiedAttachment(file, profileId, 'ticket_attachment');
}

export async function uploadLegalProfileDocument(
  file: File,
  profileId: string
): Promise<string | null> {
  return uploadVerifiedAttachment(file, profileId, 'legal_profile_document');
}

export async function uploadTicketReplyAttachment(
  file: File,
  profileId: string | null,
  ticketId: string
): Promise<string | null> {
  return uploadVerifiedAttachment(file, profileId, 'ticket_reply_attachment', ticketId);
}

async function uploadVerifiedAttachment(
  file: File,
  profileId: string | null,
  purpose: string,
  ticketId?: string
): Promise<string | null> {
  const evaluated = evaluateInvoiceBankReceiptClientFile({
    name: file.name,
    type: file.type,
    size: file.size,
  });
  if (!evaluated.ok) return null;
  const category = evaluated.category;
  const contentType = file.type || invoiceBankReceiptContentTypeFromName(file.name);
  if (!contentType) return null;
  const presignRes = await fetch('/api/upload/presigned-url', {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      fileName: file.name,
      contentType,
      fileSize: file.size,
      category,
      purpose,
      ...(profileId ? { profileId } : {}),
      ...(ticketId ? { ticketId } : {}),
      metadata: { recordType: 'receipt' },
    }),
  });
  const presign = await readResponseObject(presignRes);
  if (
    !presignRes.ok ||
    typeof presign.key !== 'string' ||
    typeof presign.presignedUrl !== 'string'
  ) {
    return null;
  }

  const putRes = await fetch(presign.presignedUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': contentType,
      'If-None-Match': '*',
    },
  });
  if (!putRes.ok) return null;

  const encodedKey = encodeURIComponent(presign.key);
  const verifyRes = await fetch(`/api/upload/${encodedKey}/verify`, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({ Accept: 'application/json' }),
  });
  const verify = await readResponseObject(verifyRes);
  if (!verifyRes.ok || verify.status !== 'confirmed') return null;

  const recordRes = await fetch(`/api/upload/${encodedKey}/record`, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({
      fileName: file.name,
      contentType,
      fileSize: file.size,
      category,
      purpose,
      ...(profileId ? { profileId } : {}),
      ...(ticketId ? { ticketId } : {}),
    }),
  });
  if (!recordRes.ok) return null;
  return presign.key;
}

export async function submitInvoiceBankReceipt(input: {
  invoiceId: string;
  amountIrR: bigint;
  paymentDate: string;
  payerReference: string;
  bankName?: string;
  attachmentKey: string;
  customerNote?: string;
  expectedReviewHash: string;
}): Promise<
  | { ok: true; state: 'Submitted'; amount: bigint }
  | { ok: false; status: number; fields?: unknown[] }
> {
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
      bankName: input.bankName,
      attachmentKey: input.attachmentKey,
      customerNote: input.customerNote,
      expectedReviewHash: input.expectedReviewHash,
    }),
  });
  const payload = await readResponseObject(res);
  const confirmedAmount = parseInvoiceBankReceiptAmountIrR(payload.amount);
  if (!res.ok || payload.state !== 'Submitted' || confirmedAmount !== input.amountIrR) {
    return { ok: false, status: res.status, ...inputErrorFields(payload, res.status) };
  }
  return { ok: true, state: 'Submitted', amount: confirmedAmount };
}

export async function fetchActiveProfileId(): Promise<string | null> {
  const res = await fetch('/api/profiles', { credentials: 'include' });
  if (!res.ok) return null;
  const data = await readResponseObject(res);
  return typeof data.activeProfileId === 'string' && data.activeProfileId.length > 0
    ? data.activeProfileId
    : null;
}
