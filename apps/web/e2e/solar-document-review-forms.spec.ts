import type { Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { t } from '@barghsa/i18n/app';
import { tSolar } from '@barghsa/i18n/solar';
import { tSolarStaffRecord } from '@barghsa/i18n/solar-staff-record';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { setupSolarDocumentForms } from './solar-document-review-form-fixture';
import { approveRiskConfirmation } from './confirmation-fixture';

async function openGuidance(
  page: Parameters<typeof setupSolarDocumentForms>[0],
  locale: 'en' | 'fa'
) {
  await page
    .getByRole('link', { name: tSolarStaffRecord('editDocumentGuidance', locale), exact: true })
    .click();
  await expect(page).toHaveURL('/admin/solar-requests/guidance');
}

async function leaveGuidance(
  page: Parameters<typeof setupSolarDocumentForms>[0],
  locale: 'en' | 'fa'
) {
  await page
    .getByRole('link', { name: tSolarStaffRecord('backToRequests', locale), exact: true })
    .click();
}

test.use({ viewport: { width: 390, height: 844 } });

async function focusedError(field: Locator) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /-message/);
}

const decisionSubmit = (page: Parameters<typeof setupSolarDocumentForms>[0]) =>
  page.locator('main form button[type="submit"]');

function decisionBack(page: Parameters<typeof setupSolarDocumentForms>[0], locale: 'en' | 'fa') {
  return page.getByRole('link', {
    name: tSolarStaffRecord('backToDocumentReview', locale),
    exact: true,
  });
}

