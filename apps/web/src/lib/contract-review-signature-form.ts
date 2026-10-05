import type { ContractFinancialReview } from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  contractStates,
  type ContractDetailData,
  type ContractSignatureData,
  type ContractVersion,
} from './contracts.js';
import { documentStates, type BusinessDocument, type DocumentPage } from './documents.js';
export interface ContractFormCoordination {
  blocked: () => boolean;
  acquire: (owner: object) => boolean;
  release: (owner: object) => void;
  revision?: () => number;
}
export interface ContractSigningSource {
  contract: ContractDetailData;
  version: ContractVersion;
}
export type SignatureRequestDraft = { originalDocumentId: string };
export type SignatureRecordDraft = { signedDocumentId: string; acknowledged: boolean };
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const actor = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
const instant = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function sameContractEvidence(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameContractEvidence(item, b[index]))
    );
  return (
    record(a) &&
    record(b) &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(b).every(
      ([key, value]) => Object.hasOwn(a, key) && sameContractEvidence(a[key], value)
    )
  );
}
export function contractSignatureView(
  value: unknown,
  staff: boolean
): ContractSignatureData | null {
  if (
    !record(value) ||
    !uuid(value.contractId) ||
    !uuid(value.versionId) ||
    !contractStates.some((state) => state === value.state) ||
    !['isCurrent', 'isAmendment', 'canRequest', 'canRecord'].every(
      (key) => typeof value[key] === 'boolean'
    ) ||
    (!staff && value.canRequest)
  )
    return null;
  const request = value.request;
  if (
    request !== null &&
    (!record(request) ||
      !uuid(request.id) ||
      !Number.isSafeInteger(request.requestNumber) ||
      Number(request.requestNumber) < 1 ||
      !uuid(request.originalDocumentId) ||
      typeof request.originalName !== 'string' ||
      !documentStates.some((state) => state === request.documentState) ||
      !instant(request.requestedAt) ||
      (staff
        ? !actor(request.requestedBy) || Object.keys(request).length !== 7
        : Object.hasOwn(request, 'requestedBy') || Object.keys(request).length !== 6))
  )
    return null;
  const signature = value.signature;
  if (
    signature !== null &&
    (!record(signature) ||
      !request ||
      !uuid(signature.requestId) ||
      signature.requestId !== request.id ||
      !uuid(signature.signedDocumentId) ||
      signature.signedDocumentId === request.originalDocumentId ||
      typeof signature.originalName !== 'string' ||
      !documentStates.some((state) => state === signature.documentState) ||
      !['staff', 'customer'].some((role) => role === signature.recordedByType) ||
      !['staff', 'customer', 'system'].some((role) => role === signature.uploadedByType) ||
      !instant(signature.recordedAt) ||
      (staff
        ? !actor(signature.recordedBy) ||
          !actor(signature.uploadedBy) ||
          Object.keys(signature).length !== 9
        : Object.hasOwn(signature, 'recordedBy') ||
          Object.hasOwn(signature, 'uploadedBy') ||
          Object.keys(signature).length !== 7))
  )
    return null;
  if (value.canRecord && (!request || signature || request.documentState !== 'Approved'))
    return null;
  return value as unknown as ContractSignatureData;
}
export function signatureDocumentPage(
  value: unknown,
  profileId: string,
  id: string,
  versionId: string
): DocumentPage | null {
  if (
    !record(value) ||
    !Array.isArray(value.documents) ||
    !(value.nextBefore === null || (typeof value.nextBefore === 'string' && !!value.nextBefore))
  )
    return null;
  if (
    !value.documents.every(
      (item) =>
        record(item) &&
        uuid(item.id) &&
        uuid(item.profileId) &&
        item.businessRecordType === 'contract' &&
        uuid(item.businessRecordId) &&
        uuid(item.contractVersionId) &&
        documentStates.some((state) => state === item.state) &&
        ['original', 'amendment', 'signed', 'superseded'].some(
          (role) => role === item.contractRole
        ) &&
        typeof item.originalName === 'string' &&
        (item.detectedMime === null || typeof item.detectedMime === 'string') &&
        (item.checksum === null || hash(item.checksum)) &&
        actor(item.uploadedBy) &&
        ['staff', 'customer', 'system'].some((role) => role === item.uploadedByType)
    ) ||
    new Set(value.documents.map((item) => item.id)).size !== value.documents.length
  )
    return null;
  const page = value as unknown as DocumentPage;
  return {
    documents: page.documents.filter(
      (item) =>
        item.profileId === profileId &&
        item.businessRecordId === id &&
        item.contractVersionId === versionId
    ),
    nextBefore: page.nextBefore,
  };
}
export function signingDocuments(
  documents: BusinessDocument[],
  view: ContractSignatureData,
  profileId: string,
  request: boolean
) {
  return documents.filter(
    (item) =>
      item.profileId === profileId &&
      item.businessRecordType === 'contract' &&
      item.businessRecordId === view.contractId &&
      item.contractVersionId === view.versionId &&
      item.state === 'Approved' &&
      hash(item.checksum) &&
      item.contractRole === (request ? (view.isAmendment ? 'amendment' : 'original') : 'signed') &&
      (!request || item.detectedMime === 'application/pdf')
  );
}
export async function matchedSignatureReview(
  value: unknown,
  view: ContractSignatureData,
  profileId: string,
  selected: BusinessDocument,
  request: boolean,
  source?: ContractSigningSource,
  documents?: BusinessDocument[]
) {
  const { parseContractFinancialReview } = await import('@barghsa/shared/finance');
  const review = parseContractFinancialReview(value),
    action = request ? 'contract.signature-request' : 'contract.signature-record';
  const signature = review?.data.signature;
  if (
    !review ||
    !signature ||
    review.scope.action !== action ||
    review.scope.profileId !== profileId ||
    review.scope.resourceId !== view.contractId ||
    review.data.contract.versionId !== view.versionId ||
    signature.requestId !== (view.request?.id ?? null) ||
    signature.requestNumber !== (view.request?.requestNumber ?? null) ||
    !!review.data.contract.amendment !== !!view.isAmendment
  )
    return null;
  const document = request ? signature.originalDocument : signature.signedDocument;
  if (
    !document ||
    document.id !== selected.id ||
    document.originalName !== selected.originalName ||
    document.checksum !== selected.checksum ||
    document.state !== selected.state ||
    document.contractId !== selected.businessRecordId ||
    document.versionId !== selected.contractVersionId
  )
    return null;
  if (
    !request &&
    (!view.request ||
      signature.originalDocument.id !== view.request.originalDocumentId ||
      signature.originalDocument.originalName !== view.request.originalName ||
      signature.originalDocument.state !== view.request.documentState)
  )
    return null;
  const original = documents?.find((item) => item.id === view.request?.originalDocumentId);
  if (
    !request &&
    original &&
    (!signingDocuments([original], view, profileId, true).length ||
      signature.originalDocument.checksum !== original.checksum ||
      signature.originalDocument.originalName !== original.originalName)
  )
    return null;
  if (review.data.contract.state !== (view.isAmendment ? 'AwaitingSignature' : view.state))
    return null;
  if (view.isAmendment && review.data.contract.amendment?.effectiveState !== view.state)
    return null;
  if (
    source &&
    (source.contract.id !== view.contractId ||
      source.contract.profileId !== profileId ||
      source.version.id !== view.versionId ||
      review.data.contract.versionNumber !== source.version.versionNumber ||
      review.data.contract.serviceType !== source.contract.serviceType ||
      !sameContractEvidence(review.data.contract.content, source.version.content) ||
      (source.version.publishedAt &&
        review.data.contract.publishedAt !== source.version.publishedAt) ||
      (source.contract.initialInvoiceId !== undefined &&
        review.data.activation.initialInvoiceId !== source.contract.initialInvoiceId) ||
      (source.contract.serviceStartsAt !== undefined &&
        review.data.activation.serviceStartsAt !== source.contract.serviceStartsAt) ||
      (source.contract.serviceEndsAt !== undefined &&
        review.data.activation.serviceEndsAt !== source.contract.serviceEndsAt) ||
      (source.contract.pendingAmendment &&
        review.data.contract.amendment?.baseVersionId !==
          source.contract.pendingAmendment.baseVersionId) ||
      (source.contract.amendment &&
        review.data.contract.amendment?.baseVersionId !== source.contract.amendment.baseVersionId))
  )
    return null;
  return review;
}
export async function matchedSignatureReceipt(
  value: unknown,
  expected: ContractFinancialReview,
  before: ContractSignatureData,
  selected: BusinessDocument,
  staff: boolean,
  currentActor: string
) {
  const { parseContractFinancialReview } = await import('@barghsa/shared/finance');
  if (
    !record(value) ||
    Object.keys(value).length !== 10 ||
    !sameContractEvidence(parseContractFinancialReview(value.financialReview), expected)
  )
    return null;
  const view = contractSignatureView(value, staff),
    request = expected.scope.action === 'contract.signature-request';
  if (!view || view.contractId !== before.contractId || view.versionId !== before.versionId)
    return null;
  if (request) {
    if (
      !staff ||
      !view.request ||
      view.request.id === before.request?.id ||
      view.request.requestNumber !== (before.request?.requestNumber ?? 0) + 1 ||
      view.request.originalDocumentId !== selected.id ||
      view.request.originalName !== selected.originalName ||
      view.request.documentState !== 'Approved' ||
      view.request.requestedBy !== currentActor ||
      view.signature !== null ||
      view.isCurrent !== before.isCurrent ||
      !!view.isAmendment !== !!before.isAmendment ||
      view.state !== (before.isAmendment ? before.state : 'AwaitingSignature') ||
      !view.canRequest ||
      !view.canRecord
    )
      return null;
  } else {
    if (
      !view.request ||
      !sameContractEvidence(view.request, before.request) ||
      !view.signature ||
      view.signature.requestId !== before.request?.id ||
      view.signature.signedDocumentId !== selected.id ||
      view.signature.originalName !== selected.originalName ||
      view.signature.documentState !== 'Approved' ||
      view.signature.recordedByType !== (staff ? 'staff' : 'customer') ||
      view.signature.uploadedByType !== selected.uploadedByType ||
      (staff &&
        (view.signature.recordedBy !== currentActor ||
          view.signature.uploadedBy !== selected.uploadedBy)) ||
      !view.isCurrent ||
      view.isAmendment ||
      view.canRequest ||
      view.canRecord ||
      view.state !== (before.isAmendment && before.state === 'Active' ? 'Active' : 'Signed')
    )
      return null;
  }
  return view;
}

