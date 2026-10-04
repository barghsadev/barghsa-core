import { expect, it } from 'vitest';
import { t } from './app.js';
import { en, fa, tOrderComments } from './order-comments.js';
import { tSaving } from './saving.js';

it('localizes shared comment feedback and preserves both journey labels', () => {
  const keys = Object.keys(en);
  expect(keys.sort()).toEqual(Object.keys(fa).sort());
  expect(keys).toHaveLength(11);
  for (const key of keys) {
    expect(tOrderComments(key, 'en')).not.toBe(key);
    expect(tOrderComments(key, 'fa')).not.toBe(key);
    expect(tOrderComments(key, 'en')).not.toBe(tOrderComments(key, 'fa'));
  }
  for (const locale of ['en', 'fa'] as const) {
    expect(tSaving('sendComment', locale)).not.toBe('sendComment');
    expect(t('electricity.comments.sendComment', locale)).not.toBe(
      'electricity.comments.sendComment'
    );
  }
});
