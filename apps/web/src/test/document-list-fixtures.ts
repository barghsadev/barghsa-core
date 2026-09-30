import type { BusinessDocument } from '../lib/documents.js';

export const documentProfileId = '11111111-1111-4111-8111-111111111111';
export const documentRow: BusinessDocument = {
  id: '22222222-2222-4222-8222-222222222222',
  profileId: documentProfileId,
  businessRecordType: 'standalone',
  businessRecordId: null,
  contractVersionId: null,
  contractRole: null,
  category: 'document',
  state: 'SubmittedForReview',
  originalName: 'Review.pdf',
  detectedMime: 'application/pdf',
  sizeBytes: 123,
  checksum: 'a'.repeat(64),
  uploadedBy: 'customer',
  uploadedByType: 'customer',
  supersedesDocumentId: null,
  rejectionReason: null,
  reviewComment: null,
  revision: 3,
  createdAt: '2026-09-24T00:00:00Z',
  updatedAt: '2026-09-24T00:00:00Z',
};
export const documentCursor = '33333333-3333-4333-8333-333333333333';
export const documentMore = { ...documentRow, id: documentCursor, originalName: 'Another.pdf' };
export const documentDetail = {
  ...documentRow,
  history: [
    { id: 'event', state: documentRow.state, createdAt: documentRow.createdAt, reason: null },
  ],
};
export const templateRow = {
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Customer agreement',
  description: 'Staff form',
  category: 'contract',
  versionCount: 1,
  updatedAt: documentRow.updatedAt,
};
export const templateFile = {
  id: '55555555-5555-4555-8555-555555555555',
  originalName: 'Terms.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 123,
  checksum: 'b'.repeat(64),
  placeholders: [],
};
export const templateDetail = {
  ...templateRow,
  versions: [
    {
      id: '66666666-6666-4666-8666-666666666666',
      versionNumber: 1,
      changeSummary: 'Initial terms',
      placeholders: [],
      missingRequired: [],
      conflicts: [],
      createdAt: documentRow.createdAt,
      files: [templateFile],
    },
  ],
};
export const destructionItem = {
  id: '77777777-7777-4777-8777-777777777777',
  documentId: documentRow.id,
  businessRecordType: 'standalone',
  retentionDeadline: documentRow.createdAt,
  status: 'pending_approval',
  attempts: 0,
  lastError: null,
};
export const destructionQueue = {
  items: [destructionItem],
  counts: [{ status: 'pending_approval', count: 1 }],
  canManage: true,
};
