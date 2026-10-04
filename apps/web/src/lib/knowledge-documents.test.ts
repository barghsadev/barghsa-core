import { expect, it } from 'vitest';
import {
  validAvailableKnowledgeDocuments,
  matchesKnowledgeDocumentReceipt,
  matchesKnowledgeDocuments,
  validCatalogueCount,
  validCataloguePriority,
  type KnowledgeDocumentCommand,
} from './knowledge-documents.js';
const kbId = '01900000-0000-7000-8000-000000000001';
const id = '01900000-0000-7000-8000-000000000007';
const row = {
  id,
  kbId,
  storageKey: 'uploads/legacy-guide.pdf',
  fileName: 'Guide.pdf',
  processingStatus: 'pending',
};
const command: KnowledgeDocumentCommand = {
  kbId,
  documentId: id,
  storageKey: row.storageKey,
  expected: 'present',
  choicesRequired: false,
};
it('accepts available opaque storage-record keys, including existing legacy records', () => {
  expect(validAvailableKnowledgeDocuments([row])).toBe(true);
  expect(validAvailableKnowledgeDocuments([])).toBe(true);
});
it.each([
  null,
  {},
  [row, row],
  [{ ...row, storageKey: ' ' }],
  [{ ...row, storageKey: 'x'.repeat(501) }],
  [{ ...row, fileName: '' }],
])('rejects malformed or ambiguous available files %#', (value) => {
  expect(validAvailableKnowledgeDocuments(value)).toBe(false);
});
it('binds the attachment receipt to its knowledge base and storage record', () => {
  expect(matchesKnowledgeDocumentReceipt(row, command)).toBe(true);
  for (const over of [
    { id: 'other' },
    { kbId: id },
    { storageKey: 'different' },
    { fileName: '' },
    { processingStatus: 'other' },
    { processingStatus: ['pending'] },
  ])
    expect(matchesKnowledgeDocumentReceipt({ ...row, ...over }, command)).toBe(false);
});
it('requires the same unique document ID and key in a fresh detail read', () => {
  expect(matchesKnowledgeDocuments({ id: kbId, documents: [row] }, command)).toBe(true);
  for (const documents of [
    [],
    [row, row],
    [{ ...row, id: kbId }],
    [{ ...row, storageKey: 'different' }],
    [{ ...row, id: 'other' }],
  ])
    expect(matchesKnowledgeDocuments({ id: kbId, documents }, command)).toBe(false);
  expect(matchesKnowledgeDocuments({ id, documents: [row] }, command)).toBe(false);
});
it('requires both removed identity and key to be absent before reporting detach success', () => {
  const remove = { ...command, expected: 'absent' as const };
  expect(matchesKnowledgeDocuments({ id: kbId, documents: [] }, remove)).toBe(true);
  for (const documents of [[row], [{ ...row, id: kbId }], [{ ...row, storageKey: 'different' }]])
    expect(matchesKnowledgeDocuments({ id: kbId, documents }, remove)).toBe(false);
  expect(matchesKnowledgeDocuments({ id: kbId }, remove)).toBe(false);
});
it('allows missing metadata without accepting fabricated counts or fractional/out-of-range priorities', () => {
  for (const value of [undefined, 0, 1234, Number.MAX_SAFE_INTEGER])
    expect(validCatalogueCount(value)).toBe(true);
  for (const value of [null, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1'])
    expect(validCatalogueCount(value)).toBe(false);
  for (const value of [undefined, -1000, 0, 1000]) expect(validCataloguePriority(value)).toBe(true);
  for (const value of [null, -1001, 1001, 1.5, NaN, Infinity, '1'])
    expect(validCataloguePriority(value)).toBe(false);
});
