import { expect, type Page, type TestInfo } from './coverage-fixture';

const widths = [320, 375, 390, 414, 768, 1024, 1280, 1920];

/** Probe the existing populated journey without resetting its profile, records, or draft. */
export async function checkRoutePresentation(page: Page, info: TestInfo, locale: 'en' | 'fa') {
  const original = page.viewportSize();
  const pathname = new URL(page.url()).pathname;
  const report = [];
  await page.evaluate(() => document.fonts.ready);
  try {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      report.push(
        await page.evaluate(() => {
          const visible = (node: Element) =>
            node.getClientRects().length > 0 &&
            getComputedStyle(node).visibility === 'visible' &&
            !node.closest('[hidden], [aria-hidden=true], [inert], [role=dialog]');
          const main = document.querySelector('main#main-content');
          const roles: Record<string, string> = {
            MAIN: 'main',
            NAV: 'navigation',
            ASIDE: 'complementary',
            HEADER: 'banner',
            FOOTER: 'contentinfo',
          };
          const landmarks = [
            ...document.querySelectorAll(
              'main,nav,aside,header,footer,[role=main],[role=navigation],[role=complementary],[role=banner],[role=contentinfo]'
            ),
          ].flatMap((node) => {
            if (!visible(node)) return [];
            const explicit = node.getAttribute('role');
            const role = explicit ?? roles[node.tagName];
            if (!role || !Object.values(roles).includes(role)) return [];
            if (
              !explicit &&
              (role === 'banner' || role === 'contentinfo') &&
              node.parentElement?.closest('main,nav,aside,article,section')
            )
              return [];
            const labelledBy = node
              .getAttribute('aria-labelledby')
              ?.split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent?.trim())
              .filter(Boolean)
              .join(' ');
            const name = labelledBy || node.getAttribute('aria-label')?.trim() || '';
            return [{ role, name, id: node.id }];
          });
          const headings = [...(main?.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]') ?? [])]
            .filter(visible)
            .map((node) => ({
              level: Number(node.getAttribute('aria-level') ?? node.tagName.slice(1)),
              text: node.textContent?.trim().slice(0, 80) ?? '',
            }));
          const touch = matchMedia('(pointer: coarse)').matches;
          const mainBox = main?.getBoundingClientRect();
          const overflowElements =
            main && mainBox && main.scrollWidth - main.clientWidth > 1
              ? [...main.querySelectorAll('*')]
                  .filter((node) => {
                    if (!visible(node) || node.closest('[data-slot=table-scroll-region]'))
                      return false;
                    const rect = node.getBoundingClientRect();
                    return rect.right > mainBox.right + 1 || rect.left < mainBox.left - 1;
                  })
                  .slice(0, 12)
                  .map((node) => ({
                    tag: node.tagName,
                    id: node.id,
                    className: node.getAttribute('class'),
                    text: node.textContent?.trim().slice(0, 70),
                  }))
              : [];
          const checkedTargets =
            '.touch-action, button:not([data-slot]), input[type=file], .touch-label input, #ticket-filter, #ticket-sort, #invoice-ledger-state, [class~="pointer-coarse:min-h-11"]';
          const smallControls = touch
            ? [
                ...(main?.querySelectorAll(
                  'button,input:not([type=hidden]),select,textarea,summary,a[href],[role=tab]'
                ) ?? []),
              ]
                .filter(
                  (node) =>
                    visible(node) && !node.matches(':disabled,[aria-disabled=true],.sr-only')
                )
                .flatMap((node) => {
                  const labels =
                    node instanceof HTMLInputElement && node.matches('[type=checkbox],[type=radio]')
                      ? [...(node.labels ?? [])].filter(visible)
                      : [];
                  const isLarge = (target: Element) => {
                    const { width, height } = target.getBoundingClientRect();
                    return width >= 44 && height >= 44;
                  };
                  if ([node, ...labels].some(isLarge)) return [];
                  const box = node.getBoundingClientRect();
                  return [
                    {
                      tag: node.tagName,
                      slot: node.getAttribute('data-slot'),
                      id: node.id,
                      label:
                        node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 80),
                      width: Math.round(box.width),
                      height: Math.round(box.height),
                      checked: node.matches(checkedTargets),
                    },
                  ];
                })
            : [];
          return {
            width: innerWidth,
            direction: document.documentElement.dir,
            documentOverflow: document.documentElement.scrollWidth - innerWidth,
            mainOverflow: main ? main.scrollWidth - main.clientWidth : null,
            mains: document.querySelectorAll('main#main-content').length,
            pageTitles: [...document.querySelectorAll('h1,[role=heading][aria-level="1"]')].filter(
              visible
            ).length,
            landmarks,
            overflowElements,
            headings,
            smallControls,
          };
        })
      );
    }
  } finally {
    if (original) await page.setViewportSize(original);
  }
  await info.attach('populated-route-presentation', {
    body: JSON.stringify({ pathname, report }),
    contentType: 'application/json',
  });
  for (const row of report) {
    const scope = `${pathname} ${locale} at ${row.width}px`;
    expect.soft(row.direction, scope).toBe(locale === 'fa' ? 'rtl' : 'ltr');
    expect.soft(row.mains, scope).toBe(1);
    expect.soft(row.pageTitles, scope).toBe(1);
    expect
      .soft(
        row.landmarks.filter(({ role }) => role === 'main'),
        scope
      )
      .toHaveLength(1);
    expect
      .soft(
        row.landmarks.filter(
          ({ role, name }) => !name && row.landmarks.filter((item) => item.role === role).length > 1
        ),
        scope
      )
      .toEqual([]);
    expect.soft(row.documentOverflow, scope).toBeLessThanOrEqual(1);
    expect.soft(row.mainOverflow, scope).not.toBeNull();
    expect.soft(row.mainOverflow ?? Infinity, scope).toBeLessThanOrEqual(1);
    expect
      .soft(
        row.headings.filter(({ level }) => level === 1),
        scope
      )
      .toHaveLength(1);
    expect
      .soft(
        row.headings.filter(({ level }, i) => i > 0 && level > row.headings[i - 1]!.level + 1),
        scope
      )
      .toEqual([]);
    expect
      .soft(
        row.smallControls.filter(({ checked }) => checked),
        scope
      )
      .toEqual([]);
  }
}
