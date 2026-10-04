import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { tSolar } from '@barghsa/i18n/solar';
import { t } from '@barghsa/i18n/app';
import {
  setupSolarOperationForms,
  trackingReview,
  constructionReview,
  progressWithNotes,
} from './solar-operation-form-fixture';
import { olderSolar } from '../src/test/solar-staff-fixtures';
import { constructionRequest, constructionOlder } from '../src/test/solar-progress-fixtures';

async function focusedError(field: Locator) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /-description.*-message/);
}
async function inspectForm(page: Page, form: Locator, selector: string) {
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const field of await form.locator('input,textarea,button').all()) {
    const bounds = await field.boundingBox();
    if (bounds) {
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
  }
}
async function closeSettled(dialog: Locator, locale: 'en' | 'fa') {
  const cancel = dialog.getByRole('button', { name: t('team.cancel', locale), exact: true });
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(dialog).toHaveCount(0);
}

for (const [locale, theme] of [
  ['en', 'light'],
  ['fa', 'dark'],
] as const) {
  const copy = (key: string) => tSolar(key, locale);
  test(`solar tracking validates, preserves captured review and proves uncertain saves (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, persistTracking } = await setupSolarOperationForms(
      page,
      locale,
      theme === 'dark'
    );
    const manifest = JSON.parse(
      await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
    );
    let releaseSchema!: () => void;
    const heldSchema = new Promise<void>((resolve) => {
      releaseSchema = resolve;
    });
    await page.route(
      '**/' + manifest['src/lib/solar-tracking-form-schemas.ts'].file,
      async (route) => {
        await heldSchema;
        await route.continue();
      }
    );
    await page.goto('/admin/solar-postal');
    await page.getByRole('button', { name: /First solar buyer/ }).click();
    const region = page.getByRole('region', { name: copy('postalTrackingUpdate'), exact: true });
    const form = region.locator('form');
    const note = page.locator('#postal-tracking-note');
    const url = page.locator('#postal-tracking-url');
    const review = region.getByRole('button', { name: copy('postalTrackingReview'), exact: true });
    const reload = region.getByRole('button', { name: copy('postalTrackingReload'), exact: true });
    await expect(note).toBeVisible();
    await url.fill('http://private.local/path');
    await review.click();
    await expect(review).toBeDisabled();
    await form.dispatchEvent('submit');
    await form.dispatchEvent('submit');
    expect(state.trackingPreviews).toEqual([]);
    releaseSchema();
    await focusedError(url);
    const rawUrl = 'https://Courier.Example:443/parcel#shipment';
    await url.fill(rawUrl);
    await note.fill('ن'.repeat(1001));
    await review.click();
    await focusedError(note);
    expect(state.trackingPreviews).toEqual([]);
    await note.fill('ن'.repeat(1000));
    await review.click();
    await focusedError(url);
    expect(state.trackingPreviews).toHaveLength(1);
    expect(state.trackingPreviews[0]).toMatchObject({
      trackingUrl: 'https://courier.example/parcel#shipment',
      note: 'ن'.repeat(1000),
    });
    await expect(note).toHaveValue('ن'.repeat(1000));
    await note.fill('  Captured <script> parcel note  ');
    state.trackingReviewMode = 'unsafe';
    await review.click();
    await expect.poll(() => state.trackingPreviews.length).toBe(2);
    await expect(region).toContainText(copy('postalTrackingSaveError'));
    await expect(review).toBeEnabled();
    await expect(region).not.toContainText('PRIVATE_REVIEW_HASH');
    await expect(region).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
    await expect(url).toHaveValue(rawUrl);
    await expect(note).toHaveValue('  Captured <script> parcel note  ');
    await inspectForm(page, form, '[aria-label="' + copy('postalTrackingUpdate') + '"]');
    await region.screenshot({
      path: info.outputPath(`solar-tracking-form-${locale}-${theme}.png`),
    });

    state.trackingReviewMode = 'held';
    await region.getByRole('button', { name: copy('postalClearEstimate'), exact: true }).click();
    await review.click();
    await expect.poll(() => !!state.trackingPreview).toBe(true);
    const captured = state.trackingPreviews.at(-1)!;
    expect(captured).toMatchObject({
      estimatedArrivalDate: null,
      trackingUrl: 'https://courier.example/parcel#shipment',
      note: 'Captured <script> parcel note',
      expectedRevision: 0,
    });
    expect(captured.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    const beforePreviewDuplicate = state.trackingPreviews.length;
    await form.dispatchEvent('submit');
    expect(state.trackingPreviews).toHaveLength(beforePreviewDuplicate);
    await state.trackingPreview!.fulfill({ json: trackingReview(state.tracking, captured) });
    let dialog = page.getByRole('dialog', { name: copy('postalTrackingReviewTitle'), exact: true });
    await expect(dialog).toContainText(captured.note as string);
    await expect(note).toBeDisabled();
    state.requireStepUp = true;
    await dialog.locator('button[type=submit]').click();
    await dialog.locator('input[type=password]').fill('synthetic-password');
    await dialog.locator('button[type=submit]').click();
    await expect.poll(() => !!state.stepUp).toBe(true);
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.verifications).toBe(1);
    state.verified = true;
    await state.stepUp!.fulfill({ json: { verified: true } });
    await expect.poll(() => !!state.trackingWrite).toBe(true);
    const command = { ...captured, expectedReviewHash: 'a'.repeat(64) };
    expect(state.trackingWrites).toEqual([command, command]);
    const readsDuringTrackingWrite = state.trackingReads.length;
    const lockedReload = page.locator('#postal-tracking-reload');
    await expect(lockedReload).toBeDisabled();
    await lockedReload.dispatchEvent('click');
    await page.locator('#postal-tracking-form').dispatchEvent('submit');
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.trackingWrites).toHaveLength(2);
    expect(state.trackingReads).toHaveLength(readsDuringTrackingWrite);
    await state.trackingWrite!.fulfill({
      json: { ...state.tracking, profileId: olderSolar, revision: 1 },
    });
    await expect(
      dialog.getByRole('button', { name: t('team.cancel', locale), exact: true })
    ).toBeEnabled();
    await closeSettled(dialog, locale);
    await expect(region).toContainText(copy('postalTrackingUnconfirmed'));
    await expect(review).toBeDisabled();
    await expect(note).toHaveValue('  Captured <script> parcel note  ');
    const oldReads = state.trackingReads.length;
    await reload.click();
    await expect.poll(() => state.trackingReads.length).toBeGreaterThan(oldReads);
    await expect(review).toBeDisabled();
    await expect(note).toHaveValue('  Captured <script> parcel note  ');
    expect(state.trackingWrites).toHaveLength(2);
    persistTracking();
    await reload.click();
    await expect(region.getByText(copy('postalTrackingUnconfirmed'), { exact: true })).toHaveCount(
      0
    );
    await expect(note).toHaveValue('Captured <script> parcel note');
    expect(state.trackingWrites).toHaveLength(2);
    await expect(region.locator('script,img')).toHaveCount(0);

    // A prepared command is still bound to its original selected parcel.
    await note.fill('PRIVATE_OLD_PARCEL_DRAFT');
    state.trackingPreview = undefined;
    await review.click();
    await expect.poll(() => !!state.trackingPreview).toBe(true);
    const late = state.trackingPreviews.at(-1)!;
    const lateSnapshot = structuredClone(state.tracking);
    await page.getByRole('button', { name: /Older solar buyer/ }).click();
    await expect(note).toHaveValue('Other parcel note');
    await note.fill('PRIVATE_NEW_PARCEL_DRAFT');
    await state.trackingPreview!.fulfill({ json: trackingReview(lateSnapshot, late) });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(note).toHaveValue('PRIVATE_NEW_PARCEL_DRAFT');
    await expect(region).not.toContainText('PRIVATE_OLD_PARCEL_DRAFT');
    state.trackingReviewMode = 'success';
    state.trackingWriteMode = 'denied';
    await review.click();
    dialog = page.getByRole('dialog', { name: copy('postalTrackingReviewTitle'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(region).toHaveCount(0);
    await expect(page.locator('#admin-content')).not.toContainText('PRIVATE_NEW_PARCEL_DRAFT');
    await expect(page.locator('#admin-content')).not.toContainText('OTHER-PARCEL');
    expect(state.trackingWrites.at(-1)).toMatchObject({
      note: 'PRIVATE_NEW_PARCEL_DRAFT',
      expectedReviewHash: 'a'.repeat(64),
    });
  });

  test(`solar construction validates notes and verifies captured milestone recovery (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, persistProgress } = await setupSolarOperationForms(
      page,
      locale,
      theme === 'dark'
    );
    await page.goto(`/admin/solar-construction?requestId=${constructionRequest}`);
    const form = page.getByRole('form', { name: copy('constructionReviewTitle'), exact: true });
    const note = page.locator('#solar-construction-note');
    const review = page.getByRole('button', { name: copy('constructionReview'), exact: true });
    const reload = page.locator('#solar-construction-recovery-reload');
    await note.fill('ک'.repeat(1001));
    await review.click();
    await focusedError(note);
    expect(state.progressPreviews).toEqual([]);
    await note.fill('ک'.repeat(1000));
    await review.click();
    await focusedError(note);
    expect(state.progressPreviews[0]).toMatchObject({
      stage: 'in_progress',
      note: 'ک'.repeat(1000),
      expectedRevision: 0,
    });
    await expect(note).toHaveValue('ک'.repeat(1000));
    await note.fill('  Captured <img> verified milestone  ');
    state.progressReviewMode = 'unsafe';
    await review.click();
    await expect.poll(() => state.progressPreviews.length).toBe(2);
    await expect(page.getByText(copy('constructionSaveError'), { exact: true })).toBeVisible();
    await expect(review).toBeEnabled();
    await expect(form).not.toContainText('PRIVATE_OPERATION_ID');
    await expect(form).not.toContainText('PRIVATE_SERVER_VALIDATION_TEXT');
    await expect(note).toHaveValue('  Captured <img> verified milestone  ');
    await inspectForm(page, form, '[aria-label="' + copy('constructionReviewTitle') + '"]');
    await form.screenshot({
      path: info.outputPath(`solar-construction-form-${locale}-${theme}.png`),
    });

    state.progressReviewMode = 'held';
    await review.click();
    await expect.poll(() => !!state.progressPreview).toBe(true);
    const captured = state.progressPreviews.at(-1)!;
    expect(captured).toMatchObject({
      stage: 'in_progress',
      note: 'Captured <img> verified milestone',
      expectedRevision: 0,
    });
    expect(captured.operationId).toMatch(/^[0-9a-f-]{36}$/);
    const beforeDuplicate = state.progressPreviews.length;
    await form.dispatchEvent('submit');
    await form.dispatchEvent('submit');
    expect(state.progressPreviews).toHaveLength(beforeDuplicate);
    await state.progressPreview!.fulfill({ json: constructionReview(state.progress, captured) });
    let dialog = page.getByRole('dialog', { name: copy('constructionReviewTitle'), exact: true });
    await expect(dialog).toContainText(captured.note as string);
    await expect(note).toBeDisabled();
    await dialog.locator('button[type=submit]').click();
    await expect.poll(() => !!state.progressWrite).toBe(true);
    const command = { ...captured, expectedReviewHash: 'b'.repeat(64) };
    expect(state.progressWrites).toEqual([command]);
    const readsDuringProgressWrite = state.progressReads.length;
    const lockedReload = page.locator('#solar-construction-reload');
    await expect(lockedReload).toBeDisabled();
    await lockedReload.dispatchEvent('click');
    await page
      .getByRole('form', {
        name: copy('constructionReviewTitle'),
        exact: true,
        includeHidden: true,
      })
      .dispatchEvent('submit');
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.progressWrites).toHaveLength(1);
    expect(state.progressReads).toHaveLength(readsDuringProgressWrite);
    await state.progressWrite!.fulfill({
      json: { ...progressWithNotes([String(captured.note)]), requestId: constructionOlder },
    });
    await expect(
      dialog.getByRole('button', { name: t('team.cancel', locale), exact: true })
    ).toBeEnabled();
    await expect(dialog.locator('button[type=submit]')).toBeDisabled();
    await closeSettled(dialog, locale);
    await expect(page.getByText(copy('progressActionUnconfirmed'), { exact: true })).toBeVisible();
    await expect(review).toBeDisabled();
    await expect(note).toHaveValue('  Captured <img> verified milestone  ');
    const oldReads = state.progressReads.length;
    await reload.click();
    await expect.poll(() => state.progressReads.length).toBeGreaterThan(oldReads);
    await expect(review).toBeDisabled();
    await expect(note).toHaveValue('  Captured <img> verified milestone  ');
    state.progress = progressWithNotes(['A different recorded milestone']);
    await reload.click();
    await expect(review).toBeDisabled();
    await expect(note).toHaveValue('  Captured <img> verified milestone  ');
    state.progress = progressWithNotes([]);
    persistProgress();
    await reload.click();
    await expect(page.getByText(copy('progressActionUnconfirmed'), { exact: true })).toHaveCount(0);
    await expect(note).toHaveValue('');
    await expect(page.locator('[data-slot=status-timeline]')).toContainText(String(captured.note));
    expect(state.progressWrites).toEqual([command]);
    await expect(
      page.locator('[data-slot=status-timeline] script,[data-slot=status-timeline] img')
    ).toHaveCount(0);

    state.progressPreview = undefined;
    await note.fill('PRIVATE_OLD_CONSTRUCTION_DRAFT');
    await review.click();
    await expect.poll(() => !!state.progressPreview).toBe(true);
    const late = state.progressPreviews.at(-1)!;
    const lateSnapshot = structuredClone(state.progress);
    await page.getByRole('button', { name: /702/ }).click();
    await expect(note).toHaveValue('');
    await note.fill('PRIVATE_NEW_CONSTRUCTION_DRAFT');
    await state.progressPreview!.fulfill({ json: constructionReview(lateSnapshot, late) });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(note).toHaveValue('PRIVATE_NEW_CONSTRUCTION_DRAFT');
    await expect(page.locator('#admin-content')).not.toContainText(
      'PRIVATE_OLD_CONSTRUCTION_DRAFT'
    );
    state.progressReviewMode = 'success';
    state.progressWriteMode = 'denied';
    await review.click();
    dialog = page.getByRole('dialog', { name: copy('constructionReviewTitle'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(note).toHaveCount(0);
    await expect(page.getByRole('button', { name: /701|702/ })).toHaveCount(0);
    await expect(page.locator('#admin-content')).not.toContainText(
      'PRIVATE_NEW_CONSTRUCTION_DRAFT'
    );
    expect(state.progressWrites.at(-1)).toMatchObject({
      note: 'PRIVATE_NEW_CONSTRUCTION_DRAFT',
      expectedReviewHash: 'b'.repeat(64),
    });
  });
}
