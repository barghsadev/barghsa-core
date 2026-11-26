import type { Page } from '@playwright/test';
import { notificationEventTitle } from '@barghsa/i18n/notification-forms';

export async function chooseNotificationEvent(
  page: Page,
  key: string,
  locale: 'fa' | 'en',
  query = key
) {
  const event = page.locator('#notification-template-eventKey');
  await event.click();
  await event.fill(query);
  await page
    .getByRole('option', { name: notificationEventTitle(key, locale), exact: true })
    .click();
}
