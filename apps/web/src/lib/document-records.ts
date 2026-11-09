import {
  documentKinds,
  documentStates,
  type BusinessDocument,
  type DocumentDetail,
} from './documents.js';

export function validDocumentRow(item: BusinessDocument, profileId: string) {
  return (
    !!item &&
    typeof item.id === 'string' &&
    typeof item.profileId === 'string' &&
    (!profileId || item.profileId === profileId) &&
    documentKinds.includes(item.businessRecordType) &&
    documentStates.includes(item.state) &&
    typeof item.originalName === 'string' &&
    Number.isSafeInteger(item.revision) &&
    Number.isSafeInteger(item.sizeBytes) &&
    item.sizeBytes >= 0 &&
    typeof item.createdAt === 'string' &&
    Number.isFinite(Date.parse(item.createdAt)) &&
    (item.rejectionReason == null || typeof item.rejectionReason === 'string')
  );
}

export function validDocumentDetail(
  value: unknown,
  id: string,
  profileId: string
): value is DocumentDetail {
  const item = value as DocumentDetail | null;
  if (!item || !validDocumentRow(item, profileId) || item.id !== id || !item.profileId)
    return false;
  const permissions = item.permissions;
  return (
    ['document', 'image', 'video', 'contract'].includes(item.category) &&
    ['customer', 'staff', 'system'].includes(item.uploadedByType) &&
    (item.scanState === undefined ||
      ['Uploading', 'Pending', 'Available', 'Quarantined'].includes(item.scanState)) &&
    [
      item.businessRecordId,
      item.contractVersionId,
      item.detectedMime,
      item.checksum,
      item.supersedesDocumentId,
      item.reviewComment,
    ].every((text) => text == null || typeof text === 'string') &&
    (item.contractRole == null ||
      ['original', 'signed', 'amendment', 'superseded'].includes(item.contractRole)) &&
    (permissions === undefined ||
      (!!permissions &&
        typeof permissions === 'object' &&
        [permissions.download, permissions.write, permissions.remove, permissions.replace].every(
          (allowed) => typeof allowed === 'boolean'
        ))) &&
    Array.isArray(item.history) &&
    item.history.every(
      (event) =>
        event &&
        typeof event.id === 'string' &&
        documentStates.includes(event.state) &&
        typeof event.createdAt === 'string' &&
        Number.isFinite(Date.parse(event.createdAt)) &&
        (event.reason == null || typeof event.reason === 'string')
    )
  );
}
