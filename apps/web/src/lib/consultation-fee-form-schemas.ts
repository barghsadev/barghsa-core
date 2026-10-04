import { z } from 'zod/mini';
import {
  consultationFeeInstant,
  type ConsultationFeeDraft,
  type ConsultationFeeSource,
} from './consultation-fee-form.js';
export const inactiveConsultationFeeSchema = z.custom<ConsultationFeeDraft>();
export function consultationFeeSchema(
  source: ConsultationFeeSource,
  timezone: string | null,
  messages: Record<keyof ConsultationFeeDraft, string>,
  now = Date.now()
) {
  return z.custom<ConsultationFeeDraft>().check((ctx) => {
    const draft = ctx.value;
    const issue = (field: keyof ConsultationFeeDraft) =>
      ctx.issues.push({
        code: 'custom',
        input: draft?.[field],
        path: [field],
        message: messages[field],
      });
    if (
      typeof draft?.fee !== 'string' ||
      !/^[1-9][0-9]{0,18}$/.test(draft.fee) ||
      BigInt(draft.fee) > 9223372036854775807n ||
      (source.status === 'offer_accepted' && draft.fee === source.fee)
    )
      issue('fee');
    const deadline =
      typeof draft?.validUntil === 'string' && timezone
        ? consultationFeeInstant(draft.validUntil, source, timezone)
        : undefined;
    if (!deadline || !Number.isFinite(deadline.getTime()) || deadline.getTime() <= now)
      issue('validUntil');
    if (source.status !== 'offer_accepted') {
      for (const field of ['scope', 'deliverables'] as const)
        if (
          typeof draft?.[field] !== 'string' ||
          !draft[field].trim() ||
          draft[field].trim().length > 4000
        )
          issue(field);
    }
    if (source.status === 'offer_accepted' || source.invoice_id)
      if (
        typeof draft?.reason !== 'string' ||
        !draft.reason.trim() ||
        draft.reason.trim().length > (source.status === 'offer_accepted' ? 1000 : 2000)
      )
        issue('reason');
  });
}
