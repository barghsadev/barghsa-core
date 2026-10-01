import {
  listChoice,
  listText,
  parseListQuery,
  type ListQueryOptions,
} from '../hooks/useListQuery.js';
import { GIFT_CODE_PAGE_SIZE } from './gift-code-catalogue.js';

const uuid = (value: unknown) =>
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
export function giftListSearch(raw: Record<string, unknown>): Record<string, unknown> {
  const query = parseListQuery(raw, giftQueryOptions);
  return Object.fromEntries(
    Object.entries({
      ...query.filters,
      cursor: uuid(query.cursor),
      selected: raw.selected === 'new' ? 'new' : uuid(raw.selected),
    }).filter(([, value]) => value !== '')
  );
}
export const giftFilter = (filters: Record<string, string>) =>
  new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '')).toString();
