import { expect, it } from 'vitest';
import { fa, en, tServiceSettings } from './service-settings.js';

it('supplies matching, nonempty Persian and English service-setting copy', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const locale of ['fa', 'en'] as const)
    for (const key of Object.keys(en)) {
      expect(tServiceSettings(key, locale).trim()).not.toBe('');
      expect(tServiceSettings(key, locale)).not.toBe(key);
    }
});
it('preserves existing target labels in the isolated dictionary', () => {
  expect(tServiceSettings('admin.targets.save', 'en')).toBe('Save response targets');
  expect(tServiceSettings('admin.targets.hours', 'fa')).toBe('ساعت');
});
