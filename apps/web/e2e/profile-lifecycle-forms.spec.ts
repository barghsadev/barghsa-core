import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import {
  setupTicketForms,
  initialTicket,
  ticketId,
  otherTicketId,
  profileId,
  customerActor,
} from './ticket-forms-fixture';
import {
  actualLifecyclePreview,
  actualClosurePreview,
  actualStepUp,
  lifecycleInstant,
  lifecycleJobId as jobId,
} from '../src/components/profile-lifecycle-test-fixture';
import { t } from '@barghsa/i18n/app';
import { lifecycleFormText } from '@barghsa/i18n/profile-lifecycle-forms';
import { confirmationText } from '@barghsa/i18n/confirmation';
const rawPassword = [' Raw synthetic ', '12A '].join('');
const warning = (page: Page) => page.locator('[data-sonner-toast][data-type=warning]');
const success = (page: Page) => page.locator('[data-sonner-toast][data-type=success]');
async function capture(page: Page, owner: Locator, path: string) {
  await owner.scrollIntoViewIfNeeded();
  const box = await owner.boundingBox();
  expect(box).not.toBeNull();
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, box!.x),
      y: Math.max(0, box!.y),
      width: Math.min(box!.width, page.viewportSize()!.width - Math.max(0, box!.x)),
      height: Math.min(box!.height, page.viewportSize()!.height - Math.max(0, box!.y)),
    },
  });
}
async function quality(page: Page, slot: string) {
  expect(
    (
      await new AxeBuilder({ page })
        .include(`[data-slot=${slot}]`)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
for (const locale of ['en', 'fa'] as const) {
  test(`lifecycle ${locale}: complete blockers and original customer request retry`, async ({
    page,
  }, info) => {
    await setupTicketForms(page, locale, false);
    const value = { ...actualLifecyclePreview(), profileId },
      writes: Record<string, unknown>[] = [];
    let previews = 0;
    await page.route('**/api/tickets/lifecycle-preview', (r) => {
      if (++previews === 1) return;
      return r.fulfill({ json: value });
    });
    await page.route('**/api/tickets/lifecycle-requests', async (r) => {
      const body = r.request().postDataJSON() as Record<string, unknown>;
      writes.push(body);
      if (writes.length === 1) return r.fulfill({ status: 201, json: { ticketId } });
      value.requests = [
        {
          ticketId,
          type: 'closure',
          status: 'open',
          createdAt: lifecycleInstant,
          exportJobId: null,
          exportExpiresAt: null,
        },
      ];
      return r.fulfill({
        status: 201,
        json: { ticketId, profileId, type: 'closure', created: false },
      });
    });
    await page.clock.install();
    await page.goto('/settings/privacy');
    const owner = page.locator('[data-slot=profile-lifecycle]');
    await expect.poll(() => previews).toBe(1);
    await page.clock.fastForward(15_001);
    await expect(owner.getByRole('alert')).toContainText(t('settings.privacy.error', locale));
    expect(writes).toHaveLength(0);
    await owner
      .getByRole('button', { name: lifecycleFormText('refresh', locale), exact: true })
      .click();
    await expect(
      owner.getByText(t('settings.privacy.blocker.activeOrder', locale), { exact: true })
    ).toBeVisible();
    await expect(owner.locator('li')).toHaveCount(11);
    await quality(page, 'profile-lifecycle');
    await capture(page, owner, info.outputPath('customer-blockers.png'));
    const closure = owner.getByRole('button', {
      name: t('settings.privacy.closure.action', locale),
      exact: true,
    });
    await closure.click();
    await expect(
      owner.getByText(lifecycleFormText('uncertain', locale), { exact: true })
    ).toBeVisible();
    await expect(warning(page)).toHaveText(lifecycleFormText('uncertain', locale));
    await expect(success(page)).toHaveCount(0);
    await expect(closure).toBeDisabled();
    await closure.dispatchEvent('click');
    await expect(
      owner.getByRole('button', { name: t('settings.privacy.export.action', locale), exact: true })
    ).toBeDisabled();
    expect(writes).toHaveLength(1);
    await owner
      .getByRole('button', { name: lifecycleFormText('retry', locale), exact: true })
      .click();
    await expect(owner.locator(`a[href="/tickets?ticketId=${ticketId}"]`)).toBeVisible();
    await expect(success(page)).toHaveText(confirmationText('recorded', locale));
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]).toMatchObject({ type: 'closure', locale });
    await capture(page, owner, info.outputPath('customer-confirmed.png'));
  });
  test(`lifecycle ${locale}: saved export ticket retry and confirmed live job`, async ({
    page,
  }, info) => {
    await setupTicketForms(page, locale, false);
    const value = { ...actualLifecyclePreview(), profileId };
    let creates = 0,
      exports = 0;
    await page.route('**/api/tickets/lifecycle-preview', (r) => r.fulfill({ json: value }));
    await page.route('**/api/tickets/lifecycle-requests', (r) => {
      creates++;
      return r.fulfill({
        status: 201,
        json: { ticketId, profileId, type: 'export', created: true },
      });
    });
    await page.route(`**/api/tickets/lifecycle-requests/${ticketId}/export`, (r) => {
      if (++exports <= 2) return r.fulfill({ status: 503, json: {} });
      value.requests = [
        {
          ticketId,
          type: 'export',
          status: 'open',
          createdAt: lifecycleInstant,
          exportJobId: jobId,
          exportExpiresAt: null,
        },
      ];
      return r.fulfill({ status: 202, json: { ticketId, jobId, created: false } });
    });
    await page.route(`**/api/jobs/${jobId}`, (r) =>
      r.fulfill({
        json: {
          id: jobId,
          type: 'profile-export',
          status: 'queued',
          progress_pct: 0,
          result_url: null,
          error_message: null,
          created_at: lifecycleInstant,
          started_at: null,
          completed_at: null,
        },
      })
    );
    await page.goto('/settings/privacy');
    const owner = page.locator('[data-slot=profile-lifecycle]');
    await owner
      .getByRole('button', { name: t('settings.privacy.export.action', locale), exact: true })
      .click();
    await expect(
      owner.getByText(lifecycleFormText('uncertain', locale), { exact: true })
    ).toBeVisible();
    await expect(warning(page)).toHaveText(lifecycleFormText('uncertain', locale));
    await expect(success(page)).toHaveCount(0);
    const retry = owner.getByRole('button', {
      name: lifecycleFormText('retry', locale),
      exact: true,
    });
    await retry.click();
    await expect.poll(() => exports).toBe(2);
    await expect(retry).toBeEnabled();
    await expect(warning(page)).toHaveCount(1);
    await expect(success(page)).toHaveCount(0);
    await capture(page, owner, info.outputPath('export-unconfirmed.png'));
    await retry.click();
    await expect(owner.locator(`a[href="/tickets?ticketId=${ticketId}"]`)).toBeVisible();
    await expect(owner.getByRole('progressbar')).toBeVisible();
    expect(creates).toBe(1);
    expect(exports).toBe(3);
    await expect(success(page)).toHaveText(confirmationText('recorded', locale));
    await quality(page, 'profile-lifecycle');
    await capture(page, owner, info.outputPath('export-queued.png'));
  });
  test(`lifecycle ${locale}: stalled export steps recover with the same ticket and job`, async ({
    page,
  }) => {
    await setupTicketForms(page, locale, false);
    const value = { ...actualLifecyclePreview(), profileId };
    const creates: unknown[] = [],
      held: Route[] = [];
    let exports = 0,
      statusReads = 0,
      jobRetries = 0;
    const exportPath = `/api/tickets/lifecycle-requests/${ticketId}/export`;
    await page.route('**/api/tickets/lifecycle-preview', (route) => route.fulfill({ json: value }));
    await page.route('**/api/tickets/lifecycle-requests', (route) => {
      creates.push(route.request().postDataJSON());
      if (creates.length === 1) {
        held.push(route);
        return;
      }
      return route.fulfill({
        status: 201,
        json: { ticketId, profileId, type: 'export', created: false },
      });
    });
    await page.route(`**${exportPath}`, (route) => {
      if (++exports === 1) {
        held.push(route);
        return;
      }
      value.requests = [
        {
          ticketId,
          type: 'export',
          status: 'open',
          createdAt: lifecycleInstant,
          exportJobId: jobId,
          exportExpiresAt: null,
        },
      ];
      return route.fulfill({ status: 202, json: { ticketId, jobId, created: false } });
    });
    await page.route(`**/api/jobs/${jobId}`, (route) => {
      if (++statusReads === 1) {
        held.push(route);
        return;
      }
      return route.fulfill({
        json: {
          id: jobId,
          type: 'profile-export',
          status: 'completed',
          progress_pct: 100,
          result_url: exportPath,
        },
      });
    });
    await page.route(`**/api/jobs/${jobId}/retry`, (route) => {
      jobRetries++;
      return route.fulfill({ status: 500, json: {} });
    });
    await page.goto('/settings/privacy');
    const owner = page.locator('[data-slot=profile-lifecycle]');
    const start = owner.getByRole('button', {
      name: t('settings.privacy.export.action', locale),
      exact: true,
    });
    const retry = owner.getByRole('button', {
      name: lifecycleFormText('retry', locale),
      exact: true,
    });
    await expect(start).toBeEnabled();
    await page.clock.install();
    try {
      await start.click();
      await expect.poll(() => held.length).toBe(1);
      await page.clock.fastForward(15_200);
      await expect(retry).toBeEnabled();
      expect(creates).toHaveLength(1);
      expect(exports).toBe(0);
      await expect(success(page)).toHaveCount(0);

      await retry.click();
      await expect.poll(() => held.length).toBe(2);
      expect(creates[1]).toEqual(creates[0]);
      await page.clock.fastForward(15_200);
      await expect(retry).toBeEnabled();
      expect(exports).toBe(1);
      expect(statusReads).toBe(0);

      await retry.click();
      await expect.poll(() => held.length).toBe(3);
      await page.clock.fastForward(15_200);
      const reload = owner.getByRole('button', { name: t('jobs.retryLoad', locale), exact: true });
      await expect(reload).toBeEnabled();
      await expect(owner.locator(`a[href="${exportPath}"]`)).toHaveCount(0);
      expect(statusReads).toBe(1);
      await reload.click();
      await expect(owner.locator(`a[href="${exportPath}"]`)).toBeVisible();
      expect(creates).toHaveLength(2);
      expect(exports).toBe(2);
      expect(statusReads).toBe(2);
      expect(jobRetries).toBe(0);
    } finally {
      await Promise.all(held.map((route) => route.abort().catch(() => {})));
    }
  });
  test(`lifecycle ${locale}: native staff errors and changed-review consent`, async ({
    page,
  }, info) => {
    const f = await setupTicketForms(page, locale, true);
    let reads = 0;
    const value = { ...actualClosurePreview(), ticketId, profileId, ownerUserId: customerActor };
    await page.route(`**/api/staff/tickets/${ticketId}/closure-preview`, (r) => {
      if (++reads === 1) return;
      return r.fulfill({
        json: { ...value, previewVersion: reads === 2 ? 'a'.repeat(64) : 'b'.repeat(64) },
      });
    });
    await page.clock.install();
    await page.goto('/admin/tickets?ticketId=' + ticketId);
    const owner = page.locator('[data-slot=profile-closure-review]'),
      form = owner.locator('form');
    await expect.poll(() => reads).toBe(1);
    await page.clock.fastForward(15_001);
    await expect(owner.getByRole('alert')).toContainText(t('settings.privacy.error', locale));
    await expect(form).toHaveCount(0);
    expect(f.state.closureWrites).toBe(0);
    await owner
      .getByRole('button', { name: t('tickets.closure.refresh', locale), exact: true })
      .click();
    await owner
      .getByRole('button', { name: t('tickets.closure.execute', locale), exact: true })
      .click();
    const confirmed = owner.getByRole('checkbox');
    await expect(confirmed).toHaveAttribute('aria-required', 'true');
    await expect(owner.locator('input[type=password]')).toHaveAttribute('aria-required', 'true');
    await expect(confirmed).toBeFocused();
    await expect(confirmed).toHaveAttribute('aria-invalid', 'true');
    expect(
      await confirmed.evaluate((n) =>
        (n.getAttribute('aria-describedby') ?? '')
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
      )
    ).toContain(lifecycleFormText('confirmationRequired', locale));
    expect(f.state.stepUpWrites).toBe(0);
    expect(f.state.closureWrites).toBe(0);
    await quality(page, 'profile-closure-review');
    await capture(page, owner, info.outputPath('closure-native-errors.png'));
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      const label = owner.locator('label').filter({ has: page.getByRole('checkbox') });
      const area = await label.boundingBox();
      expect(area?.width).toBeGreaterThanOrEqual(44);
      expect(area?.height).toBeGreaterThanOrEqual(44);
      await label.tap({ position: { x: 4, y: 40 } });
      await expect(confirmed).toBeChecked();
    } else {
      await confirmed.check();
    }
    await owner.locator('input[type=password]').fill(rawPassword);
    await form.dispatchEvent('submit');
    await expect(
      owner.getByText(lifecycleFormText('changed', locale), { exact: true })
    ).toBeVisible();
    expect(f.state.closureWrites).toBe(1);
    await owner
      .getByRole('button', { name: t('tickets.closure.refresh', locale), exact: true })
      .click();
    await expect(owner.getByRole('checkbox')).not.toBeChecked();
    await expect(owner.locator('input[type=password]')).toHaveValue(rawPassword);
    await form.dispatchEvent('submit');
    await expect(owner.getByRole('checkbox')).toBeFocused();
    expect(f.state.closureWrites).toBe(1);
    await capture(page, owner, info.outputPath('closure-renewed-consent.png'));
  });
  test(`lifecycle ${locale}: closure ownership and exact committed replay`, async ({
    page,
  }, info) => {
    const f = await setupTicketForms(page, locale, true),
      writes: Record<string, unknown>[] = [];
    const value = { ...actualClosurePreview(), ticketId, profileId, ownerUserId: customerActor };
    let stepUps = 0;
    const correctedPassword = rawPassword + 'corrected';
    await page.route('**/api/auth/step-up', (r) => {
      expect(r.request().postDataJSON().password).toBe(
        ++stepUps < 3 ? rawPassword : correctedPassword
      );
      if (stepUps === 2) return r.fulfill({ status: 422, json: {} });
      return r.fulfill({ json: actualStepUp() });
    });
    await page.route(`**/api/staff/tickets/${ticketId}/closure-preview`, (r) =>
      r.fulfill({ json: value })
    );
    await page.route(`**/api/staff/tickets/${ticketId}/execute-closure`, (r) => {
      writes.push(r.request().postDataJSON() as Record<string, unknown>);
      if (writes.length === 1) return r.fulfill({ json: { created: true } });
      const ticket = f.tickets.get(ticketId)!;
      ticket.privacyClosureCompletedAt = lifecycleInstant;
      ticket.status = 'closed';
      return r.fulfill({
        json: {
          ...value,
          eligible: false,
          completedAt: lifecycleInstant,
          anonymized: false,
          created: false,
          previewVersion: 'b'.repeat(64),
        },
      });
    });
    await page.goto('/admin/tickets?ticketId=' + ticketId);
    const owner = page.locator('[data-slot=profile-closure-review]');
    await owner.getByRole('checkbox').check();
    await owner.locator('input[type=password]').fill(rawPassword);
    await owner.locator('form').dispatchEvent('submit');
    await expect(
      owner.getByText(lifecycleFormText('uncertain', locale), { exact: true })
    ).toBeVisible();
    await expect(warning(page)).toHaveText(lifecycleFormText('uncertain', locale));
    await expect(success(page)).toHaveCount(0);
    const status = page.locator('[data-slot=ticket-status-form]');
    await expect(status.locator('button[type=submit]')).toBeDisabled();
    await status.dispatchEvent('submit');
    expect(f.state.writes).toHaveLength(0);
    expect(writes).toHaveLength(1);
    await quality(page, 'profile-closure-review');
    await capture(page, owner, info.outputPath('closure-unconfirmed.png'));
    await owner
      .getByRole('button', { name: lifecycleFormText('retry', locale), exact: true })
      .click();
    await expect(owner.locator('input[type=password]')).toHaveAttribute('aria-invalid', 'true');
    expect(writes).toHaveLength(1);
    await owner.locator('input[type=password]').fill(correctedPassword);
    await owner
      .getByRole('button', { name: lifecycleFormText('retry', locale), exact: true })
      .click();
    await expect.poll(() => writes.length).toBe(2);
    await expect(
      page.locator('article').getByText(t('tickets.closed', locale), { exact: true })
    ).toBeVisible();
    await expect(success(page)).toHaveText(confirmationText('recorded', locale));
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(writes[0]).toEqual({ previewVersion: 'a'.repeat(64), confirmation: 'CLOSE_PROFILE' });
    await capture(
      page,
      page.locator('[data-slot=ticket-status-form]'),
      info.outputPath('closure-confirmed.png')
    );
  });
}

