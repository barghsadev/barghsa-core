export type CatalogueRecordView =
  'list' | 'create' | 'detail' | 'edit' | 'documents' | 'ingestion' | 'document';

export type CatalogueRecordWorkspace =
  | { view: 'list'; recordId?: never; documentId?: never }
  | {
      view: Exclude<CatalogueRecordView, 'list'>;
      recordId?: string;
      documentId?: string;
      showRecord: (id: string, replace?: boolean) => void;
      showList: (replace?: boolean) => void;
    };

export function isCatalogueRecordId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

export function catalogueWorkspaceSearch(raw: Record<string, unknown>) {
  const id = (value: unknown) => (isCatalogueRecordId(value) ? value : undefined);
  return { editing: id(raw.editing), viewing: id(raw.viewing) };
}
