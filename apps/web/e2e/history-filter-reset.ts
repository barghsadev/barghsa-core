import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { t } from '@barghsa/i18n/app';

/** Exercise one atomic reset, retained view/sort, collapse and browser restoration. */
export async function verifyHistoryFilterReset(
  page: Page,
  locale: 'en' | 'fa',
  queries: URLSearchParams[],
  activeCount: number
) {
  const original = new URL(page.url());
  const filters = page.getByRole('button', {
    name: t('historyFilters.label', locale),
    exact: true,
  });
  const clear = page.getByRole('button', {
    name: t('historyFilters.clearAll', locale),
    exact: true,
  });
  const search = page.getByRole('searchbox', {
    name: t('historySearch.label', locale),
    exact: true,
  });
  const keys = ['q', 'statuses', 'from', 'to', 'min', 'max', 'serviceType'];
  await expect(filters).toHaveAccessibleDescription(
    t('historyFilters.activeCount', locale).replace('{count}', activeCount.toLocaleString(locale))
  );
  await expect(filters.locator('[data-slot="badge"]')).toHaveText(
    activeCount.toLocaleString(locale)
  );
  await filters.click();
  await expect(filters).toHaveAttribute('aria-expanded', 'false');
  await expect(search).toBeHidden();
  const requestsBefore = queries.length;
  await clear.click();
  await expect
    .poll(() => keys.every((key) => !new URL(page.url()).searchParams.has(key)))
    .toBe(true);
  await expect.poll(() => queries.length).toBe(requestsBefore + 1);
  const cleared = queries.at(-1)!;
  for (const key of [...keys, 'before']) expect(cleared.has(key), key).toBe(false);
  for (const key of ['sort', 'status', 'state']) {
    expect(new URL(page.url()).searchParams.get(key), key).toBe(original.searchParams.get(key));
    expect(cleared.get(key), key).toBe(original.searchParams.get(key));
  }
  expect(new URL(page.url()).searchParams.get('contractId')).toBe(
    original.searchParams.get('contractId')
  );
  await expect(clear).toHaveCount(0);
  await expect(filters).toBeFocused();
  await expect(filters.locator('[data-slot="badge"]')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(original.href);
  await expect.poll(() => queries.at(-1)?.get('q')).toBe(original.searchParams.get('q'));
  await expect(clear).toBeVisible();
  await filters.click();
  await expect(filters).toHaveAttribute('aria-expanded', 'true');
  await expect(search).toHaveValue(original.searchParams.get('q') ?? '');
  expect(
    (await new AxeBuilder({ page }).include('[data-slot="list-filter-panel"]').analyze()).violations
  ).toEqual([]);
}
