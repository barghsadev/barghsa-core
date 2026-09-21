import { expect, it } from 'vitest';
import {
  readContractFinancialReview,
  type ContractFinancialReviewInput,
} from './contract-financial-review.js';
import type { WalletQueryClient } from '../wallet/wallet.service.js';
const contractId = '11111111-1111-7111-8111-111111111111';
const versionId = '22222222-2222-7222-8222-222222222222';
const profileId = '33333333-3333-7333-8333-333333333333';
const originalDocumentId = '44444444-4444-7444-8444-444444444444';
const signedDocumentId = '55555555-5555-7555-8555-555555555555';
const requestId = '66666666-6666-7666-8666-666666666666';
const base = { contractId, versionId, profileId };
function client(
  options: {
    state?: string;
    rule?: number;
    checksum?: string;
    missingContract?: boolean;
    missingDocument?: boolean;
    request?: boolean;
  } = {}
) {
  return {
    query: async (sql: string, values: unknown[]) => {
      if (sql.includes('FROM contracts c JOIN profiles'))
        return {
          rows: options.missingContract
            ? []
            : [
                {
                  id: contractId,
                  profile_id: profileId,
                  profile_type: 'LEGAL',
                  profile_title: 'Customer',
                  service_type: 'electricity',
                  state: options.state ?? 'AwaitingCustomerAcceptance',
                  version_id: versionId,
                  version_number: 1,
                  content: { title: 'Published terms' },
                  published_at: new Date('2026-09-21T10:00:00Z'),
                  rule_revision: options.rule ?? 2,
                  signature_required: true,
                  payment_required: false,
                  service_start_required: false,
                  service_starts_at: null,
                  service_ends_at: null,
                  initial_invoice_id: null,
                },
              ],
        };
      if (sql.includes('FROM contract_signature_requests'))
        return {
          rows: options.request
            ? [{ id: requestId, request_number: 2, original_document_id: originalDocumentId }]
            : [],
        };
      if (sql.includes('FROM documents'))
        return {
          rows: options.missingDocument
            ? []
            : [
                {
                  id: values[0],
                  original_name: 'contract.pdf',
                  checksum: options.checksum ?? 'b'.repeat(64),
                  contract_id: contractId,
                  contract_version_id: versionId,
                },
              ],
        };
      throw new Error(`Unexpected review query: ${sql}`);
    },
  } as unknown as WalletQueryClient;
}
it('reviews published content and frozen rules without taking a payment', async () => {
  const input: ContractFinancialReviewInput = { ...base, action: 'contract.acceptance' };
  const review = await readContractFinancialReview(client(), input);
  expect(review.scope).toEqual({ action: input.action, profileId, resourceId: contractId });
  expect(review.data.contract.content).toEqual({ title: 'Published terms' });
  expect(review.data.payment).toEqual({ source: 'none', amount: '0' });
  expect((await readContractFinancialReview(client({ rule: 3 }), input)).hash).not.toBe(
    review.hash
  );
});
it('binds selected original evidence and the previous request when preparing a new request', async () => {
  const input: ContractFinancialReviewInput = {
    ...base,
    action: 'contract.signature-request',
    originalDocumentId,
    expectedRequestId: null,
  };
  const review = await readContractFinancialReview(client({ state: 'Accepted' }), input);
  expect(review.data.signature?.originalDocument.id).toBe(originalDocumentId);
  expect(
    (
      await readContractFinancialReview(
        client({ state: 'Accepted', checksum: 'c'.repeat(64) }),
        input
      )
    ).hash
  ).not.toBe(review.hash);
  await expect(
    readContractFinancialReview(client({ state: 'AwaitingSignature', request: true }), input)
  ).rejects.toMatchObject({ status: 409 });
});
it('binds both copies and refuses a replaced signing request', async () => {
  const input: ContractFinancialReviewInput = {
    ...base,
    action: 'contract.signature-record',
    signedDocumentId,
    requestId,
  };
  const review = await readContractFinancialReview(
    client({ state: 'AwaitingSignature', request: true }),
    input
  );
  expect(review.data.signature).toMatchObject({
    requestId,
    requestNumber: 2,
    originalDocument: { id: originalDocumentId },
    signedDocument: { id: signedDocumentId },
  });
  await expect(
    readContractFinancialReview(client({ state: 'AwaitingSignature' }), input)
  ).rejects.toMatchObject({ status: 409 });
});
it('refuses missing or unpublished versions, missing approved documents, and invalid states', async () => {
  await expect(
    readContractFinancialReview(client({ missingContract: true }), {
      ...base,
      action: 'contract.acceptance',
    })
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    readContractFinancialReview(client({ state: 'Accepted' }), {
      ...base,
      action: 'contract.acceptance',
    })
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    readContractFinancialReview(client({ state: 'Accepted', missingDocument: true }), {
      ...base,
      action: 'contract.signature-request',
      originalDocumentId,
      expectedRequestId: null,
    })
  ).rejects.toMatchObject({ status: 409 });
});
