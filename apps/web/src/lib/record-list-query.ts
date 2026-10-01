import {
  listChoice,
  writeListQuery,
  type ListQueryOptions,
  type ListQueryBinding,
} from '../hooks/useListQuery.js';
import { staffOrderId } from './staff-order-list-query.js';
import { contractStates } from './contracts.js';
import { documentKinds, documentStates } from './documents.js';

export interface RecordListQuery {
  queue: ListQueryBinding;
  selected: string | null;
  select: (id: string | null, options?: { replace?: boolean; resetCursor?: boolean }) => void;
  apply: (search: string, filters: Record<string, string>) => void;
}
export function contractNumber(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' && Number.isSafeInteger(value)
        ? String(value)
        : '';
  return /^[1-9][0-9]{0,18}$/.test(text) && BigInt(text) <= 9_223_372_036_854_775_807n ? text : '';
}
const baseOptions: ListQueryOptions = {
  searchLimit: 0,
  filters: {},
  sortFields: [],
  defaultSort: '',
  pageSizes: [30],
  defaultPageSize: 30,
  pagination: 'cursor',
};
export const staffContractQueryOptions: ListQueryOptions = {
  ...baseOptions,
  filters: {
    contractNumber,
    profileId: staffOrderId,
    state: listChoice(contractStates),
    serviceType: listChoice(['electricity', 'savings', 'solar']),
  },
};
export const customerDocumentQueryOptions: ListQueryOptions = {
  ...baseOptions,
  searchLimit: 128,
  filters: {
    kind: (value) => listChoice(documentKinds)(value) || 'standalone',
    state: listChoice(documentStates.filter((state) => state !== 'Removed')),
    category: listChoice(['document', 'image', 'video', 'contract']),
    businessRecordId: staffOrderId,
  },
};
export const staffDocumentQueryOptions: ListQueryOptions = {
  ...customerDocumentQueryOptions,
  filters: {
    ...customerDocumentQueryOptions.filters,
    state: (value) => listChoice(['all', ...documentStates])(value) || 'SubmittedForReview',
    profileId: staffOrderId,
  },
};
function recordSearch(
  raw: Record<string, unknown>,
  options: ListQueryOptions,
  selection: string
): Record<string, unknown> {
  const normalized = writeListQuery({ ...raw, cursor: staffOrderId(raw.cursor) }, options, {});
  return {
    ...(options.searchLimit ? { q: normalized.q } : {}),
    ...Object.fromEntries(Object.keys(options.filters).map((key) => [key, normalized[key]])),
    cursor: normalized.cursor,
    [selection]: staffOrderId(raw[selection]) || undefined,
  };
}
export const staffContractsSearch = (raw: Record<string, unknown>) =>
  recordSearch(raw, staffContractQueryOptions, 'contractId');
export const customerDocumentsSearch = (raw: Record<string, unknown>) =>
  recordSearch(raw, customerDocumentQueryOptions, 'documentId');
export const staffDocumentsSearch = (raw: Record<string, unknown>) =>
  recordSearch(raw, staffDocumentQueryOptions, 'documentId');
