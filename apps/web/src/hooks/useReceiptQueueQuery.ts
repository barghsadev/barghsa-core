import { useState } from 'react';
import { useListQuery, type ListQueryBinding } from './useListQuery.js';
import { decodeFinanceCursor, pendingReceiptQueryOptions } from '../lib/finance-list-query.js';

export function useReceiptQueueQuery(binding?: ListQueryBinding) {
  const [raw, setRaw] = useState<Record<string, unknown>>({});
  const local = useListQuery(pendingReceiptQueryOptions, raw, (update) => setRaw(update));
  return binding ?? local;
}
export function receiptQueueParams(binding: ListQueryBinding): string {
  const params = new URLSearchParams();
  if (binding.query.search) params.set('q', binding.query.search);
  if (binding.query.order !== 'asc') params.set('sort', `submitted_at:${binding.query.order}`);
  const cursor = decodeFinanceCursor(binding.query.cursor);
  if (cursor) {
    params.set('beforeAt', cursor.beforeAt);
    params.set('beforeId', cursor.beforeId);
  }
  return params.size ? `?${params}` : '';
}