for (const locale of ['en', 'fa'] as const)
  for (const theme of ['light', 'dark'] as const)
    test(`solar document review forms preserve drafts and captured commands (${locale}, ${theme})`, async ({
      page,
    }, info) => {
      const copy = (key: string) => tSolar(key, locale);
      const { state, firstSolar } = await setupSolarDocumentForms(page, locale, theme === 'dark');
      await page.goto('/admin/solar-requests');
      await openGuidance(page, locale);
      const guidance = page.getByRole('group', { name: copy('documentGuidance'), exact: true });
      const reason = page.locator('#solar-review-reason');
      const fa = guidance.getByLabel(copy('guidanceFa'), { exact: true });
      const en = guidance.getByLabel(copy('guidanceEn'), { exact: true });
      const add = guidance.getByRole('button', {
        name: tSolarStaffRecord('guidanceAddDocument', locale),
        exact: true,
      });
      await add.click();
      const suggestionsFa = page.locator('#solar-guidance-item-0-fa');
      const suggestionsEn = page.locator('#solar-guidance-item-0-en');
      const secondFa = page.locator('#solar-guidance-item-1-fa');
      const secondEn = page.locator('#solar-guidance-item-1-en');
      await expect(locale === 'fa' ? suggestionsFa : suggestionsEn).toBeFocused();
      const reject = page.getByRole('link', { name: copy('reject'), exact: true });
      const additional = page.getByRole('link', {
        name: copy('requestAdditional'),
        exact: true,
      });
      const save = guidance.getByRole('button', { name: copy('saveGuidance'), exact: true });
      for (const field of [fa, en]) await expect(field).toHaveAttribute('aria-required', 'true');
      for (const field of [suggestionsFa, suggestionsEn])
        await expect(field).toHaveAttribute('aria-required', 'true');

      // Paired suggestions and server-owned errors stay with their controls.
      await fa.fill('  راهنمای پیشنهادی  ');
      await en.fill('  Draft English guidance  ');
      await suggestionsFa.fill('مدرک اول');
      await add.click();
      await secondFa.fill('مدرک دوم');
      await suggestionsEn.fill('First document');
      await save.click();
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.id))
        .toBe('solar-guidance-item-1-en');
      expect(state.guidanceWrites).toEqual([]);
      await expect(fa).toHaveValue('  راهنمای پیشنهادی  ');
      await secondEn.fill('Second document');
      await add.click();
      await guidance
        .getByRole('button', {
          name: tSolarStaffRecord('guidanceRemoveDocument', locale).replace(
            '{number}',
            new Intl.NumberFormat(locale).format(3)
          ),
          exact: true,
        })
        .click();
      await expect(page.locator('#solar-guidance-item-2-en')).toHaveCount(0);
      state.guidanceMode = 'owned';
      await save.click();
      let dialog = page.getByRole('dialog', { name: copy('saveGuidance'), exact: true });
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      await focusedError(suggestionsEn);
      await expect(en).toHaveValue('  Draft English guidance  ');
      await expect(suggestionsFa).toHaveValue('مدرک اول');
      await expect(secondFa).toHaveValue('مدرک دوم');
      const proposal = {
        fa: 'راهنمای پیشنهادی',
        en: 'Draft English guidance',
        suggestions: [
          { fa: 'مدرک اول', en: 'First document' },
          { fa: 'مدرک دوم', en: 'Second document' },
        ],
      };
      expect(state.guidanceWrites).toEqual([proposal]);
      state.guidanceMode = 'success';
      const readsBeforeGuidance = state.detailReads.length;
      await save.click();
      dialog = page.getByRole('dialog', { name: copy('saveGuidance'), exact: true });
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      await expect(fa).toHaveValue(proposal.fa);
      expect(state.guidanceWrites).toEqual([proposal, proposal]);
      expect(state.detailReads).toHaveLength(readsBeforeGuidance);

      // Losing catalogue-write permission still leaves the case link available.
      state.guidanceMode = 'denied';
      await en.fill('Denied guidance draft');
      await save.click();
      dialog = page.getByRole('dialog', { name: copy('saveGuidance'), exact: true });
      await dialog.locator('button[type=submit]').click();
      const cancel = dialog.getByRole('button', { name: t('team.cancel', locale), exact: true });
      await expect(cancel).toBeEnabled();
      await expect(dialog.locator('button[type=submit]')).toBeDisabled();
      await cancel.click();
      await expect(dialog).toHaveCount(0);
      await expect(guidance).toContainText(copy('documentGuidanceForbidden'));
      await expect(en).toHaveValue('Denied guidance draft');
      await expect(en).toBeDisabled();
      await leaveGuidance(page, locale);
      await page.getByRole('link', { name: /First solar buyer/ }).click();
      await expect(reason).toHaveCount(0);
      await expect(guidance).toHaveCount(0);
      await page.goto(
        `/admin/solar-requests/${firstSolar}/reject/88888888-0000-4000-8000-000000000001`
      );
      await expect(page.getByText(tSolarStaffRecord('decisionUnavailable', locale))).toBeVisible();
      await expect(decisionSubmit(page)).toHaveCount(0);
      await decisionBack(page, locale).click();
      await reject.click();
      await expect(page).toHaveURL(`/admin/solar-requests/${firstSolar}/reject/${firstSolar}`);
      await page.reload();
      await expect(reason).toBeVisible();
      const submit = decisionSubmit(page);

      await reason.fill('ر'.repeat(1001));
      await submit.click();
      await focusedError(reason);
      expect(state.rejectWrites).toEqual([]);
      await reason.fill('ر'.repeat(1000));
      await submit.click();
      dialog = page.getByRole('dialog', { name: copy('reject'), exact: true });
      await expect(dialog.locator('button[type=submit]')).toBeDisabled();
      await approveRiskConfirmation(page, locale, 'destructive');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      await focusedError(reason);
      await expect(reason).toHaveValue('ر'.repeat(1000));
      expect(state.rejectWrites).toEqual([{ expectedRevision: 7, reason: 'ر'.repeat(1000) }]);

      state.rejectMode = 'protected';
      const captured = { expectedRevision: 7, reason: 'Captured solar rejection' };
      await reason.fill(captured.reason);
      await submit.click();
      dialog = page.getByRole('dialog', { name: copy('reject'), exact: true });
      await expect(dialog.getByText(captured.reason, { exact: true })).toBeVisible();
      await approveRiskConfirmation(page, locale, 'destructive');
      await dialog.locator('button[type=submit]').click();
      await dialog.locator('input[type=password]').fill('synthetic-password');
      const readsBeforeRejection = state.detailReads.length;
      await dialog.locator('button[type=submit]').click();
      await expect.poll(() => !!state.stepUp).toBe(true);
      await expect(dialog.locator('button[type=submit]')).toBeDisabled();
      await dialog.locator('form').dispatchEvent('submit');
      expect(state.verifications).toBe(1);
      expect(state.rejectWrites).toHaveLength(2);
      state.verified = true;
      await state.stepUp!.fulfill({ json: { verified: true } });
      await expect(dialog).toHaveCount(0);
      expect(state.rejectWrites.slice(1)).toEqual([captured, captured]);
      await expect.poll(() => state.detailReads.length).toBeGreaterThan(readsBeforeRejection);
      await expect(reason).toHaveCount(0);
      await expect(submit).toHaveCount(0);
      await decisionBack(page, locale).click();
      await expect(page).toHaveURL(`/admin/solar-requests/${firstSolar}`);
      await additional.click();
      await expect(page).toHaveURL(`/admin/solar-requests/${firstSolar}/request-additional`);

      await reason.fill('د'.repeat(2000));
      state.previewMode = 'owned';
      await submit.click();
      await focusedError(reason);
      await expect(reason).toHaveValue('د'.repeat(2000));
      expect(state.previews.at(-1)).toEqual({
        decision: 'request_additional',
        description: 'د'.repeat(2000),
      });
      expect(state.additionalWrites).toEqual([]);
      state.previewMode = 'success';
      await submit.click();
      dialog = page.getByRole('dialog', { name: copy('requestAdditional'), exact: true });
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      expect(state.additionalWrites).toEqual([
        { description: 'د'.repeat(2000), expectedReviewHash: 'a'.repeat(64) },
      ]);
      await expect(reason).toHaveCount(0);
      await decisionBack(page, locale).click();
      await additional.click();
      await reason.fill('Independent document draft');

      expect((await new AxeBuilder({ page }).include('main form').analyze()).violations).toEqual(
        []
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      for (const control of await page.locator('main form :is(input, textarea, button)').all()) {
        const bounds = await control.boundingBox();
        if (bounds) {
          expect(bounds.x).toBeGreaterThanOrEqual(0);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
        }
      }
      if (
        (locale === 'en' && theme === 'light' && info.project.name === 'chromium') ||
        (locale === 'fa' && theme === 'dark' && info.project.name === 'mobile-safari')
      )
        await page.screenshot({
          path: info.outputPath(`solar-review-forms-${locale}-${theme}-${info.project.name}.png`),
          fullPage: true,
        });

      expect(state.detailReads.at(-1)).toBe(firstSolar);
    });

