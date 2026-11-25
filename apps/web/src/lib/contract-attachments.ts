import type { ContractDetailData, ContractVersion } from './contracts.js';

export type ContractAttachmentRole = 'original' | 'signed' | 'amendment';

export function isContractAttachmentRole(role: unknown): role is ContractAttachmentRole {
  return role === 'original' || role === 'signed' || role === 'amendment';
}

export function contractAttachmentRole(action: string | undefined): ContractAttachmentRole | null {
  switch (action) {
    case 'upload-original':
      return 'original';
    case 'upload-signed':
      return 'signed';
    case 'upload-amendment':
      return 'amendment';
    default:
      return null;
  }
}

export const contractAttachmentTitle = {
  original: 'uploadOriginal',
  signed: 'uploadSigned',
  amendment: 'uploadAmendment',
} satisfies Record<ContractAttachmentRole, string>;

export function contractVersionPosition(
  contract: ContractDetailData,
  versionId: string,
  staff: boolean
) {
  return {
    isCurrent: versionId === (contract.currentVersionId ?? contract.version?.id),
    isPendingAmendment: staff
      ? contract.pendingAmendment?.versionId === versionId
      : (contract.amendment?.state === 'AwaitingCustomerAcceptance' ||
          contract.amendment?.state === 'AwaitingSignature') &&
        contract.version?.id === versionId,
  };
}

export function contractAttachmentActions(
  contract: ContractDetailData,
  version: ContractVersion,
  staff: boolean
): { uploads: readonly ContractAttachmentRole[]; canGenerate: boolean } {
  const { isCurrent, isPendingAmendment } = contractVersionPosition(contract, version.id, staff);
  const awaitingSignature =
    (staff ? contract.pendingAmendment?.state : contract.amendment?.state) === 'AwaitingSignature';
  const canUpload =
    contract.state !== 'Rejected' &&
    (isPendingAmendment
      ? staff || awaitingSignature
      : isCurrent &&
        (staff
          ? !['Signed', 'Active', 'Completed', 'Cancelled'].includes(contract.state)
          : ['Accepted', 'AwaitingSignature'].includes(contract.state)));
  if (!canUpload) return { uploads: [], canGenerate: false };

  const template = version.content?.template;
  const hasSavedTemplate =
    template !== null &&
    typeof template === 'object' &&
    !Array.isArray(template) &&
    'name' in template &&
    typeof template.name === 'string' &&
    'text' in template &&
    typeof template.text === 'string' &&
    !!template.text.trim();
  const hasSystemOriginal =
    contract.serviceType === 'electricity' &&
    !!contract.orderId &&
    version.content?.orderId === contract.orderId &&
    !isPendingAmendment &&
    hasSavedTemplate;
  const canGenerate =
    staff &&
    contract.serviceType === 'electricity' &&
    (!contract.orderId || isPendingAmendment) &&
    hasSavedTemplate;

  if (isPendingAmendment && !awaitingSignature) return { uploads: ['amendment'], canGenerate };
  if (!staff) return { uploads: ['signed'], canGenerate };
  if (isPendingAmendment) return { uploads: ['amendment', 'signed'], canGenerate };
  return {
    uploads: hasSystemOriginal ? ['signed', 'amendment'] : ['original', 'signed', 'amendment'],
    canGenerate,
  };
}
