import { expect, it } from 'vitest';
import { writeListQuery } from '../hooks/useListQuery.js';
import {
  productCatalogueSearch,
  knowledgeCatalogueSearch,
  policyCatalogueSearch,
  productCatalogueQueryOptions,
  knowledgeCatalogueQueryOptions,
  policyCatalogueQueryOptions,
} from './catalogue-category-query.js';

const catalogues = [
  [productCatalogueSearch, productCatalogueQueryOptions, 'type', 'electricity', 'consultation'],
  [
    knowledgeCatalogueSearch,
    knowledgeCatalogueQueryOptions,
    'kind',
    'kb-groups',
    'knowledge-bases',
  ],
  [policyCatalogueSearch, policyCatalogueQueryOptions, 'kind', 'policy-groups', 'policies'],
] as const;
for (const [normalize, options, key, value, fallback] of catalogues) {
  it(`restores only the public ${value} catalogue category`, () => {
    expect(
      normalize({
        [key]: value,
        password: 'private',
        title: 'draft',
        member: 'private',
        q: 'private',
        page: 3,
        selected: 'private',
      })
    ).toEqual({ [key]: value });
    expect(
      normalize(writeListQuery({ [key]: value }, options, { filters: { [key]: fallback } }))
    ).toEqual({});
  });
  it.each([undefined, [], [value], '<script>', 'unknown', fallback])(
    `rejects invalid/default ${value} category: %j`,
    (invalid) => {
      expect(normalize({ [key]: invalid })).toEqual({});
    }
  );
}
it.each(['hardware', 'saving_plan'])('accepts the remaining product category %s', (type) => {
  expect(productCatalogueSearch({ type })).toEqual({ type });
});
it('keeps knowledge and policy catalogue scopes separate', () => {
  expect(knowledgeCatalogueSearch({ kind: 'policy-groups' })).toEqual({});
  expect(policyCatalogueSearch({ kind: 'kb-groups' })).toEqual({});
});
