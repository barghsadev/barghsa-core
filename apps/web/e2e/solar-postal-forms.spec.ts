import type { Locator, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { t } from '@barghsa/i18n/app';
import { tSolar } from '@barghsa/i18n/solar';
import { postalReceipt, setupSolarPostalForms } from './solar-postal-form-fixture';

test.use({ viewport: { width: 390, height: 844 } });
const settings = [
  ['en', 'light'],
  ['fa', 'dark'],
] as const;

async function focusedError(field: Locator) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /-message/);
}
async function inspectForm(page: Page, scope: Locator, selector: string) {
  expect((await new AxeBuilder({ page }).include(selector).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const field of await scope.locator('input,textarea,select,button').all()) {
    const bounds = await field.boundingBox();
    if (bounds) {
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
    }
  }
}

for (const [locale, theme] of settings) {
  const copy = (key: string) => tSolar(key, locale);
  test(`solar postal customer form retains captured shipment and recovers by fresh read (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, persistShipment, customerState, firstSolar, olderSolar } =
      await setupSolarPostalForms(page, locale, theme === 'dark', true);
    await page.goto(`/solar/requests/${firstSolar}`);
    const postal = page.getByRole('region', { name: copy('postalStage'), exact: true });
    const form = postal.getByRole('group', { name: copy('postalShipment'), exact: true });
    const courier = page.locator('#solar-postal-courier');
    const tracking = page.locator('#solar-postal-tracking-number');
    const date = page.locator('#solar-postal-send-date');
    const receipt = page.locator('#solar-postal-receipt-image');
    const submit = form.getByRole('button', { name: copy('postalSubmit'), exact: true });
    const reload = postal.getByRole('button', { name: copy('postalTrackingReload'), exact: true });
    await courier.fill('C'.repeat(101));
    await tracking.fill('T'.repeat(201));
    await date.fill('2026-09-23');
    await submit.click();
    await focusedError(courier);
    expect(state.shipmentWrites).toEqual([]);
    await courier.fill('C'.repeat(100));
    await tracking.fill('T'.repeat(200));
    await submit.click();
    await focusedError(tracking);
    await expect(courier).toHaveValue('C'.repeat(100));
    await expect(tracking).toHaveValue('T'.repeat(200));
    await expect(date).toHaveValue('2026-09-23');
    expect(state.shipmentWrites).toEqual([
      { courier: 'C'.repeat(100), trackingNumber: 'T'.repeat(200), sendDate: '2026-09-23' },
    ]);

    await courier.fill('  Captured courier  ');
    await tracking.fill('  CAPTURED-TRACKING  ');
    await receipt.selectOption(postalReceipt);
    await inspectForm(page, form, '[aria-label="' + copy('postalStage') + '"]');
    if (locale === 'en' && info.project.name === 'chromium')
      await postal.screenshot({ path: info.outputPath('solar-postal-customer-en-light.png') });
    const captured = {
      courier: 'Captured courier',
      trackingNumber: 'CAPTURED-TRACKING',
      sendDate: '2026-09-23',
      receiptImageId: postalReceipt,
    };
    state.shipmentMode = 'held';
    await submit.click();
    await expect.poll(() => !!state.shipment).toBe(true);
    await expect(submit).toBeDisabled();
    await expect(courier).toBeDisabled();
    await expect(tracking).toBeDisabled();
    await form.locator('form').dispatchEvent('submit');
    await form.locator('form').dispatchEvent('submit');
    expect(state.shipmentWrites).toHaveLength(2);
    expect(state.shipmentWrites[1]).toEqual(captured);
    persistShipment();
    await state.shipment!.fulfill({ status: 503, json: {} });
    await expect(postal.getByRole('alert').first()).toBeVisible();
    await expect(reload).toBeEnabled();
    await expect(submit).toBeDisabled();
    await expect(courier).toHaveValue('  Captured courier  ');
    await expect(tracking).toHaveValue('  CAPTURED-TRACKING  ');
    state.customerReadMode = 'mismatch';
    const beforeRecovery = state.customerReads.length;
    await reload.click();
    await expect.poll(() => state.customerReads.length).toBeGreaterThan(beforeRecovery);
    await expect(postal.getByRole('alert').first()).toBeVisible();
    await expect(submit).toBeDisabled();
    await expect(tracking).toHaveValue('  CAPTURED-TRACKING  ');
    expect(state.shipmentWrites).toHaveLength(2);
    state.customerReadMode = 'success';
    await reload.click();
    await expect(form).toHaveCount(0);
    await expect(postal).toContainText(captured.courier);
    await expect(postal).toContainText(captured.trackingNumber);
    expect(state.shipmentWrites).toHaveLength(2);

    // A read from the old request cannot overwrite a new request's private draft.
    state.customerReadMode = 'held';
    await reload.click();
    await expect.poll(() => !!state.customerRead).toBe(true);
    state.customerReadMode = 'success';
    await page.goto(`/solar/requests/${olderSolar}`);
    await expect(courier).toBeVisible();
    await expect(courier).toHaveValue('');
    await courier.fill('PRIVATE_NEW_SCOPE_DRAFT');
    await state.customerRead!.fulfill({
      json: {
        ...customerState(firstSolar),
        postal: { ...customerState(firstSolar).postal, courier: 'PRIVATE_OLD_SCOPE_COURIER' },
      },
    });
    await expect(courier).toHaveValue('PRIVATE_NEW_SCOPE_DRAFT');
    await expect(postal).not.toContainText('PRIVATE_OLD_SCOPE_COURIER');
    state.customerReadMode = 'denied';
    await reload.click();
    await expect(postal.getByRole('alert').first()).toBeVisible();
    await expect(courier).toHaveCount(0);
    await expect(postal).not.toContainText('Original postal guidance');
    await expect(postal).not.toContainText('راهنمای ارسال اصل مدارک');
    await expect(postal).not.toContainText('PRIVATE_NEW_SCOPE_DRAFT');
    await expect(postal).not.toContainText(captured.trackingNumber);
    expect(state.shipmentWrites).toHaveLength(2);
  });

  test(`solar postal staff forms keep independent drafts through receipt recovery and protected decisions (${locale}, ${theme})`, async ({
    page,
  }, info) => {
    const { state, finalReview } = await setupSolarPostalForms(page, locale, theme === 'dark');
    await page.goto('/admin/solar-postal');
    await page.getByRole('button', { name: /First solar buyer/ }).click();
    const reason = page.locator('#solar-postal-reason');
    const guidance = page.getByRole('group', { name: copy('postalGuidance'), exact: true });
    const en = page.locator('#solar-postal-guidance-en');
    const fa = page.locator('#solar-postal-guidance-fa');
    const originalsFa = page.locator('#solar-postal-guidance-originals-fa');
    const originalsEn = page.locator('#solar-postal-guidance-originals-en');
    const address = page.locator('#solar-postal-guidance-destination-address');
    const contact = page.locator('#solar-postal-guidance-contact-details');
    const save = guidance.getByRole('button', { name: copy('postalSaveGuidance'), exact: true });
    const reload = page.locator('#solar-postal-guidance-reload');
    await reason.fill('Independent postal issue draft');
    await en.fill('  Captured postal guidance  ');
    await fa.fill('  راهنمای جدید ارسال مدارک  ');
    await address.fill('  Destination draft  ');
    await contact.fill('  Contact draft  ');
    await originalsFa.fill('اصل اول\nاصل دوم');
    await originalsEn.fill('First original');
    await save.click();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id))
      .toMatch(/^solar-postal-guidance-originals-(fa|en)$/);
    expect(state.guidanceWrites).toEqual([]);
    await expect(reason).toHaveValue('Independent postal issue draft');
    await originalsEn.fill('First original\nSecond original');
    await save.click();
    let dialog = page.getByRole('dialog', { name: copy('postalSaveGuidance'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await focusedError(originalsEn);
    await expect(reason).toHaveValue('Independent postal issue draft');
    await expect(en).toHaveValue('  Captured postal guidance  ');
    const capturedGuidance = {
      fa: 'راهنمای جدید ارسال مدارک',
      en: 'Captured postal guidance',
      destinationAddress: 'Destination draft',
      contactDetails: 'Contact draft',
      originals: [
        { fa: 'اصل اول', en: 'First original' },
        { fa: 'اصل دوم', en: 'Second original' },
      ],
    };
    expect(state.guidanceWrites).toEqual([capturedGuidance]);
    state.guidanceMode = 'unsafe';
    await save.click();
    dialog = page.getByRole('dialog', { name: copy('postalSaveGuidance'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog).not.toContainText('PRIVATE_REVIEW_HASH');
    await expect(originalsEn).not.toHaveAttribute('aria-invalid', 'true');
    let cancel = dialog.getByRole('button', { name: t('team.cancel', locale), exact: true });
    await expect(cancel).toBeEnabled();
    await cancel.click();
    await expect(dialog).toHaveCount(0);
    state.guidanceMode = 'mismatch';
    await save.click();
    dialog = page.getByRole('dialog', { name: copy('postalSaveGuidance'), exact: true });
    await dialog.locator('button[type=submit]').click();
    cancel = dialog.getByRole('button', { name: t('team.cancel', locale), exact: true });
    await expect(cancel).toBeEnabled();
    await expect(dialog.locator('button[type=submit]')).toBeDisabled();
    const uncertainWrites = state.guidanceWrites.length;
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.guidanceWrites).toHaveLength(uncertainWrites);
    await cancel.click();
    await expect(dialog).toHaveCount(0);
    await expect(save).toBeDisabled();
    await expect(en).toHaveValue('  Captured postal guidance  ');
    await expect(reason).toHaveValue('Independent postal issue draft');
    state.guidanceReadMode = 'unavailable';
    const beforeReload = state.guidanceReads;
    await reload.click();
    await expect.poll(() => state.guidanceReads).toBeGreaterThan(beforeReload);
    await expect(save).toBeDisabled();
    await expect(en).toHaveValue('  Captured postal guidance  ');
    state.guidanceReadMode = 'success';
    await reload.click();
    await expect(save).toBeEnabled();
    expect(state.guidanceWrites).toHaveLength(uncertainWrites);
    await expect(reason).toHaveValue('Independent postal issue draft');
    state.guidanceMode = 'success';
    const beforeGuidanceSave = state.queueReads;
    await save.click();
    dialog = page.getByRole('dialog', { name: copy('postalSaveGuidance'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(en).toHaveValue(capturedGuidance.en);
    expect(state.guidanceWrites.at(-1)).toEqual(capturedGuidance);
    expect(state.queueReads).toBe(beforeGuidanceSave);
    await expect(reason).toHaveValue('Independent postal issue draft');
    const shipment = page.getByRole('group', { name: copy('postalShipment'), exact: true });
    await inspectForm(
      page,
      guidance.or(shipment),
      `[aria-label="${copy('postalGuidance')}"], [aria-label="${copy('postalShipment')}"]`
    );
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await guidance.screenshot({ path: info.outputPath('solar-postal-staff-fa-dark.png') });

    const incomplete = page.getByRole('button', {
      name: copy('postal_mark-incomplete'),
      exact: true,
    });
    await reason.fill('ر'.repeat(1001));
    await incomplete.click();
    await focusedError(reason);
    expect(state.postalPreviews).toEqual([]);
    await reason.fill('ر'.repeat(1000));
    await incomplete.click();
    await focusedError(reason);
    await expect(reason).toHaveValue('ر'.repeat(1000));
    expect(state.postalPreviews).toEqual([{ decision: 'incomplete', reason: 'ر'.repeat(1000) }]);
    expect(state.postalWrites).toEqual([]);
    state.postalPreviewMode = 'success';
    await incomplete.click();
    dialog = page.getByRole('dialog', { name: copy('postal_mark-incomplete'), exact: true });
    const capturedIssue = { reason: 'ر'.repeat(1000), expectedReviewHash: 'a'.repeat(64) };
    await dialog.locator('button[type=submit]').click();
    await dialog.locator('input[type=password]').fill('synthetic-password');
    const beforeIssue = state.queueReads;
    await dialog.locator('button[type=submit]').click();
    await expect.poll(() => !!state.stepUp).toBe(true);
    await expect(dialog.locator('button[type=submit]')).toBeDisabled();
    await dialog.locator('form').dispatchEvent('submit');
    expect(state.verifications).toBe(1);
    expect(state.postalWrites).toEqual([capturedIssue]);
    state.verified = true;
    await state.stepUp!.fulfill({ json: { verified: true } });
    await expect(dialog).toHaveCount(0);
    expect(state.postalWrites).toEqual([capturedIssue, capturedIssue]);
    await expect.poll(() => state.queueReads).toBeGreaterThan(beforeIssue);
    await expect(en).toHaveValue(capturedGuidance.en);

    await page.getByRole('button', { name: /Older solar buyer/ }).click();
    const close = page.getByRole('button', { name: copy('solarCloseNoContract'), exact: true });
    await reason.fill('ف'.repeat(1001));
    await close.click();
    await focusedError(reason);
    expect(state.finalPreviews).toEqual([]);
    await reason.fill('ف'.repeat(1000));
    await close.click();
    await expect.poll(() => !!state.finalPreview).toBe(true);
    await page.getByRole('button', { name: /First solar buyer/ }).click();
    await expect(close).toHaveCount(0);
    await state.finalPreview!.fulfill({ json: finalReview(state.finalPreviews.at(-1)!) });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.finalWrites).toEqual([]);
    await page.getByRole('button', { name: /Older solar buyer/ }).click();
    await reason.fill('ف'.repeat(1000));
    state.finalPreviewMode = 'success';
    await close.click();
    dialog = page.getByRole('dialog', { name: copy('solarCloseNoContract'), exact: true });
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    expect(state.finalPreviews.at(-1)).toEqual({
      decision: 'close-no-contract',
      reason: 'ف'.repeat(1000),
    });
    expect(state.finalWrites).toEqual([
      { reason: 'ف'.repeat(1000), expectedReviewHash: 'b'.repeat(64) },
    ]);
    await expect(page.getByRole('button', { name: /Older solar buyer/ })).toHaveCount(0);
    expect(state.finalClosed).toBe(true);
    await expect(en).toHaveValue(capturedGuidance.en);
  });
}
