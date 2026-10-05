import { expect, it } from 'vitest';
import { securitySettingsDictionaries, securitySettingsText } from './security-settings-forms.js';
it('has complete English/Persian security form feedback without raw keys or placeholders', () => {
  expect(Object.keys(securitySettingsDictionaries.fa).sort()).toEqual(
    Object.keys(securitySettingsDictionaries.en).sort()
  );
  for (const locale of ['en', 'fa'] as const)
    for (const key of Object.keys(securitySettingsDictionaries.en)) {
      expect(securitySettingsText(key, locale)).not.toBe(key);
      expect(securitySettingsText(key, locale)).not.toMatch(/\{[^}]*\}/);
    }
});
