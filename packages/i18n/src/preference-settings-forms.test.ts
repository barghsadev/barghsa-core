import { expect, it } from 'vitest';
import { en, fa, tPreferenceSettingsForms } from './preference-settings-forms.js';
it('keeps both dictionaries complete and all preference feedback translated', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    expect(tPreferenceSettingsForms(key, 'en')).not.toBe(key);
    expect(tPreferenceSettingsForms(key, 'fa')).not.toBe(key);
    expect(fa[key]).toMatch(/[\u0600-\u06ff]/);
  }
});
