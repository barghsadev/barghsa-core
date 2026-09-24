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
export type ContractCommercialValue =
  { kind: 'fixed'; amountIrr: string } | { kind: 'variable'; description: string };
export function parseContractCommercialValue(value: unknown): ContractCommercialValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.kind === 'fixed' &&
    Object.keys(row).length === 2 &&
    typeof row.amountIrr === 'string' &&
    /^(0|[1-9][0-9]{0,18})$/.test(row.amountIrr) &&
    BigInt(row.amountIrr) <= 9_223_372_036_854_775_807n
  )
    return { kind: 'fixed', amountIrr: row.amountIrr };
  if (
    row.kind === 'variable' &&
    Object.keys(row).length === 2 &&
    typeof row.description === 'string' &&
    row.description.trim() &&
    row.description.trim().length <= 500
  )
    return { kind: 'variable', description: row.description.trim() };
  return null;
}
export interface ContractSummary {
  id: string;
  profileId?: string;
  profileType?: 'INDIVIDUAL' | 'LEGAL';
  profileTitle?: string | null;
  orderId?: string | null;
  savingOrderId?: string | null;
  serviceType: 'electricity' | 'savings' | 'solar';
  state: (typeof contractStates)[number];
  versionId: string;
  versionNumber: number;
  commercialValue?: ContractCommercialValue | null;
  changeDescription?: string;
  publishedAt?: string;
  acceptedAt?: string | null;
  serviceStartsAt?: string | null;
  serviceEndsAt?: string | null;
  initialInvoiceId?: string | null;
  initialInvoiceAmount?: string | null;
  initialInvoiceState?: string | null;
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

export interface ContractActivationData {
  contractId: string;
  versionId: string;
  state: string;
  isCurrent: boolean;
  ready: boolean;
  ruleRevision: number;
  initialInvoiceId: string | null;
  serviceStartsAt: string | null;
  serviceEndsAt: string | null;
  evaluatedAt: string;
  checks: Array<{
    key: 'staffApproval' | 'customerAcceptance' | 'signature' | 'initialPayment' | 'serviceStart';
    required: boolean;
    status: 'met' | 'unmet' | 'not_required';
  }>;
}
export interface ContractActivationRule {
  serviceType: 'electricity' | 'savings' | 'solar';
  signatureRequired: boolean;
  paymentRequired: boolean;
  serviceStartRequired: boolean;
  revision: number;
  updatedAt: string;
}
