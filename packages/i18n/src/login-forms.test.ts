import { expect, it } from 'vitest';
import { loginFormDictionaries, loginFormText } from './login-forms.js';
it('provides complete distinct Persian and English login form copy', () => {
  expect(Object.keys(loginFormDictionaries.fa)).toEqual(Object.keys(loginFormDictionaries.en));
  for (const key of Object.keys(
    loginFormDictionaries.en
  ) as (keyof typeof loginFormDictionaries.en)[]) {
    expect(loginFormText(key, 'fa')).toMatch(/[\u0600-\u06ff]/);
    expect(loginFormText(key, 'en').trim()).not.toBe('');
    expect(loginFormText(key, 'fa')).not.toBe(loginFormText(key, 'en'));
  }
});
