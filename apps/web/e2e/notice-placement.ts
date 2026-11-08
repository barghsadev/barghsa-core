import { expect, type Locator } from './coverage-fixture';

export async function expectNoticeBelowPageHeader(notice: Locator) {
  const page = notice.page();
  const header = page
    .locator('main header')
    .filter({ has: page.getByRole('heading', { level: 1 }) });
  await expect(notice).toBeVisible();
  await header.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const [intro, toast] = await Promise.all([header.boundingBox(), notice.boundingBox()]);
      return intro && toast ? toast.y - (intro.y + intro.height) : 0;
    })
    .toBeGreaterThanOrEqual(15.5);
}
