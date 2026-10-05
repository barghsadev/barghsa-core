import { expect, it } from 'vitest';
import { en, fa, tConsultationResolution } from './consultation-resolution.js';

it('provides nonempty resolution recovery copy with identical bilingual keys', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    expect(tConsultationResolution(key, 'en')).toBe(en[key]);
    expect(tConsultationResolution(key, 'fa')).toBe(fa[key]);
    expect(en[key]?.trim()).not.toBe('');
    expect(fa[key]?.trim()).not.toBe('');
  }
});
