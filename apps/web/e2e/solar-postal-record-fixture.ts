import type { Page } from '@playwright/test';

export async function routePostalRecords(page: Page, readRows: () => Array<{ id: string }>) {
  await page.route(
    (url) => /^\/api\/admin\/solar\/requests\/[^/]+\/postal$/.test(url.pathname),
    (route) => {
      const id = new URL(route.request().url()).pathname.split('/').at(-2);
      const record = readRows().find((row) => row.id === id);
      return record ? route.fulfill({ json: record }) : route.fulfill({ status: 404, json: {} });
    }
  );
}
