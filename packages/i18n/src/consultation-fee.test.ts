import { expect, it } from 'vitest';
import { en, fa, tConsultationFee } from './consultation-fee.js';
it('provides nonempty fee feedback with identical keys in both languages', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    expect(tConsultationFee(key, 'en')).toBe(en[key]);
    expect(tConsultationFee(key, 'fa')).toBe(fa[key]);
    expect(en[key]?.trim()).not.toBe('');
    expect(fa[key]?.trim()).not.toBe('');
  }
});
