import { test, expect } from './coverage-fixture';
import { browserFixtureProxy } from './local-network';

type LocaleCase = {
  name: string;
  browser: string;
  expected: 'fa' | 'en';
  stored?: string;
  cookie?: string;
  query?: string;
  handoff?: string;
  expired?: boolean;
  blocked?: boolean;
};
const cases: LocaleCase[] = [
  { name: 'English browser', browser: 'en-US', expected: 'en' },
  { name: 'Persian browser', browser: 'fa-IR', expected: 'fa' },
  { name: 'unsupported browser', browser: 'fr-FR', expected: 'fa' },
  { name: 'saved Persian choice', browser: 'en-US', stored: 'fa', expected: 'fa' },
  { name: 'English cookie', browser: 'fa-IR', cookie: 'en', expected: 'en' },
  {
    name: 'saved choice outranks cookie',
    browser: 'en-US',
    stored: 'fa',
    cookie: 'en',
    expected: 'fa',
  },
  { name: 'URL hint', browser: 'fa-IR', query: '?lang=en', expected: 'en' },
  {
    name: 'saved choice outranks URL hint',
    browser: 'en-US',
    stored: 'fa',
    query: '?lang=en',
    expected: 'fa',
  },
  { name: 'valid entry handoff', browser: 'fa-IR', stored: 'fa', handoff: 'en', expected: 'en' },
  {
    name: 'expired entry handoff',
    browser: 'en-US',
    stored: 'fa',
    handoff: 'en',
    expired: true,
    expected: 'fa',
  },
  {
    name: 'blocked storage uses cookie',
    browser: 'fa-IR',
    cookie: 'en',
    blocked: true,
    expected: 'en',
  },
  {
    name: 'invalid stored value and URL',
    browser: 'fr-FR',
    stored: 'constructor',
    query: '?lang=__proto__',
    expected: 'fa',
  },
];

for (const entry of cases) {
  test(`${entry.name} establishes language and direction before React loads`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      locale: entry.browser,
      proxy: browserFixtureProxy(),
    });
    try {
      const setup: {
        stored?: string;
        cookie?: string;
        handoff?: string;
        expired?: boolean;
        blocked?: boolean;
      } = entry;
      await context.addInitScript((setup) => {
        if (setup.stored) localStorage.setItem('barghsa.locale', setup.stored);
        if (setup.cookie) document.cookie = `barghsa_locale=${setup.cookie}; Path=/; SameSite=Lax`;
        if (setup.handoff)
          sessionStorage.setItem(
            'barghsa.entry-locale',
            JSON.stringify({
              locale: setup.handoff,
              expires: Date.now() + (setup.expired ? -1 : 25_000),
            })
          );
        if (setup.blocked) {
          Storage.prototype.getItem = () => {
            throw new DOMException('Storage blocked', 'SecurityError');
          };
        }
      }, setup);
      const page = await context.newPage();
      await page.route('**/*.js', (route) => route.abort('aborted'));
      const query = 'query' in entry ? entry.query : '';
      const response = await page.goto(`${baseURL}/login${query}`, { waitUntil: 'load' });
      expect(response?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', entry.expected);
      await expect(page.locator('html')).toHaveAttribute(
        'dir',
        entry.expected === 'fa' ? 'rtl' : 'ltr'
      );
      await expect(page.locator('#root')).toBeEmpty();
      const nonce = await page
        .locator('script:not([src])')
        .first()
        .evaluate((node) => (node as HTMLScriptElement).nonce);
      expect(nonce.length).toBeGreaterThan(10);
      expect(response!.headers()['content-security-policy-report-only']).toContain(
        `'nonce-${nonce}'`
      );
    } finally {
      await context.close();
    }
  });
}
