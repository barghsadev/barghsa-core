import { expect, it } from 'vitest';
import { t, en, fa } from './admin-ui.js';
it('labels system contract activation in both languages and retains shared-key fallback', () => {
  expect(t('admin.jobs.type.contract_activation', 'en')).toBe('Contract activation');
  expect(t('admin.jobs.type.contract_activation')).toBe(fa['admin.jobs.type.contract_activation']);
  expect(t('unknown-admin-key', 'en')).toBe('unknown-admin-key');
  expect(t('unknown-admin-key', 'fa')).toBe('unknown-admin-key');
  for (const key of Object.keys(en)) {
    expect(t(key, 'en')).toBeTruthy();
    expect(t(key, 'fa')).toBeTruthy();
  }
});
