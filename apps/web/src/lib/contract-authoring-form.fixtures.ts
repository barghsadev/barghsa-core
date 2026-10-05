import type { ContractDetailData, ContractVersion, ContractActivationData } from './contracts.js';
import type { ContractAuthoringEvidence, ContractDraftValues } from './contract-authoring-form.js';
export const CONTRACT = '11111111-1111-4111-8111-111111111111',
  PROFILE = '22222222-2222-4222-8222-222222222222',
  ORDER = '33333333-3333-4333-8333-333333333333',
  VERSION = '44444444-4444-4444-8444-444444444444',
  NEXT_VERSION = '55555555-5555-4555-8555-555555555555';
export const actor = 'builder';
export const version: ContractVersion & { contractId: string } = {
  id: VERSION,
  contractId: CONTRACT,
  versionNumber: 2,
  content: { title: ' Original ', text: 'Old terms', opaque: { policy: [false, 'keep'] } },
  changeDescription: 'Initial',
  createdBy: actor,
  createdAt: '2026-09-21T00:00:00.000Z',
  acceptedAt: null,
};
export const contract: ContractDetailData = {
  id: CONTRACT,
  contractNumber: '101',
  profileId: PROFILE,
  orderId: null,
  serviceType: 'solar',
  state: 'Draft',
  currentVersionId: VERSION,
  currentVersion: version,
  acceptedParty: null,
  amendmentSupported: true,
  pendingAmendment: null,
};
export const context: ContractActivationData = {
  contractId: CONTRACT,
  versionId: VERSION,
  state: 'Draft',
  isCurrent: true,
  ready: false,
  ruleRevision: 1,
  initialInvoiceId: null,
  serviceStartsAt: '2026-09-22T00:00:35.123Z',
  serviceEndsAt: '2026-10-22T00:00:00.000Z',
  evaluatedAt: '2026-09-21T00:00:00.000Z',
  checks: [
    { key: 'staffApproval', required: true, status: 'unmet' },
    { key: 'customerAcceptance', required: true, status: 'unmet' },
    { key: 'signature', required: false, status: 'not_required' },
    { key: 'initialPayment', required: false, status: 'not_required' },
    { key: 'serviceStart', required: false, status: 'not_required' },
  ],
};
export const values: ContractDraftValues = {
  profileId: PROFILE,
  orderId: '',
  serviceType: 'solar',
  title: 'New title',
  text: 'New terms',
  commercialValueKind: 'unstated',
  commercialValueAmountIrr: '',
  commercialValueDescription: '',
  changeDescription: 'Revision',
};
export function authoringReceipt(captured: ContractAuthoringEvidence): Record<string, unknown> {
  const base = captured.existing,
    amendment = captured.kind === 'amendment';
  return {
    id: base?.contract.id ?? CONTRACT,
    profileId: base?.contract.profileId ?? captured.body.profileId,
    orderId: base?.contract.orderId ?? captured.body.orderId ?? null,
    serviceType: base?.contract.serviceType ?? captured.body.serviceType,
    contractNumber: base?.contract.contractNumber ?? '101',
    state: amendment
      ? base!.contract.state
      : base?.contract.state === 'ChangesRequested'
        ? 'AwaitingStaffReview'
        : 'Draft',
    currentVersionId: amendment ? base!.version.id : NEXT_VERSION,
    createdAt: '2026-09-21T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    submittedAt: null,
    acceptedAt: null,
    signedAt: null,
    activatedAt: null,
    completedAt: null,
    cancelledAt: null,
    linkedOrderStatus: null,
    acceptedParty: base?.contract.acceptedParty ?? null,
    amendmentSupported: true,
    pendingAmendment: amendment
      ? {
          versionId: NEXT_VERSION,
          baseVersionId: base!.version.id,
          state: 'Draft',
          proposedBy: captured.actor,
          createdAt: '2026-10-05T00:00:00.000Z',
          publishedAt: null,
        }
      : null,
    currentVersion: amendment
      ? base!.version
      : {
          id: NEXT_VERSION,
          contractId: base?.contract.id ?? CONTRACT,
          versionNumber: base ? base.version.versionNumber + 1 : 1,
          content: captured.body.content,
          changeDescription: captured.body.changeDescription,
          createdBy: captured.actor,
          createdAt: '2026-10-05T00:00:00.000Z',
          acceptedAt: null,
        },
  };
}
