import type { Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { t } from '@barghsa/i18n/app';
import { tSolar } from '@barghsa/i18n/solar';
import { setupSolarDocumentForms } from './solar-document-review-form-fixture';

test.use({ viewport: { width: 390, height: 844 } });

async function focusedError(field: Locator) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /-message/);
}

for (const locale of ['en', 'fa'] as const)
  for (const theme of ['light', 'dark'] as const)
    test(`solar document review forms preserve drafts and captured commands (${locale}, ${theme})`, async ({
      page,
    }, info) => {
      const copy = (key: string) => tSolar(key, locale);
      const { state, firstSolar } = await setupSolarDocumentForms(page, locale, theme === 'dark');
      await page.goto('/admin/solar-requests');
      await page.getByRole('button', { name: /First solar buyer/ }).click();
      const documents = page.getByRole('group', { name: copy('staffDocuments'), exact: true });
      const guidance = page.getByRole('group', { name: copy('documentGuidance'), exact: true });
      const reason = page.locator('#solar-review-reason');
      const fa = page.locator('#solar-guidance-fa');
      const en = page.locator('#solar-guidance-en');
      const suggestionsFa = page.locator('#solar-guidance-fa-suggestions');
      const suggestionsEn = page.locator('#solar-guidance-en-suggestions');
      const reject = documents.getByRole('button', { name: copy('reject'), exact: true });
      const additional = documents.getByRole('button', {
        name: copy('requestAdditional'),
        exact: true,
      });
      const save = guidance.getByRole('button', { name: copy('saveGuidance'), exact: true });
      await expect(reason).toBeVisible();

      // Intent-specific limits: rejection is bounded at 1000; the same control
      // still supports the full 2000-character additional-document instruction.
      await reason.fill('ر'.repeat(1001));
      await reject.click();
      await focusedError(reason);
      expect(state.rejectWrites).toEqual([]);
      await reason.fill('ر'.repeat(1000));
      await reject.click();
      let dialog = page.getByRole('dialog', { name: copy('reject'), exact: true });
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      await focusedError(reason);
      await expect(reason).toHaveValue('ر'.repeat(1000));
      expect(state.rejectWrites).toEqual([{ expectedRevision: 7, reason: 'ر'.repeat(1000) }]);

      // Paired suggestions and server-owned errors stay with their controls;
      // unrelated document work and valid guidance text remain intact.
      await fa.fill('  راهنمای پیشنهادی  ');
      await en.fill('  Draft English guidance  ');
      await suggestionsFa.fill('مدرک اول\nمدرک دوم');
      await suggestionsEn.fill('First document');
      await save.click();
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.id))
        .toMatch(/^solar-guidance-(fa|en)-suggestions$/);
      expect(state.guidanceWrites).toEqual([]);
      await expect(fa).toHaveValue('  راهنمای پیشنهادی  ');
      await expect(reason).toHaveValue('ر'.repeat(1000));
      await suggestionsEn.fill('First document\nSecond document');
      state.guidanceMode = 'owned';
      await save.click();
      dialog = page.getByRole('dialog', { name: copy('saveGuidance'), exact: true });
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      await focusedError(suggestionsEn);
      await expect(en).toHaveValue('  Draft English guidance  ');
      await expect(suggestionsFa).toHaveValue('مدرک اول\nمدرک دوم');
      await expect(reason).toHaveValue('ر'.repeat(1000));
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
      await expect(reason).toHaveValue('ر'.repeat(1000));

      state.rejectMode = 'protected';
      const captured = { expectedRevision: 7, reason: 'Captured solar rejection' };
      await reason.fill(captured.reason);
      await reject.click();
      dialog = page.getByRole('dialog', { name: copy('reject'), exact: true });
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
      await expect(reason).toBeVisible();

      await reason.fill('د'.repeat(2000));
      state.previewMode = 'owned';
      await additional.click();
      await focusedError(reason);
      await expect(reason).toHaveValue('د'.repeat(2000));
      expect(state.previews.at(-1)).toEqual({
        decision: 'request_additional',
        description: 'د'.repeat(2000),
      });
      expect(state.additionalWrites).toEqual([]);
      state.previewMode = 'success';
      await additional.click();
      dialog = page.getByRole('dialog', { name: copy('requestAdditional'), exact: true });
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      expect(state.additionalWrites).toEqual([
        { description: 'د'.repeat(2000), expectedReviewHash: 'a'.repeat(64) },
      ]);
      await expect(reason).toBeVisible();
      await reason.fill('Independent document draft');

      expect(
        (await new AxeBuilder({ page }).include('[role="group"]').analyze()).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      for (const control of await page
        .locator('[role="group"] input, [role="group"] textarea, [role="group"] button')
        .all()) {
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

      // Losing catalogue-write permission must not erase independently
      // authorized document review work or turn its draft into a new command.
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
      await expect(reason).toHaveValue('Independent document draft');
      await expect(reason).toBeEnabled();
      expect(state.rejectWrites.slice(1)).toEqual([captured, captured]);
      expect(state.additionalWrites).toHaveLength(1);
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
    await page.getByRole('button', { name: /First solar buyer/ }).click();
    const reason = page.locator('#solar-review-reason');
    const guidance = page.getByRole('group', { name: copy('documentGuidance'), exact: true });
    const en = page.locator('#solar-guidance-en');
    const save = guidance.getByRole('button', { name: copy('saveGuidance'), exact: true });
    const reload = page.locator('#solar-guidance-reload');
    await reason.fill('Keep selected review work');
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
    await expect(reason).toHaveValue('Keep selected review work');
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
    await expect(reason).toHaveValue('Keep selected review work');

    // A preview completed for an obsolete selection cannot become a command.
    state.previewMode = 'held';
    const additional = page.getByRole('button', { name: copy('requestAdditional'), exact: true });
    await additional.click();
    await expect.poll(() => !!state.preview).toBe(true);
    await page.getByRole('button', { name: /Older solar buyer/ }).click();
    await expect.poll(() => state.detailReads.at(-1)).toBe(olderSolar);
    await state.preview!.fulfill({ json: reviewFor(state.previews.at(-1)!) });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.additionalWrites).toEqual([]);
    expect(state.previews.at(-1)).toMatchObject({ description: 'Keep selected review work' });
    expect(state.detailReads).toContain(firstSolar);
    await expect(en).toHaveValue('New confirmed guidance');

    // Document authority can be revoked independently of catalogue editing.
    await page.getByRole('button', { name: /First solar buyer/ }).click();
    await expect(reason).toBeVisible();
    await reason.fill('Document permission denied');
    state.rejectMode = 'denied';
    await page.getByRole('button', { name: copy('reject'), exact: true }).click();
    dialog = page.getByRole('dialog', { name: copy('reject'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(reason).toHaveCount(0);
    await expect(en).toHaveValue('New confirmed guidance');
    await expect(en).toBeEnabled();
    expect(state.rejectWrites).toEqual([
      { expectedRevision: 7, reason: 'Document permission denied' },
    ]);
    expect(state.additionalWrites).toEqual([]);
  });
