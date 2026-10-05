import { expect, it } from 'vitest';
import { lifecycleFormDictionaries, lifecycleFormText } from './profile-lifecycle-forms.js';
it('provides every lifecycle form message in Persian and English', () => {
  expect(Object.keys(lifecycleFormDictionaries.fa).sort()).toEqual(
    Object.keys(lifecycleFormDictionaries.en).sort()
  );
  for (const key of Object.keys(
    lifecycleFormDictionaries.en
  ) as (keyof typeof lifecycleFormDictionaries.en)[])
    for (const locale of ['fa', 'en'] as const)
      expect(lifecycleFormText(key, locale).trim()).not.toBe('');
});
