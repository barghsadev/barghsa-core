import { expect, it } from 'vitest';
import { fa, en, t } from './purchase.js';
import { t as appText } from './app.js';

it('preserves purchase messages in both the focused and complete dictionaries', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const locale of ['fa', 'en'] as const) {
    for (const key of Object.keys(en)) {
      expect(t(key, locale)).toBe(appText(key, locale));
      expect(t(key, locale)).not.toBe(key);
    }
  }
  expect(t('wallet.title')).toBe(t('wallet.title', 'fa'));
});
it.each(['toString', 'constructor', '__proto__', 'unrecognized.message'])(
  'treats %s as an unknown translation',
  (key) => {
    expect(t(key, 'en')).toBe(key);
    expect(t(key, 'fa')).toBe(key);
  }
);
