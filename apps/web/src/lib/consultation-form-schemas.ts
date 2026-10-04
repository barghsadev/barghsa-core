import { z } from 'zod/mini';
import {
  consultationUuid,
  type ConsultationIntakeDraft,
  type ConsultationReasonDraft,
} from './consultation-form.js';
// A superseded lazy load must not attach owned errors or focus to the next request/profile.
export const inactiveReasonSchema = z.custom<ConsultationReasonDraft>();
export const inactiveIntakeSchema = z.custom<ConsultationIntakeDraft>();
export function intakeSchema(messages: Record<keyof ConsultationIntakeDraft, string>) {
  return z.custom<ConsultationIntakeDraft>().check((ctx) => {
    if (typeof ctx.value?.productId !== 'string' || !consultationUuid(ctx.value.productId))
      ctx.issues.push({
        code: 'custom',
        input: ctx.value?.productId,
        path: ['productId'],
        message: messages.productId,
      });
    if (ctx.value?.confirm !== true)
      ctx.issues.push({
        code: 'custom',
        input: ctx.value?.confirm,
        path: ['confirm'],
        message: messages.confirm,
      });
  });
}
export function reasonSchema(message: string, maxLength = 2000) {
  return z.custom<ConsultationReasonDraft>().check((ctx) => {
    const value = ctx.value?.reason;
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength)
      ctx.issues.push({ code: 'custom', input: value, path: ['reason'], message });
  });
}
