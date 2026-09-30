import { expect, it } from 'vitest';
import { parseContractListQuery } from './contract-list-query.js';

it('defaults to publication sorting and normalizes search and empty service selection', () => {
  expect(parseContractListQuery(undefined, undefined, '')).toEqual({
    q: '',
    sort: 'published_at:desc',
    serviceType: undefined,
  });
  expect(parseContractListQuery(' 123%_ ', 'published_at:asc', 'savings')).toEqual({
    q: '123%_',
    sort: 'published_at:asc',
    serviceType: 'savings',
  });
});
it.each([
  ['x'.repeat(121), undefined, undefined],
  ['\n', undefined, undefined],
  [['x'], undefined, undefined],
  ['', 'created_at:desc', undefined],
  ['', ['published_at:asc'], undefined],
  ['', undefined, 'staff'],
  ['', undefined, ['solar']],
])('rejects malformed contract list input (%s, %s, %s)', (q, sort, service) => {
  expect(parseContractListQuery(q, sort, service)).toBeNull();
});
