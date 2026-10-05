import { expect, it } from 'vitest';
import { en, fa, tContractAuthoring } from './contract-authoring.js';
it('has complete English and Persian authoring feedback', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(fa).sort());
  for (const key of Object.keys(en)) {
    expect(tContractAuthoring(key, 'en')).toBe(en[key]);
    expect(tContractAuthoring(key, 'fa')).toBe(fa[key]);
    expect(fa[key]).toMatch(/[آ-ی]/);
  }
});
