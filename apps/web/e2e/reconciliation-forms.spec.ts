import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import AxeBuilder from '@axe-core/playwright';
import {
  reconciliationItem,
  paymentProfileId,
  paymentInvoiceId,
} from '../src/test/payment-review-fixtures';
import type { ReconciliationItem } from '../src/lib/reconciliation-form';

test.use({ timezoneId: 'Asia/Tehran' });
async function setup(page: Page, locale: 'en' | 'fa') {
  await crmShell(page, locale);
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
  );
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Barghsa',
        appTitleFa: 'برق‌آسا',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        numberStyle: 'locale',
        logoUrl: null,
        faviconUrl: null,
        darkMode: locale === 'fa',
      },
    })
  );
  let current: ReconciliationItem = {
    ...reconciliationItem,
    details: {
      ledger: '9007199254740993',
      walletId: paymentProfileId,
      invoiceId: paymentInvoiceId,
    },
  };
  let detailStatus = 200;
  const queries: string[] = [];
  const reads: string[] = [];
  await page.route('**/api/admin/reconciliation/items**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/access'))
      return route.fulfill({ json: { canView: true, canResolve: true } });
    if (url.pathname.endsWith(`/${current.id}`)) {
      reads.push(url.pathname);
      return route.fulfill({ status: detailStatus, json: detailStatus === 200 ? current : {} });
    }
    queries.push(url.search);
    return route.fulfill({
      json:
        !url.searchParams.get('status') || url.searchParams.get('status') === current.status
          ? [current]
          : [],
    });
  });
  const word = (key: string) => t(`admin.reconciliation.${key}`, locale);
  const dialog = () => page.getByRole('dialog');
  const button = (key: string) => dialog().getByRole('button', { name: word(key), exact: true });
  const confirm = () =>
    dialog().getByRole('button', { name: t('team.confirm', locale), exact: true });
  const cancel = () =>
    dialog().getByRole('button', { name: t('team.cancel', locale), exact: true });
  const open = async () => {
    await page.getByRole('button', { name: current.description, exact: true }).click();
    await expect(dialog()).toBeVisible();
  };
  await page.goto('/admin/reconciliation');
  await expect(page.getByRole('button', { name: current.description, exact: true })).toBeVisible();
  return {
    word,
    dialog,
    button,
    confirm,
    cancel,
    open,
    queries,
    reads,
    row: () => current,
    save: (next: ReconciliationItem) => {
      current = next;
    },
    readStatus: (value: number) => {
      detailStatus = value;
    },
  };
}
async function inspect(page: Page, locale: string, project: string, name: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCSS('opacity', '1');
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual(
    []
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'chromium') {
    await page.setViewportSize({ width: 1600, height: 2000 });
    await dialog.scrollIntoViewIfNeeded();
    await dialog.evaluate(async (node) => {
      node.scrollTop = 0;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
    });
    await expect.poll(async () => (await dialog.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
    await dialog.screenshot({
      path: `/Users/majid/.local/state/barghsa-manual-batches/reconciliation-review-forms/${name}-fa.png`,
    });
  }
}
for (const locale of ['en', 'fa'] as const) {
  test(`reconciliation validates native fields and owns an exact lifecycle (${locale})`, async ({
    page,
  }, info) => {
    const s = await setup(page, locale);
    const writes: { verb: string; body: Record<string, unknown> }[] = [];
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/admin/reconciliation/items/*/*', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const verb = new URL(route.request().url()).pathname.split('/').at(-1)!;
      const body = route.request().postDataJSON();
      writes.push({ verb, body });
      if (verb === 'resolve') await hold;
      const next = {
        ...s.row(),
        status:
          verb === 'investigate' ? 'investigating' : verb === 'resolve' ? 'resolved' : 'closed',
        assignedToUsername: 'reviewer',
        resolvedByUsername: verb === 'investigate' ? null : 'reviewer',
        resolutionNote: verb === 'investigate' ? null : (s.row().resolutionNote ?? body.note),
      } as ReconciliationItem;
      s.save(next);
      await route.fulfill({ json: next });
    });
    const from = page.getByLabel(s.word('from'), { exact: true });
    const before = page.getByLabel(s.word('before'), { exact: true });
    await from.fill('2026-03-08T02:30');
    await before.fill('2026-03-08T04:30');
    const count = s.queries.length;
    await page.getByRole('button', { name: s.word('apply'), exact: true }).click();
    await expect(from).toBeFocused();
    await expect(from).toHaveAttribute('aria-invalid', 'true');
    expect(s.queries).toHaveLength(count);
    await from.fill('2026-09-03T00:00');
    await before.fill('2026-09-01T00:00');
    await page.getByRole('button', { name: s.word('apply'), exact: true }).click();
    await expect(before).toHaveAttribute('aria-invalid', 'true');
    expect(s.queries).toHaveLength(count);
    await from.fill('2026-09-01T00:00');
    await before.fill('2026-09-03T00:00');
    await page.getByRole('button', { name: s.word('apply'), exact: true }).click();
    await expect
      .poll(() => new URLSearchParams(s.queries.at(-1)).get('createdFrom'))
      .toBe('2026-09-01T07:00:00.000Z');
    expect(new URLSearchParams(s.queries.at(-1)).get('createdBefore')).toBe(
      '2026-09-03T07:00:00.000Z'
    );
    await s.open();
    await expect(s.dialog().locator('pre')).toContainText('9007199254740993');
    await expect(s.dialog().getByRole('link', { name: s.word('walletLink') })).toHaveAttribute(
      'href',
      `/admin/wallet-ledger/${paymentProfileId}`
    );
    await expect(s.dialog().getByRole('link', { name: s.word('invoiceLink') })).toHaveAttribute(
      'href',
      `/admin/invoices?invoiceId=${paymentInvoiceId}`
    );
    const note = page.getByLabel(s.word('note'), { exact: true });
    await note.fill('  ');
    await s.button('resolve').click();
    await expect(note).toBeFocused();
    await expect(note).toHaveAttribute('aria-invalid', 'true');
    await expect(note).toHaveValue('  ');
    expect(writes).toHaveLength(0);
    await inspect(page, locale, info.project.name, 'validation');
    await s.button('investigate').click();
    await s.confirm().click();
    await expect(page.getByRole('status').filter({ hasText: s.word('saved') })).toBeVisible();
    expect(writes).toEqual([{ verb: 'investigate', body: {} }]);
    await page.getByLabel(s.word('status'), { exact: true }).selectOption('');
    await page.getByRole('button', { name: s.word('apply'), exact: true }).click();
    await s.open();
    await note.fill('  Ledger checked  ');
    await s.button('resolve').click();
    await expect(s.dialog().getByText('Ledger checked', { exact: true })).toBeVisible();
    await s.cancel().click();
    await expect(note).toHaveValue('  Ledger checked  ');
    await s
      .dialog()
      .locator('form')
      .evaluate((form: HTMLFormElement) => {
        form.requestSubmit();
        form.requestSubmit();
      });
    await expect(s.dialog().getByText('Ledger checked', { exact: true })).toBeVisible();
    await inspect(page, locale, info.project.name, 'confirmation');
    await s.confirm().click();
    await expect.poll(() => writes.length).toBe(2);
    await s
      .dialog()
      .locator('form')
      .evaluate((form: HTMLFormElement) => {
        form.requestSubmit();
        form.requestSubmit();
      });
    expect(writes[1]).toEqual({ verb: 'resolve', body: { note: 'Ledger checked' } });
    expect(writes).toHaveLength(2);
    release();
    await expect(page.getByRole('status').filter({ hasText: s.word('saved') })).toBeVisible();
    await s.open();
    await expect(s.dialog().getByText('Ledger checked', { exact: true })).toBeVisible();
    await expect(s.button('resolve')).toHaveCount(0);
    await note.fill('  Close after checking  ');
    await s.button('close').click();
    await expect(s.dialog()).toContainText(s.word('retainedResolution'));
    await expect(s.dialog()).toContainText('Ledger checked');
    await s.confirm().click();
    await expect(page.getByRole('status').filter({ hasText: s.word('saved') })).toBeVisible();
    expect(writes[2]).toEqual({ verb: 'close', body: { note: 'Close after checking' } });
    expect(s.row().resolutionNote).toBe('Ledger checked');
  });

  test(`reconciliation links safe server feedback to the retained note (${locale})`, async ({
    page,
  }) => {
    const s = await setup(page, locale);
    const writes: unknown[] = [];
    await page.route('**/api/admin/reconciliation/items/*/resolve', (route) => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({
        status: 400,
        json: { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['note'] } },
      });
    });
    await s.open();
    const note = page.getByLabel(s.word('note'), { exact: true });
    await note.fill('  Keep this raw draft  ');
    await s.button('resolve').click();
    await s.confirm().click();
    await expect(note).toBeFocused();
    await expect(note).toHaveValue('  Keep this raw draft  ');
    await expect(note).toHaveAttribute('aria-invalid', 'true');
    const described = await note.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    await expect(page.locator(`[id="${described!.split(' ').at(-1)}"]`)).toContainText(
      s.word('invalidNote')
    );
    expect(writes).toEqual([{ note: 'Keep this raw draft' }]);
    await expect(page.getByRole('status').filter({ hasText: s.word('saved') })).toHaveCount(0);
  });

  for (const result of ['wrong-receipt', 'lost-response'] as const)
    test(`reconciliation requires exact saved-state recovery after ${result} (${locale})`, async ({
      page,
    }) => {
      const s = await setup(page, locale);
      const writes: string[] = [];
      s.readStatus(503);
      await page.route('**/api/admin/reconciliation/items/*/*', (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const verb = new URL(route.request().url()).pathname.split('/').at(-1)!;
        writes.push(verb);
        if (verb === 'resolve') {
          s.save({
            ...s.row(),
            status: 'resolved',
            resolutionNote: 'Saved original',
            resolvedByUsername: 'reviewer',
          });
          return route.fulfill(
            result === 'wrong-receipt'
              ? { json: { ...s.row(), id: paymentInvoiceId } }
              : { status: 503, json: {} }
          );
        }
        s.save({ ...s.row(), status: 'closed' });
        return route.fulfill({ json: s.row() });
      });
      await s.open();
      const note = page.getByLabel(s.word('note'), { exact: true });
      await note.fill('  Retained raw explanation  ');
      await s.button('resolve').click();
      await s.confirm().click();
      await expect(s.dialog()).toContainText(s.word('unconfirmed'));
      await expect(note).toHaveValue('  Retained raw explanation  ');
      await expect(note).toBeDisabled();
      await expect(s.button('returnToEditing')).toBeDisabled();
      await expect(s.button('reviewRetry')).toBeVisible();
      expect(s.reads).toEqual([`/api/admin/reconciliation/items/${s.row().id}`]);
      expect(writes).toEqual(['resolve']);
      s.readStatus(200);
      await s.button('reviewRetry').click();
      await expect(s.dialog()).toContainText('Saved original');
      await expect(note).toBeDisabled();
      await expect(s.button('resolve')).toBeDisabled();
      await s.button('returnToEditing').click();
      await expect(note).toBeEnabled();
      await expect(note).toHaveValue('  Retained raw explanation  ');
      await expect(s.button('resolve')).toHaveCount(0);
      await s.button('close').click();
      await expect(s.dialog()).toContainText(s.word('retainedResolution'));
      await s.confirm().click();
      await expect(page.getByRole('status').filter({ hasText: s.word('saved') })).toBeVisible();
      expect(writes).toEqual(['resolve', 'close']);
      expect(s.row().resolutionNote).toBe('Saved original');
    });

  test(`reconciliation clears private draft after an exact-read denial (${locale})`, async ({
    page,
  }) => {
    const s = await setup(page, locale);
    let writes = 0;
    s.readStatus(403);
    await page.route('**/api/admin/reconciliation/items/*/resolve', (route) => {
      writes++;
      return route.fulfill({ status: 503, json: {} });
    });
    await s.open();
    await page.getByLabel(s.word('note'), { exact: true }).fill('Private raw draft');
    await s.button('resolve').click();
    await s.confirm().click();
    await expect(s.dialog()).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(s.word('forbidden'));
    await expect(page.getByText('Private raw draft', { exact: true })).toHaveCount(0);
    expect(writes).toBe(1);
    expect(s.reads).toEqual([`/api/admin/reconciliation/items/${s.row().id}`]);
  });
}
