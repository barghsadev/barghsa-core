import { listChoice, listText, parseListQuery, type ListQueryOptions } from './list-query.js';
export const GIFT_CODE_PAGE_SIZE = 50;

export const giftCodeId = (value: unknown) =>
  typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? value.toLowerCase()
    : '';
export const giftQueryOptions: ListQueryOptions = {
  searchLimit: 0,
  filters: {
    search: listText(64),
    status: listChoice(['active', 'inactive']),
    discountType: listChoice(['fixed_irr', 'percentage']),
    eligibility: listChoice(['public', 'profile']),
    expiry: listChoice(['not_expired', 'expired']),
  },
  sortFields: [],
  defaultSort: '',
  pageSizes: [GIFT_CODE_PAGE_SIZE],
  defaultPageSize: GIFT_CODE_PAGE_SIZE,
  pagination: 'cursor',
};
export function giftListSearch(raw: Record<string, unknown>) {
  const query = parseListQuery(raw, giftQueryOptions);
  return Object.fromEntries<string>(
    Object.entries({
      ...query.filters,
      cursor: giftCodeId(query.cursor),
    }).filter(([, value]) => value !== '')
  );
}
export function legacyGiftListSearch(raw: Record<string, unknown>) {
  return {
    ...giftListSearch(raw),
    selected: raw.selected === 'new' ? 'new' : giftCodeId(raw.selected) || undefined,
  };
}
export const giftFilter = (filters: Record<string, string>) =>
  new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '')).toString();
