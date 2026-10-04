import { z } from 'zod/mini';
import type { StaffReasonDraft } from './electricity-staff-reason-form.js';

export const inactiveStaffReasonSchema = z.custom<StaffReasonDraft>();
export function staffReasonSchema(message: string) {
  return z.custom<StaffReasonDraft>().check((ctx) => {
    const value = ctx.value?.reason;
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 1000)
      ctx.issues.push({ code: 'custom', input: value, path: ['reason'], message });
  });
}
