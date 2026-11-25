import {
  CUSTOMER_CONTRACT_STATUSES,
  DEFAULT_CONTRACT_LIST_SORT,
  parseContractListQuery,
  parseDateRangeFilter,
  parseStatusFilter,
} from '@barghsa/shared/validation';

export const contractActions = 'AwaitingCustomerAcceptance,AwaitingSignature';

export function customerContractSearch(search: Record<string, unknown>) {
  const query = parseContractListQuery(search.q, search.sort, search.serviceType);
  return {
    state: search.state === 'Active' ? ('Active' as const) : undefined,
    statuses:
      parseStatusFilter(search.statuses, CUSTOMER_CONTRACT_STATUSES)?.join(',') || undefined,
    ...(parseDateRangeFilter(search.from, search.to) ?? { from: undefined, to: undefined }),
    q: query?.q || undefined,
    sort: query && query.sort !== DEFAULT_CONTRACT_LIST_SORT ? query.sort : undefined,
    serviceType: query?.serviceType,
  };
}

export type CustomerContractSearch = ReturnType<typeof customerContractSearch>;

export function customerContractId(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
}

export function customerContractRecordSearch(search: Record<string, unknown>) {
  const versionId = customerContractId(search.versionId)?.toLowerCase();
  return { ...customerContractSearch(search), ...(versionId ? { versionId } : {}) };
}
