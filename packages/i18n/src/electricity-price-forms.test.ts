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

import { t as priceText } from './electricity-price-forms.js';
it('scoped price and invoice-state messages retain complete legacy values and unknown fallback', () => {
  for (const locale of ['fa', 'en'] as const) {
    const dictionary = locale === 'fa' ? fa : en;
    for (const key of Object.keys(dictionary).filter(
      (key) => key.startsWith('electricity.priceForm.') || key.startsWith('invoices.state.')
    ))
      expect(priceText(key, locale)).toBe(t(key, locale));
    expect(priceText('invoices.state.not_a_state', locale)).toBe(
      t('invoices.state.not_a_state', locale)
    );
  }
});

import { adminText } from './electricity-price-forms.js';
import { fa as adminFa, en as adminEn, t as fullAdminText } from './admin-ui.js';
it('scoped admin price labels retain every legacy label in both locales', () => {
  for (const locale of ['fa', 'en'] as const) {
    const dictionary = locale === 'fa' ? adminFa : adminEn;
    for (const key of Object.keys(dictionary).filter((key) =>
      key.startsWith('admin.electricityPrice.')
    ))
      expect(adminText(key, locale)).toBe(fullAdminText(key, locale));
    expect(adminText('admin.electricityPrice.unknown', locale)).toBe(
      fullAdminText('admin.electricityPrice.unknown', locale)
    );
  }
});
