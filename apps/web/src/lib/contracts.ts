export const contractStates = [
  'Draft',
  'AwaitingStaffReview',
  'ChangesRequested',
  'AwaitingCustomerAcceptance',
  'Accepted',
  'AwaitingSignature',
  'Signed',
  'Active',
  'Completed',
  'Cancelled',
] as const;
export interface ContractVersion {
  id: string;
  versionNumber: number;
  content?: Record<string, unknown>;
  changeDescription: string;
  createdAt: string;
  createdBy?: string;
  publishedAt?: string;
  acceptedAt: string | null;
}
export interface ContractSummary {
  id: string;
  profileId?: string;
  serviceType: 'electricity' | 'savings' | 'solar';
  state: (typeof contractStates)[number];
  versionId: string;
  versionNumber: number;
  changeDescription?: string;
}
export interface ContractDetailData extends Omit<ContractSummary, 'versionId' | 'versionNumber'> {
  profileId: string;
  currentVersionId?: string;
  currentVersion?: ContractVersion;
  version?: ContractVersion;
  canAccept?: boolean;
}
export const contractBase = (staff: boolean) => (staff ? '/api/admin/contracts' : '/api/contracts');

export interface ContractSignatureData {
  contractId: string;
  versionId: string;
  state: string;
  isCurrent: boolean;
  canRequest: boolean;
  canRecord: boolean;
  request: {
    id: string;
    requestNumber: number;
    originalDocumentId: string;
    originalName: string;
    documentState: string;
    requestedAt: string;
    requestedBy?: string;
  } | null;
  signature: {
    requestId: string;
    signedDocumentId: string;
    originalName: string;
    documentState: string;
    recordedByType: 'customer' | 'staff';
    uploadedByType: 'customer' | 'staff' | 'system';
    recordedAt: string;
    recordedBy?: string;
    uploadedBy?: string;
  } | null;
}