for (const [locale, theme, invalidReceipt] of [
  ['en', 'light', 'malformed'],
  ['fa', 'dark', 'mismatch'],
] as const)
  test(`solar guidance rejects unsafe fields and unverified receipts (${locale}, ${theme})`, async ({
    page,
  }) => {
    const copy = (key: string) => tSolar(key, locale);
    const { state, firstSolar, olderSolar, reviewFor } = await setupSolarDocumentForms(
      page,
      locale,
      theme === 'dark'
    );
    await page.goto('/admin/solar-requests');
    await openGuidance(page, locale);
    const reason = page.locator('#solar-review-reason');
    const guidance = page.getByRole('group', { name: copy('documentGuidance'), exact: true });
    const en = page.locator('#solar-guidance-en');
    const save = guidance.getByRole('button', { name: copy('saveGuidance'), exact: true });
    const reload = page.locator('#solar-guidance-reload');
    await en.fill('Keep this guidance draft');
    state.guidanceMode = 'unsafe';
    await save.click();
    let dialog = page.getByRole('dialog', { name: copy('saveGuidance'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog).not.toContainText('PRIVATE_HASH_FIELD');
    await expect(en).toHaveValue('Keep this guidance draft');
    await expect(en).not.toHaveAttribute('aria-invalid', 'true');
    await expect(
      dialog.getByRole('button', { name: t('team.cancel', locale), exact: true })
    ).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    state.guidanceMode = invalidReceipt;
    await save.click();
    dialog = page.getByRole('dialog', { name: copy('saveGuidance'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(
      dialog.getByRole('button', { name: t('team.cancel', locale), exact: true })
    ).toBeEnabled();
    await expect(dialog.locator('button[type=submit]')).toBeDisabled();
    await expect(en).toHaveValue('Keep this guidance draft');
    const uncertainWrites = state.guidanceWrites.length;
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.guidanceWrites).toHaveLength(uncertainWrites);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(guidance).toContainText(copy('documentGuidanceUnconfirmed'));
    await expect(save).toBeDisabled();
    state.guidanceReadMode = 'unavailable';
    const readsBeforeReload = state.guidanceReads;
    await reload.click();
    await expect.poll(() => state.guidanceReads).toBeGreaterThan(readsBeforeReload);
    await expect(guidance.getByRole('alert').first()).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(en).toHaveValue('Keep this guidance draft');
    state.guidanceReadMode = 'success';
    await reload.click();
    await expect(save).toBeEnabled();
    await expect(en).toHaveValue('Keep this guidance draft');
    expect(state.guidanceWrites).toHaveLength(uncertainWrites);
    state.guidanceMode = 'success';
    await en.fill('New confirmed guidance');
    await save.click();
    dialog = page.getByRole('dialog', { name: copy('saveGuidance'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(en).toHaveValue('New confirmed guidance');

    // A preview completed for an obsolete selection cannot become a command.
    await leaveGuidance(page, locale);
    await page.getByRole('link', { name: /First solar buyer/ }).click();
    const additional = page.getByRole('link', { name: copy('requestAdditional'), exact: true });
    await additional.click();
    await reason.fill('Keep selected review work');
    const back = page.getByRole('link', {
      name: tSolarStaffRecord('backToRequests', locale),
      exact: true,
    });
    state.previewMode = 'held';
    await decisionSubmit(page).click();
    await expect.poll(() => !!state.preview).toBe(true);
    await decisionBack(page, locale).click();
    await back.click();
    await page.getByRole('link', { name: /Older solar buyer/ }).click();
    await expect.poll(() => state.detailReads.at(-1)).toBe(olderSolar);
    await state.preview!.fulfill({ json: reviewFor(state.previews.at(-1)!) });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.additionalWrites).toEqual([]);
    expect(state.previews.at(-1)).toMatchObject({ description: 'Keep selected review work' });
    expect(state.detailReads).toContain(firstSolar);

    // Document authority can be revoked independently of catalogue editing.
    await back.click();
    await page.getByRole('link', { name: /First solar buyer/ }).click();
    await page.getByRole('link', { name: copy('reject'), exact: true }).click();
    await expect(reason).toBeVisible();
    await reason.fill('Document permission denied');
    state.rejectMode = 'denied';
    await decisionSubmit(page).click();
    dialog = page.getByRole('dialog', { name: copy('reject'), exact: true });
    await approveRiskConfirmation(page, locale, 'destructive');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(reason).toHaveCount(0);
    await decisionBack(page, locale).click();
    await back.click();
    await openGuidance(page, locale);
    await expect(en).toHaveValue('New confirmed guidance');
    await expect(en).toBeEnabled();
    expect(state.rejectWrites).toEqual([
      { expectedRevision: 7, reason: 'Document permission denied' },
    ]);
    expect(state.additionalWrites).toEqual([]);
  });

for (const locale of ['en', 'fa'] as const)
  test(`staff checks the original solar request after an unconfirmed decision (${locale})`, async ({
    page,
  }) => {
    const copy = (key: string) => tSolar(key, locale);
    const { state, firstSolar } = await setupSolarDocumentForms(page, locale, locale === 'fa');
    await page.goto('/admin/solar-requests');
    await page.getByRole('link', { name: /First solar buyer/ }).click();
    const reason = page.locator('#solar-review-reason');
    await page
      .getByRole('link', {
        name: copy('requestAdditional'),
        exact: true,
      })
      .click();
    const editor = page.locator('main form');
    const additional = decisionSubmit(page);
    const draft = 'Upload the corrected roof plan';
    await reason.fill(draft);
    state.previewMode = 'mismatch';
    await additional.click();
    await expect(page.getByRole('alert').filter({ hasText: copy('documentError') })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.additionalWrites).toEqual([]);
    await expect(reason).toHaveValue(draft);
    state.previewMode = 'success';
    state.additionalMode = 'mismatch';
    await additional.click();
    const dialog = page.getByRole('dialog', { name: copy('requestAdditional'), exact: true });
    const confirm = dialog.locator('button[type=submit]');
    const success = page
      .locator('[data-sonner-toast][data-type="success"]')
      .filter({ hasText: confirmationText('recorded', locale) });
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(confirm).toBeDisabled();
    await expect(reason).toHaveValue(draft);
    await expect(success).toHaveCount(0);
    await expect(dialog).not.toContainText('PRIVATE_BAD_RECEIPT');
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.additionalWrites).toEqual([
      { description: draft, expectedReviewHash: 'a'.repeat(64) },
    ]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(editor).toContainText(copy('documentDecisionUnconfirmed'));
    await expect(additional).toBeDisabled();
    const back = decisionBack(page, locale);
    await expect(back).toHaveAttribute('aria-disabled', 'true');
    state.detailMode = 'wrong-request';
    await editor.getByRole('button', { name: copy('documentDecisionReload'), exact: true }).click();
    const failedRead = page.getByRole('alert').filter({ hasText: copy('staffDetailLoadError') });
    await expect(failedRead).toBeVisible();
    await expect(success).toHaveCount(0);
    expect(state.additionalWrites).toHaveLength(1);
    state.detailMode = 'success';
    await failedRead.getByRole('button', { name: copy('retry'), exact: true }).click();
    await expect(editor).toContainText(copy('status_changes_requested'));
    await expect(additional).toHaveCount(0);
    await expect(reason).toHaveCount(0);
    await expect(success).toBeVisible();
    await expect(back).not.toHaveAttribute('aria-disabled', 'true');
    await back.click();
    await expect(page.getByText(draft, { exact: true })).toBeVisible();
    expect(state.detailReads.at(-1)).toBe(firstSolar);
    expect(state.additionalWrites).toHaveLength(1);
    await expect(
      page.locator('[data-sonner-toaster]').getByText('PRIVATE_BAD_RECEIPT')
    ).toHaveCount(0);
  });
