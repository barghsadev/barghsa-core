import type { Locator } from '@playwright/test';
import { isRegisteredWebPath } from '../../../scripts/web-navigation-paths.mjs';
import { expect } from './coverage-fixture';

export async function expectRegisteredNavigationLinks(container: Locator) {
  const paths = await container.locator('a[href]:not([download])').evaluateAll((anchors) =>
    anchors.flatMap((anchor) => {
      const href = new URL((anchor as HTMLAnchorElement).href);
      return href.origin === location.origin && !href.pathname.startsWith('/api/')
        ? [href.pathname]
        : [];
    })
  );
  expect(paths.length).toBeGreaterThan(0);
  expect([...new Set(paths)].filter((path) => !isRegisteredWebPath(path))).toEqual([]);
}
