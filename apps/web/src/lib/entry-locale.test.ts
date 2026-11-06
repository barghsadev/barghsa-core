import { afterEach, expect, it, vi } from 'vitest';
import { rememberEntryLocale, restoreEntryLocale, setLanguagePreference } from './entry-locale.js';

const originalLanguage = document.documentElement.lang;
const originalDirection = document.documentElement.dir;
const originalUrl = location.href;

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState({}, '', originalUrl);
  localStorage.removeItem('barghsa.locale');
  sessionStorage.removeItem('barghsa.entry-locale');
  document.cookie = 'barghsa_locale=; Path=/; Max-Age=0';
  document.documentElement.lang = originalLanguage;
  document.documentElement.dir = originalDirection;
});

it('defaults an unsupported browser language to Farsi', () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
  restoreEntryLocale();
  expect(document.documentElement.lang).toBe('fa');
  expect(document.documentElement.dir).toBe('rtl');
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

it('uses the first supported browser language without replacing an explicit saved choice', () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'en-US', 'fa-IR']);
  restoreEntryLocale();
  expect(document.documentElement.lang).toBe('en');
  expect(document.documentElement.dir).toBe('ltr');
  setLanguagePreference('fa');
  restoreEntryLocale();
  expect(document.documentElement.lang).toBe('fa');
  expect(document.documentElement.dir).toBe('rtl');
});

it('treats URL language as a hint and leaves all unrelated parameters intact', () => {
  history.replaceState(
    {},
    '',
    '/?lang=en&paymentOrderId=captured-order&authority=captured-authority'
  );
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fa-IR']);
  const search = location.search;
  restoreEntryLocale();
  expect(document.documentElement.lang).toBe('en');
  setLanguagePreference('fa');
  restoreEntryLocale();
  expect(document.documentElement.lang).toBe('fa');
  expect(location.search).toBe(search);
});

it('keeps the live language change and cookie fallback when browser storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
  setLanguagePreference('en');
  expect(document.documentElement.lang).toBe('en');
  expect(document.documentElement.dir).toBe('ltr');
  restoreEntryLocale();
  expect(document.documentElement.lang).toBe('en');
  expect(document.documentElement.dir).toBe('ltr');
});
