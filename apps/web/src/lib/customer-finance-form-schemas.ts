import { z } from 'zod/mini';
import type { $ZodType } from 'zod/v4/core';
import {
  parseBankReceiptPaymentDate,
  parseBankReceiptPayerReference,
  parseBankReceiptBankName,
  parseBankReceiptCustomerNote,
} from '@barghsa/shared/finance/browser';
import {
  isAllowedInvoiceReceiptFile,
  normalizeIrrAmountDigits,
} from './invoice-bank-receipt-upload.js';

export interface ReceiptFormValues {
  amount: string;
  paymentDate: string;
  payerReference: string;
  bankName: string;
  customerNote: string;
  file: File | null;
}
export function createReceiptFormSchema(
  parseAmount: (raw: string) => bigint | null,
  messages: Record<keyof ReceiptFormValues, string>
): $ZodType<ReceiptFormValues, ReceiptFormValues> {
  // Keep the shared domain rules and report every invalid editable field.
  return z.custom<ReceiptFormValues>().check((ctx) => {
    const validators = {
      amount: (raw: string) => parseAmount(normalizeIrrAmountDigits(raw)) !== null,
      paymentDate: (raw: string) => parseBankReceiptPaymentDate(raw) !== null,
      payerReference: (raw: string) => parseBankReceiptPayerReference(raw) !== null,
      bankName: (raw: string) => parseBankReceiptBankName(raw) !== undefined,
      customerNote: (raw: string) => parseBankReceiptCustomerNote(raw) !== undefined,
    };
    for (const name of Object.keys(validators) as (keyof typeof validators)[]) {
      const raw = ctx.value?.[name];
      if (typeof raw !== 'string' || !validators[name](raw))
        ctx.issues.push({ code: 'custom', input: raw, path: [name], message: messages[name] });
    }
    const file = ctx.value?.file;
    if (!(file instanceof File) || !isAllowedInvoiceReceiptFile(file))
      ctx.issues.push({ code: 'custom', input: file, path: ['file'], message: messages.file });
  });
}
export function createOnlineTopUpSchema(
  limit: number | null,
  messages: { invalid: string; limit: string }
): $ZodType<{ amount: string }, { amount: string }> {
  return z.custom<{ amount: string }>().check((ctx) => {
    const raw = ctx.value?.amount;
    const invalid =
      typeof raw !== 'string' ||
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(Number(raw)) ||
      Number(raw) <= 0;
    if (invalid || limit === null || limit === 0 || Number(raw) > limit)
      ctx.issues.push({
        code: 'custom',
        input: raw,
        path: ['amount'],
        message: invalid ? messages.invalid : messages.limit,
      });
  });
}
