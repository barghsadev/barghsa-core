import { fullNavigation } from './navigation-fixture';
import { test, expect, type Page } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { crmShell } from './crm-shell-fixture';
import { tSolar } from '@barghsa/i18n/solar';
import { t } from '@barghsa/i18n/app';
import {
  constructionProgress,
  constructionRow,
  constructionRequest,
  constructionOlder,
  constructionContract,
  constructionProfile,
  constructionStages,
} from '../src/test/solar-progress-fixtures';
import { solarGuidance } from '../src/test/solar-staff-fixtures';
import { constructionReview, progressWithNotes } from './solar-operation-form-fixture';
const base = '/api/admin/solar/construction';
const scope = (page: Page, key: string, locale: 'en' | 'fa') =>
  page.getByRole('region', { name: tSolar(key, locale) });
for (const locale of ['en', 'fa'] as const) {
  const copy = (key: string) => tSolar(key, locale);
  test(`${locale}: staff records ordered progress with step-up and exact lost-response retry, then the customer sees dated evidence`, async ({
    page,
  }, info) => {
    await crmShell(page, locale);
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
    let revision = 0,
      needsStepUp = true,
      lost = true;
    const writes: Array<Record<string, unknown>> = [],
      previews: Array<Record<string, unknown>> = [];
    const saved = new Map<string, Record<string, unknown>>();
    const savedProgress = () =>
      progressWithNotes([...saved.values()].map((body) => String(body.note)));
    await page.route(
      (url) => url.pathname === base,
      (r) =>
        r.fulfill({
          json: {
            items: [
              { ...constructionRow(), revision, stage: constructionStages[revision - 1] ?? null },
            ],
            nextBefore: null,
          },
        })
    );
    await page.route(
      (url) => url.pathname === `${base}/${constructionRequest}`,
      async (r) => {
        if (r.request().method() === 'GET') return r.fulfill({ json: savedProgress() });
        const body = r.request().postDataJSON() as Record<string, unknown>;
        writes.push(body);
        if (needsStepUp) return r.fulfill({ status: 403, json: { requiresStepUp: true } });
        const operation = String(body.operationId);
        if (!saved.has(operation)) {
          expect(body.stage).toBe(constructionStages[revision]);
          expect(body.expectedRevision).toBe(revision);
          saved.set(operation, body);
          revision++;
        } else expect(body).toEqual(saved.get(operation));
        if (lost) {
          lost = false;
          return r.fulfill({ status: 503, json: {} });
        }
        return r.fulfill({ json: savedProgress() });
      }
    );
    await page.route(
      (url) => url.pathname === `${base}/${constructionRequest}/review`,
      (r) => {
        const body = r.request().postDataJSON() as Record<string, unknown>;
        previews.push(body);
        return r.fulfill({ json: constructionReview(savedProgress(), body) });
      }
    );
    await page.route('**/api/auth/step-up', (r) => {
      expect(r.request().postDataJSON()).toEqual({ password: 'test-only-password' });
      needsStepUp = false;
      return r.fulfill({ json: { verified: true } });
    });
    await page.goto(`/admin/solar-construction?requestId=${constructionRequest}`);
    await expect(
      page.getByRole('heading', { name: copy('constructionStaffTitle'), exact: true })
    ).toBeVisible();
    const progress = scope(page, 'constructionTitle', locale);
    await expect(progress.locator('[data-slot=progress-stepper]>li')).toHaveCount(6);
    for (const [index, stage] of constructionStages.entries()) {
      await page
        .getByLabel(copy('constructionNote'), { exact: true })
        .fill(`Verified <script> work ${index}`);
      await page.getByRole('button', { name: copy('constructionReview'), exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(copy(`construction_${stage}`));
      await expect(dialog).toContainText(copy('constructionReviewDescription'));
      await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
      if (index === 0) {
        await dialog
          .getByLabel(t('team.password', locale), { exact: true })
          .fill('test-only-password');
        await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
        await expect(dialog.getByRole('alert')).toBeVisible();
        const cancel = dialog.getByRole('button', { name: t('team.cancel', locale), exact: true });
        await expect(cancel).toBeEnabled();
        await cancel.click();
        await expect(dialog).toHaveCount(0);
        await page.getByRole('button', { name: copy('progressRetryCommand'), exact: true }).click();
        await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
      }
      await expect(dialog).toHaveCount(0);
      await expect(progress.locator('[data-slot=status-timeline]>li')).toHaveCount(index + 1);
    }
    expect(previews).toHaveLength(3);
    expect(saved.size).toBe(3);
    await expect(progress).toContainText(t('history.context.staff', locale));
    expect(writes[0]).toEqual(writes[1]);
    expect(writes[1]).toEqual(writes[2]);
    await expect(page.getByText(copy('constructionDone'), { exact: true })).toBeVisible();
    await expect(page.getByLabel(copy('constructionNote'), { exact: true })).toHaveCount(0);
    await expect(progress.locator('[aria-current=step]')).toHaveCount(0);
    await expect(progress.locator('script,img')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    await page.route('**/api/auth/user', (r) =>
      r.fulfill({
        json: {
          userId: 'buyer',
          isStaff: false,
          operatingContext: 'customer',
          navigation: fullNavigation('customer'),
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/profiles', (r) =>
      r.fulfill({
        json: {
          profiles: [{ id: constructionProfile, profileType: 'INDIVIDUAL', title: 'Solar buyer' }],
          activeProfileId: constructionProfile,
          hasDefault: true,
        },
      })
    );
    await page.route(`**/api/solar/requests/${constructionRequest}`, (r) =>
      r.fulfill({
        json: {
          request: {
            id: constructionRequest,
            profile_id: constructionProfile,
            status: 'contract_created',
            status_reason: null,
            support_path: null,
            contract_id: constructionContract,
            contract_published: true,
            initial_invoice_id: null,
            initial_invoice_state: null,
            building_type: 'building_apartment',
            grid_type: 'off_grid',
            agreement_version: 'fixture-v1',
            agreement_snapshot: 'Accepted terms',
            agreement_accepted_at: '2026-09-20T23:00:00.000Z',
            submitted_at: '2026-09-20T23:00:00.000Z',
          },
          progress: savedProgress(),
          history: [],
        },
      })
    );
    await page.route(`**/api/solar/requests/${constructionRequest}/postal`, (r) =>
      r.fulfill({
        json: {
          guidance: solarGuidance,
          requestStatus: 'contract_created',
          postal: {
            status: 'received',
            courier: 'Post',
            tracking_number: 'TRACK-1',
            send_date: '2026-09-23',
            receipt_image_id: null,
            staff_notes: null,
          },
        },
      })
    );
    await page.goto(`/solar/requests/${constructionRequest}`);
    await expect(
      scope(page, 'constructionTitle', locale).locator(
        '[data-slot=progress-stepper]>li[data-state=complete]'
      )
    ).toHaveCount(6);
    await expect(
      scope(page, 'constructionTitle', locale).locator('[data-slot=status-timeline]>li')
    ).toHaveCount(3);
    await expect(
      scope(page, 'constructionTitle', locale)
        .locator('time[datetime="2026-09-26T23:00:00.000Z"]')
        .first()
    ).toBeVisible();
    await expect(page.getByLabel(copy('constructionNote'), { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    await scope(page, 'constructionTitle', locale).screenshot({
      path: info.outputPath(`solar-progress-${locale}.png`),
    });
  });
  test(`${locale}: queue retry retains accepted rows, URL search/cursors restore, and read-only staff cannot record`, async ({
    page,
  }) => {
    await crmShell(page, locale);
    let fail = true;
    const reads: URL[] = [];
    await page.route(
      (url) => url.pathname === base,
      (r) => {
        const url = new URL(r.request().url());
        reads.push(url);
        if (url.searchParams.get('before') === constructionRequest && fail)
          return r.fulfill({ status: 503, json: {} });
        const id = url.searchParams.has('before') ? constructionOlder : constructionRequest;
        return r.fulfill({
          json: {
            items: [constructionRow(id)],
            nextBefore: id === constructionRequest ? constructionRequest : null,
          },
        });
      }
    );
    await page.route(
      (url) => url.pathname === `${base}/${constructionRequest}`,
      (r) => r.fulfill({ json: { ...constructionProgress(), canRecord: false } })
    );
    await page.goto(`/admin/solar-construction?requestId=${constructionRequest}&q=701`);
    await expect(page.getByRole('button', { name: /701/ })).toBeVisible();
    await expect(page.getByText(copy('constructionBlocked'), { exact: true })).toBeVisible();
    await expect(page.getByLabel(copy('constructionNote'), { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: copy('moreRequests'), exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(copy('staffQueueLoadError'));
    await expect(page.getByRole('button', { name: /701/ })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('cursor')).toBe(constructionRequest);
    fail = false;
    await page.getByRole('button', { name: copy('retry'), exact: true }).click();
    await expect(page.getByRole('button', { name: /702/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: /702/ })).toBeVisible();
    await page.getByLabel(copy('constructionSearch'), { exact: true }).fill(' 702 ');
    await expect
      .poll(() => JSON.parse(new URL(page.url()).searchParams.get('q') ?? 'null'))
      .toBe('702');
    await expect.poll(() => new URL(page.url()).searchParams.has('cursor')).toBe(false);
    expect(new URL(page.url()).searchParams.get('requestId')).toBe(constructionRequest);
    expect(
      reads.some((url) => url.searchParams.get('q') === '702' && !url.searchParams.has('before'))
    ).toBe(true);
  });
  test(`${locale}: changed selection suppresses late preview, and a denied queue suppresses late private detail`, async ({
    page,
  }) => {
    await crmShell(page, locale);
    let denied = false,
      holdDetail = false;
    let releasePreview: () => void = () => {};
    const heldPreview = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    let releaseDetail: () => void = () => {};
    const heldDetail = new Promise<void>((resolve) => {
      releaseDetail = resolve;
    });
    await page.route(
      (url) => url.pathname === base,
      (r) =>
        denied
          ? r.fulfill({ status: 403, json: {} })
          : r.fulfill({
              json: {
                items: [constructionRow(), constructionRow(constructionOlder)],
                nextBefore: constructionRequest,
              },
            })
    );
    await page.route(
      (url) => url.pathname === `${base}/${constructionRequest}`,
      async (r) => {
        if (holdDetail) await heldDetail;
        return r.fulfill({ json: constructionProgress() });
      }
    );
    await page.route(
      (url) => url.pathname === `${base}/${constructionOlder}`,
      (r) => r.fulfill({ json: constructionProgress(0, constructionOlder) })
    );
    await page.route(
      (url) => url.pathname === `${base}/${constructionRequest}/review`,
      async (r) => {
        const body = r.request().postDataJSON();
        await heldPreview;
        return r.fulfill({ json: constructionReview(constructionProgress(), body) });
      }
    );
    await page.goto(`/admin/solar-construction?requestId=${constructionRequest}`);
    await page.getByLabel(copy('constructionNote'), { exact: true }).fill('Private draft');
    const reviewed = page.waitForRequest((url) => url.url().endsWith('/review'));
    await page.getByRole('button', { name: copy('constructionReview'), exact: true }).click();
    await reviewed;
    await page.getByRole('button', { name: /702/ }).click();
    await expect(page.getByLabel(copy('constructionNote'), { exact: true })).toHaveValue('');
    const latePreview = page.waitForResponse((response) => response.url().endsWith('/review'));
    releasePreview();
    await (await latePreview).finished();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    holdDetail = true;
    const requested = page.waitForRequest(
      (url) => new URL(url.url()).pathname === `${base}/${constructionRequest}`
    );
    await page.getByRole('button', { name: /701/ }).click();
    await requested;
    denied = true;
    await page.getByRole('button', { name: copy('moreRequests'), exact: true }).click();
    await expect(page.getByRole('alert').first()).toContainText(copy('staffQueueForbidden'));
    const lateDetail = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `${base}/${constructionRequest}`
    );
    releaseDetail();
    await (await lateDetail).finished();
    await expect(page.getByRole('region', { name: copy('constructionTitle') })).toHaveCount(0);
    await expect(page.getByLabel(copy('constructionNote'), { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /701|702/ })).toHaveCount(0);
  });
}
