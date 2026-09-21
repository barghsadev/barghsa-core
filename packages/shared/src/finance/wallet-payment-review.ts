import type { FinancialReviewSnapshot } from './review-snapshot.js';
import { z } from 'zod';

export interface WalletPaymentReviewData {
  currency: 'IRR';
  profile: { id: string; title: string; type: string };
  invoice: {
    id: string;
    state: string;
    orderId: string | null;
    serviceType: string | null;
    issuedAt: string | null;
    payableFrom: string | null;
    dueAt: string | null;
    totalAmount: string;
    paidAmount: string;
    remainingAmount: string;
  };
  lines: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPrice: string;
    discount: string;
    subtotal: string;
    vatRate: number;
    vatAmount: string;
    taxable: boolean;
  }>;
  /** Legacy invoices may lack a line breakdown; do not invent zero VAT or discounts. */
  totals: { subtotal: string; discount: string; vat: string } | null;
  payment: { source: 'wallet'; availableBefore: string; availableAfter: string };
  contracts: Array<{
    id: string;
    versionId: string;
    state: string;
    serviceType: string;
    ruleRevision: number;
    signatureRequired: boolean;
    paymentRequired: boolean;
    initialInvoice: boolean;
    serviceStartRequired: boolean;
    serviceStartsAt: string | null;
    serviceEndsAt: string | null;
    cancellationRefund: 'full_wallet' | 'staff_decision';
  }>;
  /** Payment itself neither cancels a service nor guarantees a refund. */
  cancellation: 'separate_review_required';
}

export type WalletPaymentReview = FinancialReviewSnapshot<WalletPaymentReviewData>;

const money = z
  .string()
  .regex(/^(0|[1-9]\d{0,18})$/)
  .pipe(z.string().refine((v) => BigInt(v) <= 9_223_372_036_854_775_807n));
const balance = z.string().regex(/^-?(0|[1-9]\d{0,19})$/);
const date = z.string().datetime().nullable();
const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.literal('invoice.wallet-payment'),
        profileId: z.string().uuid(),
        resourceId: z.string().uuid(),
      })
      .strict(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    data: z
      .object({
        currency: z.literal('IRR'),
        profile: z.object({ id: z.string().uuid(), title: z.string(), type: z.string() }).strict(),
        invoice: z
          .object({
            id: z.string().uuid(),
            state: z.string(),
            orderId: z.string().uuid().nullable(),
            serviceType: z.string().nullable(),
            issuedAt: date,
            payableFrom: date,
            dueAt: date,
            totalAmount: money,
            paidAmount: money,
            remainingAmount: money,
          })
          .strict(),
        lines: z.array(
          z
            .object({
              id: z.string().uuid(),
              description: z.string(),
              quantity: z.number().int().positive(),
              unitPrice: money,
              discount: money,
              subtotal: money,
              vatRate: z.number().int().min(0).max(10_000),
              vatAmount: money,
              taxable: z.boolean(),
            })
            .strict()
        ),
        totals: z.object({ subtotal: money, discount: money, vat: money }).strict().nullable(),
        payment: z
          .object({
            source: z.literal('wallet'),
            availableBefore: balance,
            availableAfter: balance,
          })
          .strict(),
        contracts: z.array(
          z
            .object({
              id: z.string().uuid(),
              versionId: z.string().uuid(),
              state: z.string(),
              serviceType: z.string(),
              ruleRevision: z.number().int().positive(),
              signatureRequired: z.boolean(),
              paymentRequired: z.boolean(),
              initialInvoice: z.boolean(),
              serviceStartRequired: z.boolean(),
              serviceStartsAt: date,
              serviceEndsAt: date,
              cancellationRefund: z.enum(['full_wallet', 'staff_decision']),
            })
            .strict()
        ),
        cancellation: z.literal('separate_review_required'),
      })
      .strict(),
  })
  .strict()
  .refine(
    (s) => s.scope.profileId === s.data.profile.id && s.scope.resourceId === s.data.invoice.id
  );

export function parseWalletPaymentReview(value: unknown): WalletPaymentReview | null {
  const parsed = snapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
