import { expect, it } from 'vitest';
import { en, fa, tAccountSettingsForms } from './account-settings-forms.js';
it('keeps bilingual validation and recovery copy complete', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    expect(tAccountSettingsForms(key, 'en')).not.toBe(key);
    expect(tAccountSettingsForms(key, 'fa')).not.toBe(key);
    expect(fa[key]?.trim()).not.toBe('');
  }
});
