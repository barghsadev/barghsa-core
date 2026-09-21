import { feedbackText } from '@barghsa/i18n/feedback';
import { expect, type Page } from '@playwright/test';

export async function dismissMessages(page: Page, locale: 'en' | 'fa') {
  const close = page.getByRole('button', { name: feedbackText('close', locale), exact: true });
  // Use the accessible close control, including when stacked notices cover each other.
  while (await close.count()) {
    const count = await close.count();
    await close.first().press('Enter');
    await expect(close).toHaveCount(count - 1);
  }
}
