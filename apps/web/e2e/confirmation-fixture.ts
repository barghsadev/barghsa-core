import type { Page } from '@playwright/test';
import { confirmationText } from '@barghsa/i18n/confirmation';

export async function approveRiskConfirmation(
  page: Page,
  locale: 'en' | 'fa',
  kind: 'financial' | 'destructive' | 'both'
) {
  if (kind !== 'destructive') {
    await page
      .getByRole('checkbox', { name: confirmationText('acknowledge', locale), exact: true })
      .check();
  }
  if (kind !== 'financial') {
    await page
      .getByLabel(confirmationText('typePhrase', locale), { exact: true })
      .fill(confirmationText('phrase', locale));
  }
}
