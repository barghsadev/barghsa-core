import { expect, it } from 'vitest';
import { en, fa, tContractReviewSignature } from './contract-review-signature.js';
it('provides complete linked review and signing feedback in both languages', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(fa).sort());
  for (const key of Object.keys(en)) {
    expect(tContractReviewSignature(key, 'en')).toBe(en[key]);
    expect(tContractReviewSignature(key, 'fa')).toBe(fa[key]);
    expect(en[key]?.trim()).not.toBe('');
    expect(fa[key]?.trim()).not.toBe('');
  }
});
