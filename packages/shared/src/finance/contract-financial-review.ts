import { z } from 'zod';
import type { FinancialReviewSnapshot } from './review-snapshot.js';
import { invoiceFinancialDetailsSchema } from './wallet-payment-review.js';

const uuid = z.string().uuid();
const documentSchema = z
  .object({
    id: uuid,
    contractId: uuid,
    versionId: uuid,
    originalName: z.string(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.literal('Approved'),
  })
  .strict();
const dataSchema = z
  .object({
    currency: z.literal('IRR'),
    profile: invoiceFinancialDetailsSchema.shape.profile,
    contract: z
      .object({
        id: uuid,
        versionId: uuid,
        versionNumber: z.number().int().positive(),
        serviceType: z.enum(['electricity', 'savings', 'solar']),
        state: z.enum(['AwaitingCustomerAcceptance', 'Accepted', 'AwaitingSignature']),
        amendment: z
          .object({
            baseVersionId: uuid,
            effectiveState: z.enum(['Accepted', 'Signed', 'Active']),
          })
          .strict()
          .optional(),
        publishedAt: z.string().datetime(),
        content: z.record(z.string(), z.json()),
      })
      .strict(),
    activation: z
      .object({
        ruleRevision: z.number().int().nonnegative(),
        signatureRequired: z.boolean(),
        paymentRequired: z.boolean(),
        serviceStartRequired: z.boolean(),
        serviceStartsAt: z.string().datetime().nullable(),
        serviceEndsAt: z.string().datetime().nullable(),
        initialInvoiceId: uuid.nullable(),
      })
      .strict(),
    initialInvoice: invoiceFinancialDetailsSchema.nullable(),
    payment: z.object({ source: z.literal('none'), amount: z.literal('0') }).strict(),
    cancellationRefund: z.enum(['full_wallet', 'staff_decision']),
    signature: z
      .object({
        requestId: uuid.nullable(),
        requestNumber: z.number().int().positive().nullable(),
        originalDocument: documentSchema,
        signedDocument: documentSchema.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type ContractFinancialReviewData = z.infer<typeof dataSchema>;
export type ContractFinancialReview = FinancialReviewSnapshot<ContractFinancialReviewData>;
export type ContractFinancialReviewAction =
  'contract.acceptance' | 'contract.signature-request' | 'contract.signature-record';

const schema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z
      .object({
        action: z.enum([
          'contract.acceptance',
          'contract.signature-request',
          'contract.signature-record',
        ]),
        profileId: uuid,
        resourceId: uuid,
      })
      .strict(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    data: dataSchema,
  })
  .strict()
  .refine(({ scope, data }) => {
    if (scope.profileId !== data.profile.id || scope.resourceId !== data.contract.id) return false;
    if ((data.initialInvoice?.invoice.id ?? null) !== data.activation.initialInvoiceId)
      return false;
    if (data.initialInvoice && data.initialInvoice.profile.id !== data.profile.id) return false;
    if (
      data.cancellationRefund !==
      (data.contract.serviceType === 'electricity' ? 'full_wallet' : 'staff_decision')
    )
      return false;
    const signature = data.signature;
    if (data.contract.amendment) {
      if (
        data.contract.amendment.baseVersionId === data.contract.versionId ||
        (scope.action === 'contract.acceptance'
          ? data.contract.state !== 'AwaitingCustomerAcceptance'
          : data.contract.state !== 'AwaitingSignature')
      )
        return false;
    }
    if (scope.action === 'contract.acceptance')
      return data.contract.state === 'AwaitingCustomerAcceptance' && signature === null;
    if (!signature || (signature.requestId === null) !== (signature.requestNumber === null))
      return false;
    for (const document of [signature.originalDocument, signature.signedDocument]) {
      if (
        document &&
        (document.contractId !== data.contract.id || document.versionId !== data.contract.versionId)
      )
        return false;
    }
    if (scope.action === 'contract.signature-request')
      return (
        ['Accepted', 'AwaitingSignature'].includes(data.contract.state) &&
        signature.signedDocument === null
      );
    return (
      data.contract.state === 'AwaitingSignature' &&
      signature.requestId !== null &&
      signature.signedDocument !== null &&
      signature.originalDocument.id !== signature.signedDocument.id
    );
  });

/** Treat malformed or foreign financial reviews as unavailable, never as consent. */
export function parseContractFinancialReview(value: unknown): ContractFinancialReview | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
