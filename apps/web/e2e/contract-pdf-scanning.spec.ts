import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';
import { en, fa } from '../../../packages/i18n/src/contracts';
import {
  setupContractAuthoring,
  draftContractId,
  draftVersionId,
} from './contract-authoring-form-fixture';

for (const locale of ['en', 'fa'] as const) {
  test(`generated PDF displays pending file checks without claiming review submission (${locale})`, async ({
    page,
  }, testInfo) => {
    const words = locale === 'fa' ? fa : en;
    const fixture = await setupContractAuthoring(page, locale, false);
    fixture.acceptCurrent();
    fixture.versions.get(draftVersionId)!.content.template = {
      name: 'Saved electricity agreement',
      text: 'Exact accepted terms',
    };
    const attempts: unknown[] = [];
    await page.route(
      `**/api/admin/contracts/${draftContractId}/versions/${draftVersionId}/generate-pdf`,
      (route) => {
        attempts.push(route.request().postDataJSON());
        return route.fulfill({ status: 201, json: { id: 'generated-pdf', state: 'PendingScan' } });
      }
    );
    await page.goto(`/admin/contracts?contractId=${draftContractId}`);
    const documents = page.getByRole('region', { name: words.documents, exact: true });
    const generate = documents.getByRole('button', {
      name: words.generateContractPdf,
      exact: true,
    });
    await generate.focus();
    await page.keyboard.press('Enter');
    await expect(
      documents.getByRole('status').filter({ hasText: words.contractPdfScanning })
    ).toHaveText(words.contractPdfScanning);
    await expect(documents.getByText(words.contractPdfSubmitted, { exact: true })).toHaveCount(0);
    await expect(generate).toBeDisabled();
    expect(attempts).toEqual([{ idempotencyKey: draftVersionId }]);
    expect(
      (
        await new AxeBuilder({ page })
          .include('section[aria-label="' + words.documents + '"]')
          .analyze()
      ).violations
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
    await documents.screenshot({ path: testInfo.outputPath('contract-pdf-pending.png') });
  });
}
