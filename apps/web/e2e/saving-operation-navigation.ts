import type { Page } from '@playwright/test';
import { tSavingOperations } from '@barghsa/i18n/saving-operations';
import type { SavingOperationRoute } from '../src/lib/saving-operation-route';

export function savingOperationLink(
  page: Page,
  operation: SavingOperationRoute | 'installation-address' | 'hardware' | 'cancel-upgrade',
  upgradeId?: string
) {
  const path = `/${operation}${upgradeId ? '/' + upgradeId : ''}`;
  return page.locator(`main a[href$="${path}"], main a[href*="${path}?"]`);
}

export function backToSavingOrder(page: Page, locale: 'en' | 'fa') {
  return page.getByRole('link', { name: tSavingOperations('backToOrder', locale), exact: true });
}
