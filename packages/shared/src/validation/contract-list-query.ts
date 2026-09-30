import { parseHistoryQuery } from './history-query.js';

export const CUSTOMER_CONTRACT_STATUSES = [
  'AwaitingCustomerAcceptance',
  'Accepted',
  'AwaitingSignature',
  'Signed',
  'Active',
  'Completed',
  'Cancelled',
] as const;
export const CONTRACT_SERVICE_TYPES = ['electricity', 'savings', 'solar'] as const;
export const CONTRACT_LIST_SORTS = ['published_at:desc', 'published_at:asc'] as const;
export const DEFAULT_CONTRACT_LIST_SORT = 'published_at:desc';
export interface ContractListQuery {
  q: string;
  sort: (typeof CONTRACT_LIST_SORTS)[number];
  serviceType?: (typeof CONTRACT_SERVICE_TYPES)[number] | undefined;
}
export function parseContractListQuery(
  q: unknown,
  sort: unknown,
  serviceType: unknown
): ContractListQuery | null {
  const search = parseHistoryQuery(q, undefined);
  const order = sort === undefined || sort === '' ? DEFAULT_CONTRACT_LIST_SORT : sort;
  const service = serviceType === '' ? undefined : serviceType;
  if (
    !search ||
    !CONTRACT_LIST_SORTS.includes(order as ContractListQuery['sort']) ||
    (service !== undefined &&
      !CONTRACT_SERVICE_TYPES.includes(service as NonNullable<ContractListQuery['serviceType']>))
  )
    return null;
  return {
    q: search.q,
    sort: order as ContractListQuery['sort'],
    serviceType: service as ContractListQuery['serviceType'],
  };
}
