import { expect, it } from 'vitest';
import { en, fa, tSavingOperations } from './saving-operations.js';

it('provides the same nonempty saving staff operation feedback in both languages', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    expect(tSavingOperations(key, 'en')).toBe(en[key]);
    expect(tSavingOperations(key, 'fa')).toBe(fa[key]);
    expect(en[key]?.trim()).not.toBe('');
    expect(fa[key]?.trim()).not.toBe('');
  }
});
