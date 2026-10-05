import { z } from 'zod/mini';
import type {
  SignatureRequestDraft,
  SignatureRecordDraft,
} from './contract-review-signature-form.js';
export const inactiveChangesSchema = z.custom<{ reason: string }>();
export const inactiveSignatureRequestSchema = z.custom<SignatureRequestDraft>();
export const inactiveSignatureRecordSchema = z.custom<SignatureRecordDraft>();
export function contractChangesSchema(message: string) {
  return z.custom<{ reason: string }>().check((ctx) => {
    const reason = ctx.value?.reason;
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000)
      ctx.issues.push({ code: 'custom', input: reason, path: ['reason'], message });
  });
}
export function signatureRequestSchema(message: string, ids: string[]) {
  return z.custom<SignatureRequestDraft>().check((ctx) => {
    if (!ids.includes(ctx.value?.originalDocumentId))
      ctx.issues.push({
        code: 'custom',
        input: ctx.value?.originalDocumentId,
        path: ['originalDocumentId'],
        message,
      });
  });
}
export function signatureRecordSchema(message: string, acknowledgement: string, ids: string[]) {
  return z.custom<SignatureRecordDraft>().check((ctx) => {
    if (!ids.includes(ctx.value?.signedDocumentId))
      ctx.issues.push({
        code: 'custom',
        input: ctx.value?.signedDocumentId,
        path: ['signedDocumentId'],
        message,
      });
    if (ctx.value?.acknowledged !== true)
      ctx.issues.push({
        code: 'custom',
        input: ctx.value?.acknowledged,
        path: ['acknowledged'],
        message: acknowledgement,
      });
  });
}
