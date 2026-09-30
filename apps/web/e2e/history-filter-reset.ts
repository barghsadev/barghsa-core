import { defaultParseSearch } from '@tanstack/react-router';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { t } from '@barghsa/i18n/app';

function historySearchParams(url: URL) {
  const params = new URLSearchParams(
    Object.entries(defaultParseSearch(url.search))
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  );
  params.sort();
  return params;
}

/** Remove each chip in isolation, including one of several statuses, then restore with Back. */
export async function verifyHistoryFilterChips(
  page: Page,
  locale: 'en' | 'fa',
  queries: URLSearchParams[],
  dateLabel = t('historyDates.label', locale),
  serviceLabel?: string
) {
  const original = new URL(page.url());
  const originalParams = historySearchParams(original);
  const fields = ['q', 'statuses', 'from', 'to', 'min', 'max', 'serviceType'];
  const applied = page.getByRole('list', {
    name: t('historyFilters.selected', locale),
    exact: true,
  });
  const filters = page.getByRole('button', {
    name: t('historyFilters.label', locale),
    exact: true,
    includeHidden: true,
  });
  const selectedStatuses = originalParams.get('statuses')?.split(',') ?? [];
  const actions = [
    {
      button: applied.getByRole('button', {
        name: t('historyFilters.remove', locale).replace(
          '{filter}',
          `${t('historySearch.label', locale)}: ${originalParams.get('q')}`
        ),
        exact: true,
      }),
      keys: ['q'],
    },
    { button: applied.getByRole('button').nth(1), keys: ['statuses'] },
    { button: applied.getByRole('button').filter({ hasText: dateLabel }), keys: ['from', 'to'] },
    ...(originalParams.has('min') || originalParams.has('max')
      ? [
          {
            button: applied
              .getByRole('button')
              .filter({ hasText: t('invoices.filter.amount', locale) }),
            keys: ['min', 'max'],
          },
        ]
      : []),
    ...(serviceLabel
      ? [
          {
            button: applied.getByRole('button').filter({ hasText: serviceLabel }),
            keys: ['serviceType'],
          },
        ]
      : []),
  ];
  await expect(applied.getByRole('button')).toHaveCount(
    actions.length + selectedStatuses.length - 1
  );
  await expect(actions[2]!.button).toContainText(t('historyFilters.since', locale));
  await expect(actions[2]!.button).toContainText(t('historyFilters.before', locale));
  await closeHistoryFilters(page, locale);
  await expect(filters).toHaveAttribute('aria-expanded', 'false');
  for (const action of actions) {
    const requestsBefore = queries.length;
    const expected = new URLSearchParams(originalParams);
    for (const key of action.keys) expected.delete(key);
    if (action.keys.includes('statuses') && selectedStatuses.length > 1)
      expected.set('statuses', selectedStatuses.slice(1).join(','));
    expected.sort();
    await action.button.click();
    await expect
      .poll(() => historySearchParams(new URL(page.url())).toString())
      .toBe(expected.toString());
    await expect.poll(() => queries.length).toBe(requestsBefore + 1);
    for (const key of [...fields, 'sort', 'status', 'state'])
      expect(queries.at(-1)?.get(key), key).toBe(expected.get(key));
    expect(queries.at(-1)?.has('before')).toBe(false);
    expect(historySearchParams(new URL(page.url())).get('contractId')).toBe(
      originalParams.get('contractId')
    );
    await expect(filters).toBeFocused();
    await expect(filters).toHaveAttribute('aria-expanded', 'false');
    await page.goBack();
    await expect(page).toHaveURL(original.href);
    await expect
      .poll(() => fields.every((key) => queries.at(-1)?.get(key) === originalParams.get(key)))
      .toBe(true);
  }
  await openHistoryFilters(page, locale);
  await expect(filters).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
}

/** Exercise one atomic reset, retained view/sort, collapse and browser restoration. */
export async function verifyHistoryFilterReset(
  page: Page,
  locale: 'en' | 'fa',
  queries: URLSearchParams[],
  activeCount: number
) {
  const original = new URL(page.url());
  const originalParams = historySearchParams(original);
  const filters = page.getByRole('button', {
    name: t('historyFilters.label', locale),
    exact: true,
    includeHidden: true,
  });
  const clear = page.getByRole('main').getByRole('button', {
    name: t('historyFilters.clearAll', locale),
    exact: true,
  });
  const search = page.getByRole('searchbox', {
    name: t('historySearch.label', locale),
    exact: true,
  });
  const keys = ['q', 'statuses', 'from', 'to', 'min', 'max', 'serviceType'];
  await closeHistoryFilters(page, locale);
  await expect(filters).toHaveAccessibleDescription(
    t('historyFilters.activeCount', locale).replace('{count}', activeCount.toLocaleString(locale))
  );
  await expect(filters.locator('[data-slot="badge"]')).toHaveText(
    activeCount.toLocaleString(locale)
  );
  await closeHistoryFilters(page, locale);
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
    expect(historySearchParams(new URL(page.url())).get(key), key).toBe(originalParams.get(key));
    expect(cleared.get(key), key).toBe(originalParams.get(key));
  }
  expect(historySearchParams(new URL(page.url())).get('contractId')).toBe(
    originalParams.get('contractId')
  );
  await expect(clear).toHaveCount(0);
  await expect(filters).toBeFocused();
  await expect(filters.locator('[data-slot="badge"]')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(original.href);
  await expect.poll(() => queries.at(-1)?.get('q')).toBe(originalParams.get('q'));
  await expect(clear).toBeVisible();
  await openHistoryFilters(page, locale);
  await expect(filters).toHaveAttribute('aria-expanded', 'true');
  await expect(search).toHaveValue(originalParams.get('q') ?? '');
  expect(
    (await new AxeBuilder({ page }).include('[data-slot="list-filter-panel"]').analyze()).violations
  ).toEqual([]);
}

export async function openHistoryFilters(page: Page, locale: 'en' | 'fa') {
  const dialog = page.getByRole('dialog', { name: t('historyFilters.label', locale), exact: true });
  if (!(await dialog.isVisible()))
    await page
      .getByRole('button', { name: t('historyFilters.label', locale), exact: true })
      .click();
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((element) => getComputedStyle(element).opacity))
    .toBe('1');
  return dialog;
}

export async function closeHistoryFilters(page: Page, locale: 'en' | 'fa') {
  const dialog = page.getByRole('dialog', { name: t('historyFilters.label', locale), exact: true });
  if (await dialog.isVisible())
    await dialog
      .getByRole('button', { name: t('historyFilters.cancel', locale), exact: true })
      .click();
  await expect(dialog).toBeHidden();
}

export async function applyHistoryFilters(page: Page, locale: 'en' | 'fa') {
  const dialog = page.getByRole('dialog', { name: t('historyFilters.label', locale), exact: true });
  await dialog
    .getByRole('button', { name: t('historyFilters.apply', locale), exact: true })
    .click();
  await expect(dialog).toBeHidden();
}
