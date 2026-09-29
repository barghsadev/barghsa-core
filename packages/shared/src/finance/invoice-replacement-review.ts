import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';
import {
  financialReviewMoneySchema as money,
  invoiceFinancialDetailsSchema,
} from './wallet-payment-review.js';

const lineSchema = z
  .object({
    description: z.string().min(1).max(1000),
    quantity: z.number().int().positive(),
    unitPrice: money,
    vatRate: z.number().int().min(0).max(10_000),
    taxable: z.boolean(),
    subtotal: money,
    vatAmount: money,
  })
  .strict();

const dataSchema = invoiceFinancialDetailsSchema.extend({
  replacement: z
    .object({
      reason: z.string().min(1).max(1000),
      initiatorId: z.string().min(1),
      lines: z.array(lineSchema).min(1).max(100),
      totals: z.object({ subtotal: money, vat: money, total: money }).strict(),
      dueRule: z
        .object({
          source: z.enum(['config', 'staff_override', 'fallback']),
          configDays: z.number().int().nonnegative().nullable(),
          periodId: z.string().uuid().nullable(),
          serviceType: z.string().nullable(),
        })
        .strict(),
      outcome: z.literal('cancel_original_issue_replacement'),
    })
    .strict(),
});

export type InvoiceReplacementReviewData = z.infer<typeof dataSchema>;
export type InvoiceReplacementReview = FinancialReviewSnapshot<InvoiceReplacementReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('invoice.replacement.submit'),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: dataSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine((review) => {
    const { replacement } = review.data;
    const subtotal = replacement.lines.reduce((sum, line) => sum + BigInt(line.subtotal), 0n);
    const vat = replacement.lines.reduce((sum, line) => sum + BigInt(line.vatAmount), 0n);
    return (
      review.scope.profileId === review.data.profile.id &&
      review.scope.resourceId === review.data.invoice.id &&
      review.data.invoice.paidAmount === '0' &&
      replacement.lines.every((line) => {
        const lineSubtotal = BigInt(line.quantity) * BigInt(line.unitPrice);
        const lineVat = line.taxable ? (lineSubtotal * BigInt(line.vatRate) + 5000n) / 10_000n : 0n;
        return lineSubtotal === BigInt(line.subtotal) && lineVat === BigInt(line.vatAmount);
      }) &&
      subtotal === BigInt(replacement.totals.subtotal) &&
      vat === BigInt(replacement.totals.vat) &&
      subtotal + vat === BigInt(replacement.totals.total)
    );
  });

export function parseInvoiceReplacementReview(value: unknown): InvoiceReplacementReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
