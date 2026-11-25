import { expect, type Page } from '@playwright/test';

export async function manualRecordDateTime(page: Page, id: string) {
  const control = page.locator(`#${id}`);
  await expect(control).toBeEnabled();
  if ((await control.getAttribute('type')) !== 'datetime-local')
    await page.locator(`button[aria-controls="date-time-entry-${id}"]`).click();
  await expect(control).toHaveAttribute('type', 'datetime-local');
  return control;
}

export async function selectRecordDateTime(
  page: Page,
  id: string,
  value: string,
  locale: 'fa' | 'en'
) {
  const [date, time] = value.split('T');
  await selectCalendarDate(page, id, date!, locale);
  const hour = page.locator(`#${id}-time`);
  const formatter = new Intl.NumberFormat(locale);
  await hour.fill(time!.replace(/\d/g, (digit) => formatter.format(Number(digit))));
  await expect(hour).toHaveValue(time!);
}

export async function selectCalendarDate(
  page: Page,
  id: string,
  date: string,
  locale: 'fa' | 'en'
) {
  const parts = new Intl.DateTimeFormat('en-US', {
    calendar: locale === 'fa' ? 'persian' : 'gregory',
    timeZone: 'UTC',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(`${date}T12:00:00Z`));
  const part = (type: 'year' | 'month' | 'day') =>
    Number(parts.find((entry) => entry.type === type)?.value);
  const control = page.locator(`#${id}`);
  await expect(control).toBeEnabled();
  if ((await control.getAttribute('type')) === 'date') {
    await control.fill(date);
    return;
  }
  await control.press('ArrowDown');
  const calendar = page.locator('[data-slot="popover-content"]').filter({
    has: page.locator('[data-slot="calendar"]'),
  });
  await calendar.locator('select[class*="years_dropdown"]').selectOption(String(part('year')));
  await calendar
    .locator('select[class*="months_dropdown"]')
    .selectOption(String(part('month') - 1));
  const displayDay = new Intl.NumberFormat(locale).format(part('day'));
  await calendar
    .locator('[role=gridcell]:not([data-outside]) button')
    .filter({ hasText: new RegExp(`^${displayDay}$`) })
    .click();
  await expect(control).toHaveAttribute('aria-expanded', 'false');
}
