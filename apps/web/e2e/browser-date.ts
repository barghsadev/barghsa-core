import type { Page } from '@playwright/test';

/** Assert the chosen instant/zone using the browser's locale data, not Node's ICU punctuation. */
export async function formatBrowserDate(
  page: Page,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  value: string
): Promise<string> {
  return page.evaluate(
    (input) => new Intl.DateTimeFormat(input.locale, input.options).format(new Date(input.value)),
    { locale, options, value }
  );
}
