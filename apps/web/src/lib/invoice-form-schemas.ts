import { custom } from 'zod/mini';
import type { $ZodType } from 'zod/v4/core';
import { isInvoiceUuid } from './invoice-uuid.js';
import {
  calculateInvoiceDraft,
  invoiceDigits,
  maxInvoiceIrr,
  type InvoiceDraftValues,
} from './invoice-draft.js';
export interface InvoiceFormMessages {
  profileId: string;
  reason: string;
  amount: string;
  lines: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vat: string;
}
export function invoiceDraftSchema(
  kind: 'manual' | 'replacement' | 'adjustment',
  messages: InvoiceFormMessages
): $ZodType<InvoiceDraftValues, InvoiceDraftValues> {
  return custom<InvoiceDraftValues>().check((ctx) => {
    const value = ctx.value;
    const issue = (path: string[], message: string) =>
      ctx.issues.push({ code: 'custom', input: value, path, message });
    if (kind === 'manual' && !isInvoiceUuid(value.profileId.trim()))
      issue(['profileId'], messages.profileId);
    if (kind !== 'manual' && (!value.reason.trim() || value.reason.trim().length > 1000))
      issue(['reason'], messages.reason);
    if (kind === 'adjustment') {
      const amount = invoiceDigits(value.amount);
      if (
        !/^-?\d{1,19}$/.test(amount) ||
        BigInt(amount) === 0n ||
        BigInt(amount) < -maxInvoiceIrr ||
        BigInt(amount) > maxInvoiceIrr
      )
        issue(['amount'], messages.amount);
      return;
    }
    for (const id of value.lineOrder) {
      const line = value.lines[id];
      if (!line) {
        issue(['lines'], messages.lines);
        continue;
      }
      const quantity = invoiceDigits(line.quantity),
        price = invoiceDigits(line.unitPrice);
      const rate = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(invoiceDigits(line.vat));
      if (!line.description.trim() || line.description.trim().length > 1000)
        issue(['lines', id, 'description'], messages.description);
      if (!/^\d{1,10}$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 2147483647)
        issue(['lines', id, 'quantity'], messages.quantity);
      if (!/^\d{1,19}$/.test(price) || BigInt(price) > maxInvoiceIrr)
        issue(['lines', id, 'unitPrice'], messages.unitPrice);
      if (!rate || Number(rate[1]) * 100 + Number((rate[2] ?? '').padEnd(2, '0')) > 10000)
        issue(['lines', id, 'vat'], messages.vat);
    }
    if (!ctx.issues.length && !calculateInvoiceDraft(value.lineOrder.map((id) => value.lines[id]!)))
      issue(['lines'], messages.lines);
  });
}
export function invoiceLookupSchema(
  message: string
): $ZodType<{ invoiceId: string }, { invoiceId: string }> {
  return custom<{ invoiceId: string }>().check((ctx) => {
    if (!isInvoiceUuid(ctx.value.invoiceId.trim()))
      ctx.issues.push({ code: 'custom', input: ctx.value, path: ['invoiceId'], message });
  });
}
