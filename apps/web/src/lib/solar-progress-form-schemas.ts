import { z } from 'zod/mini';
import type { ProgressNoteDraft } from './solar-progress-form.js';

export const inactiveProgressNoteSchema = z.custom<ProgressNoteDraft>();
export function progressNoteSchema(message: string) {
  return z.custom<ProgressNoteDraft>().check((ctx) => {
    const value = ctx.value?.note;
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 1000)
      ctx.issues.push({ code: 'custom', input: value, path: ['note'], message });
  });
}
