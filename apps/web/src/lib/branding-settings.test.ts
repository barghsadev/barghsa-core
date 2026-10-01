import { expect, it } from 'vitest';
import {
  validBrandHistory,
  coherentBrandHistory,
  acceptBrandRevision,
} from './branding-settings.js';
import { publishedBrand, previousBrand, draftBrand } from '../test/branding-settings-fixtures.js';
it.each([
  null,
  {},
  [publishedBrand, publishedBrand],
  [publishedBrand, { ...draftBrand, version: 2 }],
  [publishedBrand, { ...draftBrand, status: 'active' }],
  [publishedBrand, { ...previousBrand, status: 'draft' }],
  [{ ...draftBrand, version: 0 }],
  [{ ...draftBrand, updatedAt: 'bad' }],
  [{ ...draftBrand, status: ['draft'] }],
])('rejects invalid or ambiguous history %#', (value) =>
  expect(validBrandHistory(value)).toBe(false)
);
it('requires the latest exact saved config and validates empty-history defaults', () => {
  expect(coherentBrandHistory(publishedBrand, [draftBrand, publishedBrand, previousBrand])).toBe(
    false
  );
  expect(coherentBrandHistory(draftBrand, [previousBrand, publishedBrand, draftBrand])).toBe(true);
  expect(
    coherentBrandHistory({ ...draftBrand, config: previousBrand.config }, [
      draftBrand,
      publishedBrand,
    ])
  ).toBe(false);
  expect(coherentBrandHistory({ ...draftBrand, id: 'default', version: 0 }, [])).toBe(true);
  expect(coherentBrandHistory({ ...draftBrand, version: 0 }, [])).toBe(false);
});
it('supersedes only matching phase on a confirmed save or activation, preserving immutable history', () => {
  const history = [publishedBrand, previousBrand];
  const next = acceptBrandRevision(history, draftBrand);
  expect(next).toEqual([draftBrand, publishedBrand, previousBrand]);
  const active = { ...draftBrand, status: 'active' as const };
  expect(acceptBrandRevision(next, active)).toEqual([
    active,
    { ...publishedBrand, status: 'superseded' },
    previousBrand,
  ]);
  expect(history).toEqual([publishedBrand, previousBrand]);
});
