import { expect, it } from 'vitest';
import { en, fa, t } from './app.js';
it('localizes the price workspace and exact retry in both dictionaries', () => {
  const keys = Object.keys(en).filter((key) => key.startsWith('electricity.priceForm.'));
  expect(keys.sort()).toEqual(
    Object.keys(fa)
      .filter((key) => key.startsWith('electricity.priceForm.'))
      .sort()
  );
  expect(keys).toHaveLength(13);
  for (const key of keys) {
    expect(t(key, 'en')).not.toBe(key);
    expect(t(key, 'fa')).not.toBe(key);
    expect(t(key, 'en')).not.toBe(t(key, 'fa'));
  }
  expect(t('electricity.priceForm.percentageInvalid', 'en')).toContain('two decimals');
  expect(t('electricity.priceForm.reasonHelp', 'en')).toContain('disclosed');
});
