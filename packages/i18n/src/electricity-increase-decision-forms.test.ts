import { expect, it } from 'vitest';
import { t, adminText, fa, en, adminFA, adminEN } from './electricity-increase-decision-forms.js';
import { t as fullText, fa as fullFA, en as fullEN } from './app.js';
import { t as fullAdminText, fa as fullAdminFA, en as fullAdminEN } from './admin-ui.js';
it('retains every original decision form and directory message in both locales', () => {
  for (const locale of ['fa', 'en'] as const) {
    const original = locale === 'fa' ? fullFA : fullEN,
      originalAdmin = locale === 'fa' ? fullAdminFA : fullAdminEN;
    const scoped = locale === 'fa' ? fa : en,
      scopedAdmin = locale === 'fa' ? adminFA : adminEN;
    const keys = Object.keys(original).filter((key) =>
      key.startsWith('electricity.increaseDecisionForm.')
    );
    const adminKeys = Object.keys(originalAdmin).filter((key) =>
      key.startsWith('admin.electricityIncreases.')
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(adminKeys.length).toBeGreaterThan(0);
    expect(Object.keys(scoped).sort()).toEqual(keys.sort());
    expect(Object.keys(scopedAdmin).sort()).toEqual(adminKeys.sort());
    for (const key of keys) expect(t(key, locale)).toBe(fullText(key, locale));
    for (const key of adminKeys) expect(adminText(key, locale)).toBe(fullAdminText(key, locale));
    expect(t('electricity.increaseDecisionForm.unknown', locale)).toBe(
      fullText('electricity.increaseDecisionForm.unknown', locale)
    );
    expect(adminText('admin.electricityIncreases.unknown', locale)).toBe(
      fullAdminText('admin.electricityIncreases.unknown', locale)
    );
  }
});
