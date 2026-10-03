import { z } from 'zod/mini';
import type { $ZodType } from 'zod/v4/core';
import type {
  CancellationValues,
  CancellationRequestValues,
} from '../hooks/useCancellationForm.js';
import { validCancellationAmount, type CancellationPreview } from './contract-cancellation.js';
const reasonValid = (value: string) => value.trim().length > 0 && value.trim().length <= 1000;
export function cancellationRequestSchema(
  reason: string,
  destination: string
): $ZodType<CancellationRequestValues, CancellationRequestValues> {
  return z.object({
    reason: z.string().check(z.refine(reasonValid, reason)),
    preferredDestination: z.enum(['wallet', 'external_bank'], { error: destination }),
  });
}
export function cancellationDecisionSchema(
  preview: CancellationPreview | null,
  reason: string,
  amount: string,
  destination: string
): $ZodType<CancellationValues, CancellationValues> {
  return z
    .object({
      reason: z.string().check(z.refine(reasonValid, reason)),
      custom: z.boolean(),
      lines: z.record(
        z.string(),
        z.object({
          amount: z.string(),
          destination: z.enum(['wallet', 'external_bank'], { error: destination }),
        })
      ),
    })
    .check(
      z.superRefine((values, context) => {
        if (!values.custom || !preview) return;
        for (const invoice of preview.invoices) {
          if (
            !values.lines[invoice.id] ||
            !validCancellationAmount(
              values.lines[invoice.id]!.amount,
              invoice.availableRefundAmount
            )
          )
            context.addIssue({
              code: 'custom',
              path: ['lines', invoice.id, 'amount'],
              message: amount,
            });
        }
      })
    );
}
