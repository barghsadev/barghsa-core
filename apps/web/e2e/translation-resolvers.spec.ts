import { test, expect, registerComponentCoverage } from './coverage-fixture';
import { build, preview, type PreviewServer } from 'vite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Exercise public translation entry points after production compilation, outside product routes.
test.use({ timezoneId: 'UTC' });

let server: PreviewServer;
let outDir: string;
let url: string;
test.beforeAll(async () => {
  const coverageDir = process.env['BARGHSA_BROWSER_COVERAGE_DIR'];
  const buildParent = coverageDir ? join(coverageDir, 'builds') : tmpdir();
  await mkdir(buildParent, { recursive: true });
  outDir = await mkdtemp(join(buildParent, 'component-translations-'));
  const root = resolve('e2e/fixtures/translations');
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    build: { outDir, emptyOutDir: true, sourcemap: coverageDir ? 'hidden' : false },
  });
  server = await preview({
    configFile: false,
    root,
    logLevel: 'error',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0 },
  });
  url = server.resolvedUrls.local[0]!;
  if (coverageDir) registerComponentCoverage(url, outDir);
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((done, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : done()))
    );
  if (outDir && !process.env['BARGHSA_BROWSER_COVERAGE_DIR'])
    await rm(outDir, { recursive: true, force: true });
});

const dictionaries = [
  { id: 'auth', key: 'auth.login.submit', en: 'Log in', fa: 'ورود' },
  {
    id: 'templates',
    key: 'admin.templates.title',
    en: 'Contract templates',
    fa: 'قالب‌های قرارداد',
  },
  {
    id: 'limit',
    key: 'admin.walletLimit.title',
    en: 'Online wallet top-up limit',
    fa: 'سقف شارژ آنلاین کیف پول',
  },
  {
    id: 'receipts',
    key: 'admin.walletReceipts.title',
    en: 'Staff wallet receipt review',
    fa: 'بررسی رسید شارژ کیف پول',
  },
];
for (const dictionary of dictionaries)
  for (const locale of ['fa', 'en'] as const) {
    test(`compiled ${dictionary.id} dictionary preserves messages and literal fallback (${locale})`, async ({
      page,
    }) => {
      await page.goto(url);
      await page.getByLabel('Dictionary', { exact: true }).selectOption(dictionary.id);
      await page.getByLabel('Language', { exact: true }).selectOption(locale);
      const input = page.getByLabel('Message key', { exact: true });
      const result = page.getByRole('status', { name: 'Translated message' });
      await input.fill(dictionary.key);
      await expect(result).toHaveText(dictionary[locale]);
      for (const key of [
        'missing.translation',
        'toString',
        'constructor',
        '__proto__',
        'hasOwnProperty',
      ]) {
        await input.fill(key);
        await expect(result).toHaveText(key);
      }
      await input.fill(dictionary.key);
      await expect(result).toHaveText(dictionary[locale]);
    });
  }
