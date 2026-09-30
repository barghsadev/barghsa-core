import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';

const money = z.string().regex(/^(0|[1-9]\d*)$/);
const lineSchema = z
  .object({
    description: z.string().min(1).max(1000),
    quantity: z.number().int().positive(),
    unitPrice: money,
    vatRate: z.number().int().min(0).max(10_000),
    isTaxable: z.boolean(),
    lineTotal: money,
    vatAmount: money,
  })
  .strict();

const dataSchema = z
  .object({
    currency: z.literal('IRR'),
    profile: z
      .object({
        id: z.string().uuid(),
        title: z.string().min(1),
        profileType: z.enum(['INDIVIDUAL', 'LEGAL']),
      })
      .strict(),
    contractId: z.string().nullable(),
    lines: z.array(lineSchema).min(1).max(100),
    totals: z
      .object({ subtotal: money, vat: money, discount: z.literal('0'), total: money })
      .strict(),
    dueRule: z
      .object({
        source: z.enum(['config', 'fallback']),
        configDays: z.number().int().nonnegative(),
        periodId: z.string().uuid().nullable(),
        serviceType: z.literal('manual'),
      })
      .strict(),
    outcome: z.literal('issue_unpaid_invoice'),
  })
  .strict();

export type ManualInvoiceReviewData = z.infer<typeof dataSchema>;
export type ManualInvoiceReview = FinancialReviewSnapshot<ManualInvoiceReviewData>;

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('invoice.manual-issue'),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    data: dataSchema,
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine((review) => {
    const { lines, totals } = review.data;
    const subtotal = lines.reduce((sum, line) => sum + BigInt(line.lineTotal), 0n);
    const vat = lines.reduce((sum, line) => sum + BigInt(line.vatAmount), 0n);
    return (
      review.scope.profileId === review.data.profile.id &&
      lines.every((line) => {
        const calculated = BigInt(line.quantity) * BigInt(line.unitPrice);
        const tax = line.isTaxable ? (calculated * BigInt(line.vatRate) + 5000n) / 10_000n : 0n;
        return calculated === BigInt(line.lineTotal) && tax === BigInt(line.vatAmount);
      }) &&
      subtotal === BigInt(totals.subtotal) &&
      vat === BigInt(totals.vat) &&
      subtotal + vat === BigInt(totals.total) &&
      BigInt(totals.total) > 0n
    );
  });

export function parseManualInvoiceReview(value: unknown): ManualInvoiceReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
