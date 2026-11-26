import type { Locator, Page } from '@playwright/test';

export async function selectAddressLocation(page: Page, field: Locator, name: string) {
  await field.click();
  await field.fill(name);
  await page.getByRole('option', { name, exact: true }).click();
}
