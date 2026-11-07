import { test, expect, type Route } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { setupSolarPostalForms } from './solar-postal-form-fixture';
import { increaseRow, increaseReview } from '../src/test/electricity-change-fixtures';
import { tSolar } from '@barghsa/i18n/solar';
import { t as adminText } from '@barghsa/i18n/admin-ui';

for (const locale of ['en', 'fa'] as const) {
  test(`stalled solar final preview keeps the draft and requires a fresh review (${locale})`, async ({
    page,
  }) => {
    const copy = (key: string) => tSolar(key, locale);
    const { state, finalReview } = await setupSolarPostalForms(page, locale, locale === 'fa');
    await page.clock.install();
    try {
      await page.goto('/admin/solar-postal');
      await page.getByRole('button', { name: /Older solar buyer/ }).click();
      const prepare = page.getByRole('button', { name: copy('solarCloseNoContract'), exact: true });
      const reason = page.locator('#solar-postal-reason');
      const draft = 'Close the request after checking the recorded reason';
      const expected = { decision: 'close-no-contract', reason: draft };
      await reason.fill(draft);
      await prepare.click();
      await expect.poll(() => !!state.finalPreview).toBe(true);
      await expect(prepare).toHaveAttribute('aria-busy', 'true');

      await page.clock.fastForward(15_200);
      const error = page.getByRole('alert').filter({ hasText: copy('postalError') });
      await expect(error).toBeVisible();
      await expect(prepare).toBeEnabled();
      await expect(reason).toHaveValue(draft);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(state.finalPreviews).toEqual([expected]);
      expect(state.finalWrites).toEqual([]);

      await state.finalPreview!.fulfill({ json: finalReview(expected) }).catch(() => {});
      await expect(error).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      state.finalPreviewMode = 'success';
      await prepare.click();
      const confirmation = page.getByRole('dialog', { name: copy('solarCloseNoContract') });
      await expect(confirmation).toContainText(draft);
      expect(state.finalPreviews).toEqual([expected, expected]);
      expect(state.finalWrites).toEqual([]);
    } finally {
      await state.finalPreview?.abort().catch(() => {});
    }
  });

  test(`stalled electricity increase preview keeps the draft and submits no decision (${locale})`, async ({
    page,
  }) => {
    const copy = (key: string) => adminText(`admin.electricityIncreases.${key}`, locale);
    await crmShell(page, locale);
    await page.route(
      (url) => url.pathname === '/api/staff/electricity/increase-requests',
      (route) => route.fulfill({ json: { requests: [increaseRow], nextBefore: null } })
    );
    const previews: unknown[] = [];
    const decisions: unknown[] = [];
    let held: Route | undefined;
    const reviewPacket = (input: { reason: string }) => {
      const packet = increaseReview('reject');
      packet.data.reason = input.reason;
      return packet;
    };
    await page.route('**/increase-requests/*/reject/review', (route) => {
      const input = route.request().postDataJSON() as { reason: string };
      previews.push(input);
      if (!held) {
        held = route;
        return;
      }
      return route.fulfill({ json: reviewPacket(input) });
    });
    await page.route('**/increase-requests/*/reject', (route) => {
      decisions.push(route.request().postDataJSON());
      return route.fulfill({ status: 409, json: {} });
    });
    await page.clock.install();
    try {
      await page.goto('/admin/electricity-increases');
      const reason = page.locator('#increase-reason-' + increaseRow.requestId);
      const prepare = page.getByRole('button', { name: copy('reject'), exact: true });
      const draft = 'Capacity cannot be increased on this request';
      const expected = { reason: draft };
      await reason.fill(draft);
      await prepare.click();
      await expect.poll(() => !!held).toBe(true);
      await expect(prepare).toHaveAttribute('aria-busy', 'true');

      await page.clock.fastForward(15_200);
      const error = page.getByRole('alert').filter({ hasText: copy('reviewError') });
      await expect(error).toBeVisible();
      await expect(prepare).toBeEnabled();
      await expect(reason).toHaveValue(draft);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(previews).toEqual([expected]);
      expect(decisions).toEqual([]);

      await held!.fulfill({ json: reviewPacket(expected) }).catch(() => {});
      await expect(error).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await prepare.click();
      await expect(page.getByRole('dialog')).toContainText(draft);
      expect(previews).toEqual([expected, expected]);
      expect(decisions).toEqual([]);
    } finally {
      await held?.abort().catch(() => {});
    }
  });
}