for (const locale of ['en', 'fa'] as const) {
  for (const code of ['pendingExport', 'profileOwnershipChanged'] as const) {
    test(`closure blocks ${code} with owner and next step (${locale})`, async ({ page }, info) => {
      const f = await setupTicketForms(page, locale, true);
      const value = {
        ...actualClosurePreview(),
        ticketId,
        profileId,
        ownerUserId: customerActor,
        eligible: false,
      };
      value.blockers = value.blockers.map((b) => (b.code === code ? { ...b, count: 1 } : b));
      await page.route(`**/api/staff/tickets/${ticketId}/closure-preview`, (r) =>
        r.fulfill({ json: value })
      );
      await page.goto('/admin/tickets?ticketId=' + ticketId);
      const owner = page.locator('[data-slot=profile-closure-review]');
      await expect(owner).toContainText(t(`settings.privacy.blocker.${code}`, locale));
      await expect(owner).toContainText(
        t(
          code === 'pendingExport'
            ? 'settings.privacy.owner.customer'
            : 'settings.privacy.owner.privacy',
          locale
        )
      );
      await expect(owner).toContainText(
        t(
          code === 'pendingExport'
            ? 'settings.privacy.step.prepareExport'
            : 'settings.privacy.step.staffReview',
          locale
        )
      );
      await expect(
        owner.getByRole('button', { name: t('tickets.closure.execute', locale), exact: true })
      ).toHaveCount(0);
      await expect(owner.locator('input[type=password]')).toHaveCount(0);
      expect(f.state.closureWrites).toBe(0);
      expect(f.state.stepUpWrites).toBe(0);
      await quality(page, 'profile-closure-review');
      await capture(page, owner, info.outputPath(code + '-blocked.png'));
    });
  }
}

