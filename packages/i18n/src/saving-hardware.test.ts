import { expect, it } from 'vitest';
import { en, fa, tSavingHardware } from './saving-hardware.js';

it('provides the same nonempty saving hardware feedback in both languages', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    expect(tSavingHardware(key, 'en')).toBe(en[key]);
    expect(tSavingHardware(key, 'fa')).toBe(fa[key]);
    expect(en[key]?.trim()).not.toBe('');
    expect(fa[key]?.trim()).not.toBe('');
  }
});
