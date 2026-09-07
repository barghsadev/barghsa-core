import { expect, it } from 'vitest';
import { dictionaries, t } from './index.js';
import { fa as adminFa, en as adminEn, t as adminText } from './admin-ui.js';
import { fa as crmFa, en as crmEn, t as crmText } from './crm.js';
const allDictionaries = {
  fa: { ...dictionaries.fa, ...adminFa, ...crmFa },
  en: { ...dictionaries.en, ...adminEn, ...crmEn },
};
import { t as authText } from './auth.js';
import { t as termsText } from './terms.js';
import { tCatalogue } from './catalogue.js';
import { tGift } from './gifts.js';
import { tVat } from './vat.js';
import { tWalletLimit } from './wallet-limit.js';
import { tWalletReceipts } from './wallet-receipts.js';

it('keeps full Persian/English keys and interpolation placeholders consistent', () => {
  expect(Object.keys(allDictionaries.fa).sort()).toEqual(Object.keys(allDictionaries.en).sort());
  const placeholders = (value: string) =>
    [...value.matchAll(/\{\{?([a-zA-Z_][a-zA-Z_0-9]*)\}?\}/g)]
      .map((match) =>
        match[1] === 'status_label_fa' || match[1] === 'status_label_en' ? 'status_label' : match[1]
      )
      .sort();
  for (const key of Object.keys(allDictionaries.en)) {
    expect.soft(allDictionaries.fa[key]?.trim(), key).not.toBe('');
    expect
      .soft(placeholders(allDictionaries.fa[key] ?? ''), key)
      .toEqual(placeholders(allDictionaries.en[key]!));
    expect(adminText(key, 'fa')).toBe(allDictionaries.fa[key]);
    expect(adminText(key, 'en')).toBe(allDictionaries.en[key]);
  }
});
for (const [name, resolve] of Object.entries({
  t,
  authText,
  termsText,
  adminText,
  crmText,
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

it('keeps terms available through the dedicated and existing public dictionaries', () => {
  for (const locale of ['fa', 'en'] as const) {
    for (const [key, message] of Object.entries(dictionaries[locale])) {
      if (!key.startsWith('tos.')) continue;
      expect(termsText(key, locale)).toBe(message);
      expect(authText(key, locale)).toBe(message);
    }
    expect(termsText('tos.page.lastUpdated', locale)).toContain('{date}');
  }
});
