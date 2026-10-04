import { record } from './catalogue-form.js';
import type { RelationOwner } from './catalogue-membership.js';

export interface AvailableKnowledgeDocument {
  storageKey: string;
  fileName: string;
}
export interface KnowledgeDocumentCommand {
  kbId: string;
  storageKey: string;
  documentId?: string;
  expected: 'present' | 'absent';
  choicesRequired: false;
  owner?: RelationOwner;
}
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const validDocumentKey = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 500 && value.trim().length > 0;
export function validAvailableKnowledgeDocuments(
  value: unknown
): value is AvailableKnowledgeDocument[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        record(row) &&
        validDocumentKey(row.storageKey) &&
        typeof row.fileName === 'string' &&
        !!row.fileName.trim()
    ) &&
    new Set(value.map((row) => row.storageKey)).size === value.length
  );
}
export function matchesKnowledgeDocumentReceipt(
  value: unknown,
  command: KnowledgeDocumentCommand
): value is Record<string, unknown> & { id: string } {
  return (
    uuid(command.kbId) &&
    validDocumentKey(command.storageKey) &&
    record(value) &&
    uuid(value.id) &&
    value.kbId === command.kbId &&
    value.storageKey === command.storageKey &&
    typeof value.fileName === 'string' &&
    !!value.fileName.trim() &&
    typeof value.processingStatus === 'string' &&
    ['pending', 'processing', 'ready', 'failed'].includes(value.processingStatus)
  );
}
export function matchesKnowledgeDocuments(
  value: unknown,
  command: KnowledgeDocumentCommand
): boolean {
  if (
    !uuid(command.kbId) ||
    !validDocumentKey(command.storageKey) ||
    !record(value) ||
    value.id !== command.kbId ||
    !Array.isArray(value.documents)
  )
    return false;
  const rows = value.documents;
  if (
    !rows.every((row) => record(row) && uuid(row.id) && validDocumentKey(row.storageKey)) ||
    new Set(rows.map((row) => row.id)).size !== rows.length ||
    new Set(rows.map((row) => row.storageKey)).size !== rows.length
  )
    return false;
  if (command.expected === 'absent')
    return (
      uuid(command.documentId) &&
      !rows.some((row) => row.id === command.documentId || row.storageKey === command.storageKey)
    );
  return (
    uuid(command.documentId) &&
    rows.some((row) => row.id === command.documentId && row.storageKey === command.storageKey)
  );
}

export const validCatalogueCount = (value: unknown) =>
  value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
export const validCataloguePriority = (value: unknown) =>
  value === undefined ||
  (typeof value === 'number' && Number.isInteger(value) && value >= -1000 && value <= 1000);
