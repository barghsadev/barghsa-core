import { expect, it } from 'vitest';
import { en, fa, tSettingsForms } from './settings-forms.js';
it('keeps owning settings form feedback bilingual', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    expect(tSettingsForms(key, 'en')).toBeTruthy();
    expect(tSettingsForms(key, 'fa')).toBeTruthy();
    expect(tSettingsForms(key, 'fa')).not.toBe(tSettingsForms(key, 'en'));
  }
});
