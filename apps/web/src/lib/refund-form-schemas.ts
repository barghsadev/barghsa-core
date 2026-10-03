import { z } from 'zod/mini';
import type { $ZodType } from 'zod/v4/core';
import { isInvoiceUuid } from './invoice-uuid.js';
import { normalizeProfileDigits } from './profile-digits.js';
import type {
  RefundDecisionValues,
  RefundOperation,
  RefundRequestValues,
} from '../hooks/useRefundForm.js';
export function refundLookupSchema(
  message: string
): $ZodType<{ invoiceId: string }, { invoiceId: string }> {
  return z.custom<{ invoiceId: string }>().check((ctx) => {
    const raw = ctx.value?.invoiceId;
    if (typeof raw !== 'string' || !isInvoiceUuid(raw.trim()))
      ctx.issues.push({ code: 'custom', input: raw, path: ['invoiceId'], message });
  });
}
export function refundRequestFormSchema(
  available: string,
  amount: string,
  reason: string
): $ZodType<RefundRequestValues, RefundRequestValues> {
  return z.custom<RefundRequestValues>().check((ctx) => {
    const raw = ctx.value?.amount;
    const value = typeof raw === 'string' ? normalizeProfileDigits(raw) : '';
    if (
      !/^\d{1,19}$/.test(value) ||
      !/^\d{1,19}$/.test(available) ||
      BigInt(value) <= 0n ||
      BigInt(value) > BigInt(available) ||
      BigInt(value) > 9223372036854775807n
    )
      ctx.issues.push({ code: 'custom', input: raw, path: ['amount'], message: amount });
    const text = ctx.value?.reason;
    if (typeof text !== 'string' || !text.trim() || text.trim().length > 1000)
      ctx.issues.push({ code: 'custom', input: text, path: ['reason'], message: reason });
  });
}
export function refundDecisionFormSchema(
  operation: RefundOperation | null,
  recordedReference: string | null,
  messages: { reason: string; bankReference: string; mismatch: string }
): $ZodType<RefundDecisionValues, RefundDecisionValues> {
  return z.custom<RefundDecisionValues>().check((ctx) => {
    const reason = ctx.value?.reason;
    const reference = ctx.value?.bankReference;
    if (
      typeof reason !== 'string' ||
      (operation === null && reason.trim().length > 1000) ||
      (['reject', 'cancel'].includes(operation ?? '') &&
        (!reason.trim() || reason.trim().length > 1000))
    )
      ctx.issues.push({
        code: 'custom',
        input: reason,
        path: ['reason'],
        message: messages.reason,
      });
    if (
      typeof reference !== 'string' ||
      (operation === null && reference.trim().length > 200) ||
      (['record-transfer', 'reconcile'].includes(operation ?? '') &&
        (!reference.trim() || reference.trim().length > 200))
    )
      ctx.issues.push({
        code: 'custom',
        input: reference,
        path: ['bankReference'],
        message: messages.bankReference,
      });
    else if (operation === 'reconcile' && reference.trim() !== recordedReference)
      ctx.issues.push({
        code: 'custom',
        input: reference,
        path: ['bankReference'],
        message: messages.mismatch,
      });
  });
}
