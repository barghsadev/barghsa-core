import { afterEach, expect, it } from 'vitest';
import { rememberEntryLocale, restoreEntryLocale, setLanguagePreference } from './entry-locale.js';

const originalLanguage = document.documentElement.lang;
const originalDirection = document.documentElement.dir;

afterEach(() => {
  localStorage.removeItem('barghsa.locale');
  sessionStorage.removeItem('barghsa.entry-locale');
  document.cookie = 'barghsa_locale=; Path=/; Max-Age=0';
  document.documentElement.lang = originalLanguage;
  document.documentElement.dir = originalDirection;
});

it('uses a short-lived entry handoff once, then returns to the saved preference', () => {
  setLanguagePreference('fa');
  document.documentElement.lang = 'en';
  rememberEntryLocale();
  restoreEntryLocale();
  expect(document.documentElement.lang).toBe('en');
  expect(document.documentElement.dir).toBe('ltr');

  restoreEntryLocale();
  expect(document.documentElement.lang).toBe('fa');
  expect(document.documentElement.dir).toBe('rtl');
});

it('ignores an expired handoff and uses the cookie if local storage is empty', () => {
  setLanguagePreference('en');
  localStorage.removeItem('barghsa.locale');
  sessionStorage.setItem(
    'barghsa.entry-locale',
    JSON.stringify({ locale: 'fa', expires: Date.now() - 1 })
  );
  document.documentElement.lang = 'fa';
  restoreEntryLocale();
  expect(document.documentElement.lang).toBe('en');
  expect(document.documentElement.dir).toBe('ltr');
});
