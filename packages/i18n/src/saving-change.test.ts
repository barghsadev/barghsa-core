import { expect, it } from 'vitest';
import { en, fa, tSavingChange } from './saving-change.js';

it('localizes saving customer and paid-address form feedback and exact retries', () => {
  const keys = Object.keys(en);
  expect(keys.sort()).toEqual(Object.keys(fa).sort());
  expect(keys).toHaveLength(21);
  for (const key of keys) {
    expect(tSavingChange(key, 'en')).not.toBe(key);
    expect(tSavingChange(key, 'fa')).not.toBe(key);
    expect(tSavingChange(key, 'en')).not.toBe(tSavingChange(key, 'fa'));
  }
  expect(tSavingChange('staffReasonInvalid', 'en')).toContain('1,000');
});
