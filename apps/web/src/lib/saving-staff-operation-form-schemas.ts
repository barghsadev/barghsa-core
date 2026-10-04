import { z } from 'zod/mini';
import type { SavingOperationDraft, SavingOperationIntent } from './saving-staff-operation-form.js';

export const inactiveSavingOperationSchema = z.custom<SavingOperationDraft>();
export function savingOperationSchema(
  intent: SavingOperationIntent,
  messages: Record<keyof SavingOperationDraft, string>
) {
  return z.custom<SavingOperationDraft>().check((ctx) => {
    const draft = ctx.value;
    const invalid = (field: keyof SavingOperationDraft) =>
      ctx.issues.push({
        code: 'custom',
        input: draft?.[field],
        path: [field],
        message: messages[field],
      });
    if (intent.kind === 'decision' && intent.action === 'approve') return;
    if (typeof draft?.note !== 'string' || !draft.note.trim() || draft.note.trim().length > 1000)
      invalid('note');
    if (intent.kind === 'stage') {
      const required = intent.stage === 'equipment_handover' && intent.action === 'complete';
      if (
        typeof draft?.handover !== 'string' ||
        (required && !draft.handover.trim()) ||
        draft.handover.trim().length > 1000
      )
        invalid('handover');
    }
  });
}
