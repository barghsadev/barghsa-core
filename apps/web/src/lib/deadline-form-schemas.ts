import { custom } from 'zod/mini';
import { normalizeProfileDigits } from './profile-digits.js';
export interface DeadlineDraft {
  dueAt: string;
  reason: string;
}
export interface DeadlineBasis {
  dueAt: string | null;
  issuedAt: string | null;
  timezone: string;
}
export function deadlineSchema(
  source: DeadlineBasis,
  messages: DeadlineDraft,
  resolve: (value: string) => string | null
) {
  return custom<DeadlineDraft>().check((ctx) => {
    const iso = resolve(ctx.value.dueAt);
    if (
      !iso ||
      (source.issuedAt && Date.parse(iso) < Date.parse(source.issuedAt)) ||
      iso === source.dueAt
    )
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: ['dueAt'],
        message: messages.dueAt,
      });
    if (!ctx.value.reason.trim() || ctx.value.reason.trim().length > 2000)
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: ['reason'],
        message: messages.reason,
      });
  });
}
export function duePeriodSchema(messages: { serviceType: string; defaultDays: string }) {
  return custom<{ serviceType: string; defaultDays: string }>().check((ctx) => {
    if (!['electricity', 'saving_plan', 'consultation', 'manual'].includes(ctx.value.serviceType))
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: ['serviceType'],
        message: messages.serviceType,
      });
    const days = normalizeProfileDigits(ctx.value.defaultDays).trim();
    if (!/^\d{1,3}$/.test(days) || Number(days) < 1 || Number(days) > 365)
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: ['defaultDays'],
        message: messages.defaultDays,
      });
  });
}