export function contractFormRejection(value: unknown) {
  if (
    !record(value) ||
    !record(value.error) ||
    typeof value.error.message !== 'string' ||
    !uuid(value.error.correlationId)
  )
    return null;
  const error = value.error;
  return [
    ErrorCodes.VALIDATION_INPUT_INVALID.code,
    'VALIDATION:PARSE:ZOD_ERROR',
    ErrorCodes.CONFLICT_STATE.code,
    ErrorCodes.CONFLICT_VERSION.code,
    ErrorCodes.NOT_FOUND_RESOURCE.code,
  ].some((code) => code === error.code)
    ? error
    : null;
}
export function matchedChangesReceipt(value: unknown, source: ContractSigningSource) {
  if (
    !record(value) ||
    value.id !== source.contract.id ||
    value.profileId !== source.contract.profileId ||
    value.serviceType !== source.contract.serviceType ||
    (source.contract.contractNumber !== undefined &&
      value.contractNumber !== source.contract.contractNumber) ||
    (source.contract.orderId !== undefined && value.orderId !== source.contract.orderId) ||
    (source.contract.savingOrderId !== undefined &&
      value.savingOrderId !== source.contract.savingOrderId) ||
    value.state !== 'ChangesRequested' ||
    value.currentVersionId !== source.version.id ||
    !record(value.currentVersion) ||
    value.currentVersion.id !== source.version.id ||
    ('contractId' in source.version && value.currentVersion.contractId !== source.contract.id) ||
    value.currentVersion.versionNumber !== source.version.versionNumber ||
    value.currentVersion.changeDescription !== source.version.changeDescription ||
    !sameContractEvidence(value.currentVersion.content, source.version.content) ||
    !instant(value.createdAt) ||
    !instant(value.updatedAt) ||
    !['submittedAt', 'acceptedAt', 'signedAt', 'activatedAt', 'completedAt', 'cancelledAt'].every(
      (key) => value[key] === null || instant(value[key])
    ) ||
    typeof value.contractNumber !== 'string' ||
    !/^[1-9][0-9]*$/.test(value.contractNumber) ||
    typeof value.amendmentSupported !== 'boolean' ||
    value.pendingAmendment !== null ||
    value.acceptedParty !== null
  )
    return false;
  const currentVersion = value.currentVersion;
  return ['createdAt', 'createdBy', 'publishedAt', 'acceptedAt'].every(
    (key) =>
      !Object.hasOwn(source.version, key) ||
      sameContractEvidence(currentVersion[key], source.version[key as keyof ContractVersion])
  );
}