for (const locale of ['en', 'fa'] as const) {
  test(`closed profile keeps its support and export request references without an active profile (${locale})`, async ({
    page,
  }) => {
    const f = await setupTicketForms(page, locale, false);
    f.tickets.set(ticketId, initialTicket(ticketId, false));
    f.tickets.set(otherTicketId, initialTicket(otherTicketId, false));
    const closed = f.tickets.get(ticketId)!;
    closed.category = 'privacy';
    closed.privacyRequestType = 'closure';
    closed.status = 'closed';
    closed.privacyClosureCompletedAt = lifecycleInstant;
    closed.privacyClosureAnonymized = false;
    closed.privacyClosureRetained = { wallets: 1 };
    closed.privacyClosureExportTicketId = otherTicketId;
    await page.route('**/api/profiles', (r) =>
      r.fulfill({ json: { profiles: [], activeProfileId: null, hasDefault: false } })
    );
    await page.route(`**/api/tickets/${otherTicketId}`, (r) =>
      r.fulfill({
        json: {
          ...f.tickets.get(otherTicketId),
          category: 'privacy',
          privacyRequestType: 'export',
        },
      })
    );
    await page.goto('/tickets?ticketId=' + ticketId);
    const article = page.locator('article');
    await expect(article).toContainText(t('tickets.closure.completed', locale));
    await expect(article).toContainText(t('tickets.closure.supportHistory', locale));
    await expect(article).toContainText(t('tickets.closure.consequences', locale));
    const reference = article.getByRole('link', {
      name: t('tickets.closure.export', locale) + ' · ' + otherTicketId,
      exact: true,
    });
    await expect(reference).toHaveAttribute('href', '/tickets?ticketId=' + otherTicketId);
    await reference.click();
    await expect(page).toHaveURL('/tickets?ticketId=' + otherTicketId);
    await expect(page.locator('article')).toContainText('Other ticket source');
    expect(f.state.closureWrites).toBe(0);
  });
}
