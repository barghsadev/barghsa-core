import { describe, expect, it } from 'vitest';
import {
  parseContractFinancialReview,
  type ContractFinancialReview,
} from './contract-financial-review.js';

const contractId = '11111111-1111-7111-8111-111111111111';
const versionId = '22222222-2222-7222-8222-222222222222';
const profileId = '33333333-3333-7333-8333-333333333333';
const originalId = '44444444-4444-7444-8444-444444444444';
const signedId = '55555555-5555-7555-8555-555555555555';
function review(): ContractFinancialReview {
  return {
    schemaVersion: 1,
    scope: { action: 'contract.acceptance', profileId, resourceId: contractId },
    hash: 'a'.repeat(64),
    data: {
      currency: 'IRR',
      profile: { id: profileId, title: 'Customer', type: 'LEGAL' },
      contract: {
        id: contractId,
        versionId,
        versionNumber: 2,
        serviceType: 'electricity',
        state: 'AwaitingCustomerAcceptance',
        publishedAt: '2026-09-21T09:00:00.000Z',
        content: { title: 'Electricity supply', terms: ['Published terms'] },
      },
      activation: {
        ruleRevision: 3,
        signatureRequired: true,
        paymentRequired: true,
        serviceStartRequired: true,
        serviceStartsAt: '2026-10-01T00:00:00.000Z',
        serviceEndsAt: null,
        initialInvoiceId: null,
      },
      initialInvoice: null,
      payment: { source: 'none', amount: '0' },
      cancellationRefund: 'full_wallet',
      signature: null,
    },
  };
}
function signing(record = false): ContractFinancialReview {
  const value = review();
  value.scope.action = record ? 'contract.signature-record' : 'contract.signature-request';
  value.data.contract.state = record ? 'AwaitingSignature' : 'Accepted';
  const document = {
    id: originalId,
    contractId,
    versionId,
    originalName: 'contract.pdf',
    checksum: 'b'.repeat(64),
    state: 'Approved' as const,
  };
  value.data.signature = {
    requestId: record ? originalId : null,
    requestNumber: record ? 1 : null,
    originalDocument: document,
    signedDocument: record
      ? { ...document, id: signedId, checksum: 'c'.repeat(64), originalName: 'signed.pdf' }
      : null,
  };
  return value;
}

describe('contract financial review boundary', () => {
  it('preserves published terms and discloses an unassigned required invoice without implying payment', () => {
    expect(parseContractFinancialReview(review())).toEqual(review());
  });
  it('binds both original and signed copies to their exact version and checksums', () => {
    for (const value of [signing(), signing(true)])
      expect(parseContractFinancialReview(value)).toEqual(value);
  });
  it('preserves exact initial invoice amounts beyond Number precision', () => {
    const value = review();
    value.data.activation.initialInvoiceId = originalId;
    value.data.initialInvoice = {
      currency: 'IRR',
      profile: value.data.profile,
      invoice: {
        id: originalId,
        state: 'Unpaid',
        orderId: null,
        serviceType: 'electricity',
        issuedAt: null,
        payableFrom: null,
        dueAt: null,
        totalAmount: '9007199254740993',
        paidAmount: '0',
        remainingAmount: '9007199254740993',
      },
      lines: [],
      totals: null,
      contracts: [],
      cancellation: 'separate_review_required',
    };
    expect(parseContractFinancialReview(value)?.data.initialInvoice?.invoice.totalAmount).toBe(
      '9007199254740993'
    );
    value.data.initialInvoice.profile = { ...value.data.profile, id: signedId };
    expect(parseContractFinancialReview(value)).toBeNull();
  });
  it.each(['owner', 'contract', 'invoice', 'refund', 'state', 'action'] as const)(
    'refuses changed %s bindings',
    (change) => {
      const value = review();
      if (change === 'owner') value.scope.profileId = signedId;
      if (change === 'contract') value.scope.resourceId = signedId;
      if (change === 'invoice') value.data.activation.initialInvoiceId = signedId;
      if (change === 'refund') value.data.cancellationRefund = 'staff_decision';
      if (change === 'state') value.data.contract.state = 'Accepted';
      if (change === 'action') value.scope.action = 'contract.signature-record';
      expect(parseContractFinancialReview(value)).toBeNull();
    }
  );
  it.each(['version', 'contract', 'original', 'missing', 'number'] as const)(
    'rejects invalid signing evidence: %s',
    (change) => {
      const value = signing(true),
        signature = value.data.signature!;
      if (change === 'version') signature.signedDocument!.versionId = signedId;
      if (change === 'contract') signature.originalDocument.contractId = signedId;
      if (change === 'original') signature.signedDocument!.id = originalId;
      if (change === 'missing') signature.signedDocument = null;
      if (change === 'number') signature.requestNumber = null;
      expect(parseContractFinancialReview(value)).toBeNull();
    }
  );
  it('rejects hidden extra fields and money movements on acceptance', () => {
    const value = review();
    expect(parseContractFinancialReview({ ...value, staffOnly: true })).toBeNull();
    expect(
      parseContractFinancialReview({
        ...value,
        data: { ...value.data, payment: { source: 'wallet', amount: '100' } },
      })
    ).toBeNull();
  });
});
