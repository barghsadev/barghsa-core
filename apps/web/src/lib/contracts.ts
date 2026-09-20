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
