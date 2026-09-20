import { expect, it } from 'vitest';
import { en, fa, contractText } from './contracts.js';
it('keeps contract labels complete in Persian and English', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    expect(contractText(key, 'en')).toBeTruthy();
    expect(contractText(key, 'fa')).toMatch(/[آ-ی]/);
  }
  expect(contractText('unmapped', 'en')).toBe('unmapped');
});
