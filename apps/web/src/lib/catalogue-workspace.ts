import type { RecordAddress } from '../hooks/useRecordAddress.js';

export interface CatalogueWorkspace {
  editor: RecordAddress;
  detail: RecordAddress;
  clear: () => void;
}

export function catalogueWorkspaceSearch(raw: Record<string, unknown>) {
  const id = (value: unknown) =>
    typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : undefined;
  return { editing: id(raw.editing), viewing: id(raw.viewing) };
}
