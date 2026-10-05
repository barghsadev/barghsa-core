import { expect, it } from 'vitest';
import { en, fa, tSolarContract } from './solar-contract.js';
it('provides complete linked contract validation and recovery copy in both languages', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    expect(tSolarContract(key, 'en')).toBe(en[key]);
    expect(tSolarContract(key, 'fa')).toBe(fa[key]);
    expect(en[key]?.trim()).not.toBe('');
    expect(fa[key]?.trim()).not.toBe('');
  }
});
