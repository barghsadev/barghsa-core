import type { ContractFinancialReview } from '@barghsa/shared/finance';
import type { BusinessDocument } from '../lib/documents.js';
import type { ContractSignatureData } from '../lib/contracts.js';
import type { ContractSigningSource } from '../lib/contract-review-signature-form.js';
export const contractId = '11111111-1111-4111-8111-111111111111',
  versionId = '22222222-2222-4222-8222-222222222222',
  profileId = '33333333-3333-4333-8333-333333333333';
export const documentId = (number: number) =>
  `44444444-4444-4444-8444-${String(number).padStart(12, '0')}`;
export const requestId = documentId(90),
  actor = 'legal-reviewer',
  instant = '2026-09-21T00:00:00.000Z';
export function signingView(
  staff = false,
  extra: Partial<ContractSignatureData> = {}
): ContractSignatureData {
  return {
    contractId,
    versionId,
    state: 'AwaitingSignature',
    isCurrent: true,
    isAmendment: false,
    canRequest: staff,
    canRecord: true,
    request: {
      id: requestId,
      requestNumber: 2,
      originalDocumentId: documentId(1),
      originalName: 'original.pdf',
      documentState: 'Approved',
      requestedAt: instant,
      ...(staff ? { requestedBy: actor } : {}),
    },
    signature: null,
    ...extra,
  };
}
export function signingDocument(
  number = 2,
  role = 'signed',
  extra: Partial<BusinessDocument> = {}
): BusinessDocument {
  return {
    id: documentId(number),
    profileId,
    businessRecordType: 'contract',
    businessRecordId: contractId,
    contractVersionId: versionId,
    contractRole: role as BusinessDocument['contractRole'],
    state: 'Approved',
    category: 'contract',
    originalName: number === 1 ? 'original.pdf' : 'signed.pdf',
    detectedMime: 'application/pdf',
    sizeBytes: 100,
    checksum: String(number % 10).repeat(64),
    uploadedBy: actor,
    uploadedByType: 'staff',
    supersedesDocumentId: null,
    rejectionReason: null,
    reviewComment: null,
    revision: 1,
    createdAt: instant,
    updatedAt: instant,
    ...extra,
  };
}
const contractContent: ContractFinancialReview['data']['contract']['content'] = {
  title: 'Supply',
  terms: ['Signed terms'],
};
export function signingSource(
  extra: Partial<ContractSigningSource['contract']> = {}
): ContractSigningSource {
  const version = {
    id: versionId,
    contractId,
    versionNumber: 2,
    content: contractContent,
    changeDescription: 'Current terms',
    createdAt: instant,
    createdBy: actor,
    publishedAt: instant,
    acceptedAt: null,
  };
  return {
    contract: {
      id: contractId,
      profileId,
      serviceType: 'electricity',
      state: 'AwaitingSignature',
      currentVersionId: versionId,
      currentVersion: version,
      ...extra,
    },
    version,
  };
}
export function signingReview(
  view: ContractSignatureData,
  selected: BusinessDocument,
  request = false
): ContractFinancialReview {
  const original = signingDocument(1, 'original');
  const evidence = (doc: BusinessDocument) => ({
    id: doc.id,
    contractId,
    versionId,
    originalName: doc.originalName,
    checksum: doc.checksum!,
    state: 'Approved' as const,
  });
  return {
    schemaVersion: 1,
    scope: {
      action: request ? 'contract.signature-request' : 'contract.signature-record',
      profileId,
      resourceId: contractId,
    },
    hash: 'a'.repeat(64),
    data: {
      currency: 'IRR',
      profile: { id: profileId, title: 'Customer', type: 'LEGAL' },
      contract: {
        id: contractId,
        versionId,
        versionNumber: 2,
        serviceType: 'electricity',
        state: view.isAmendment
          ? 'AwaitingSignature'
          : (view.state as 'Accepted' | 'AwaitingSignature'),
        publishedAt: instant,
        content: contractContent,
        ...(view.isAmendment
          ? {
              amendment: {
                baseVersionId: documentId(98),
                effectiveState: view.state as 'Accepted' | 'Signed' | 'Active',
              },
            }
          : {}),
      },
      activation: {
        ruleRevision: 1,
        signatureRequired: true,
        paymentRequired: false,
        serviceStartRequired: false,
        serviceStartsAt: null,
        serviceEndsAt: null,
        initialInvoiceId: null,
      },
      initialInvoice: null,
      payment: { source: 'none', amount: '0' },
      cancellationRefund: 'full_wallet',
      signature: {
        requestId: view.request?.id ?? null,
        requestNumber: view.request?.requestNumber ?? null,
        originalDocument: evidence(request ? selected : original),
        signedDocument: request ? null : evidence(selected),
      },
    },
  };
}
export function signingReceipt(
  view: ContractSignatureData,
  selected: BusinessDocument,
  review: ContractFinancialReview,
  staff = false
) {
  const request = review.scope.action === 'contract.signature-request';
  return {
    ...view,
    state: request
      ? view.isAmendment
        ? view.state
        : 'AwaitingSignature'
      : view.isAmendment && view.state === 'Active'
        ? 'Active'
        : 'Signed',
    isCurrent: request ? view.isCurrent : true,
    isAmendment: request ? view.isAmendment : false,
    canRequest: request,
    canRecord: request,
    request: request
      ? {
          id: documentId(91),
          requestNumber: (view.request?.requestNumber ?? 0) + 1,
          originalDocumentId: selected.id,
          originalName: selected.originalName,
          documentState: 'Approved',
          requestedAt: instant,
          requestedBy: actor,
        }
      : view.request,
    signature: request
      ? null
      : {
          requestId: view.request!.id,
          signedDocumentId: selected.id,
          originalName: selected.originalName,
          documentState: 'Approved',
          recordedByType: staff ? 'staff' : 'customer',
          uploadedByType: selected.uploadedByType,
          recordedAt: instant,
          ...(staff ? { recordedBy: actor, uploadedBy: selected.uploadedBy } : {}),
        },
    financialReview: review,
  };
}
export function changesReceipt(source = signingSource({ state: 'AwaitingStaffReview' })) {
  return {
    ...source.contract,
    state: 'ChangesRequested',
    contractNumber: '1001',
    currentVersion: source.version,
    createdAt: instant,
    updatedAt: instant,
    submittedAt: instant,
    acceptedAt: null,
    signedAt: null,
    activatedAt: null,
    completedAt: null,
    cancelledAt: null,
    acceptedParty: null,
    pendingAmendment: null,
    amendmentSupported: true,
  };
}
