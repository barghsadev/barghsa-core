import { expect, it } from 'vitest';
import { dictionaries, t } from './index.js';
import { t as authText } from './auth.js';
import { tCatalogue } from './catalogue.js';
import { tGift } from './gifts.js';
import { tVat } from './vat.js';
import { tWalletLimit } from './wallet-limit.js';
import { tWalletReceipts } from './wallet-receipts.js';

it('keeps full Persian/English keys and interpolation placeholders consistent', () => {
  expect(Object.keys(dictionaries.fa).sort()).toEqual(Object.keys(dictionaries.en).sort());
  const placeholders = (value: string) =>
    [...value.matchAll(/\{\{?([a-zA-Z_][a-zA-Z_0-9]*)\}?\}/g)]
      .map((match) =>
        match[1] === 'status_label_fa' || match[1] === 'status_label_en' ? 'status_label' : match[1]
      )
      .sort();
  for (const key of Object.keys(dictionaries.en)) {
    expect.soft(dictionaries.fa[key]?.trim(), key).not.toBe('');
    expect
      .soft(placeholders(dictionaries.fa[key] ?? ''), key)
      .toEqual(placeholders(dictionaries.en[key]!));
    expect(t(key, 'fa')).toBe(dictionaries.fa[key]);
    expect(t(key, 'en')).toBe(dictionaries.en[key]);
  }
});
for (const [name, resolve] of Object.entries({
  t,
  authText,
  tCatalogue,
  tGift,
  tVat,
  tWalletLimit,
  tWalletReceipts,
})) {
  for (const locale of ['fa', 'en'] as const)
    it(`${name} returns literal unknown keys in ${locale}, including object prototype names`, () => {
      for (const key of [
        'missing.translation',
        'toString',
        'constructor',
        '__proto__',
        'hasOwnProperty',
      ])
        expect(resolve(key, locale)).toBe(key);
    });
}
it('uses Persian by default and English for unsupported runtime locales', () => {
  expect(t('auth.support.contactEmail')).toBe(dictionaries.fa['auth.support.contactEmail']);
  for (const resolve of [t, authText]) {
    expect(Reflect.apply(resolve, undefined, ['name', 'constructor'])).toBe('name');
    expect(Reflect.apply(resolve, undefined, ['auth.support.contactEmail', 'invalid'])).toBe(
      dictionaries.en['auth.support.contactEmail']
    );
    expect(Reflect.apply(resolve, undefined, ['missing.translation', 'invalid'])).toBe(
      'missing.translation'
    );
  }
});
