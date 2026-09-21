import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

/** Resolve only proven scroll clipping; every revealed node must pass contrast. */
export async function verifyClippedContrast(
  page: Page,
  scan: Awaited<ReturnType<AxeBuilder['analyze']>>,
  hovered?: Locator
) {
  const nodes = scan.incomplete
    .filter((item) => item.id === 'color-contrast')
    .flatMap((item) => item.nodes);
  const clipped = [];
  // Capture all geometry before scrolling changes the original scan's viewport.
  for (const node of nodes) {
    expect(node.any.some((check) => check.data?.messageKey === 'elmPartiallyObscured')).toBe(true);
    expect(node.target).toHaveLength(1);
    expect(typeof node.target[0]).toBe('string');
    const selector = node.target[0] as string;
    const geometry = await page.locator(selector).evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      let left = 0,
        top = 0,
        right = innerWidth,
        bottom = innerHeight;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const box = parent.getBoundingClientRect();
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
          left = Math.max(left, box.left + parent.clientLeft);
          right = Math.min(right, box.left + parent.clientLeft + parent.clientWidth);
        }
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
          top = Math.max(top, box.top + parent.clientTop);
          bottom = Math.min(bottom, box.top + parent.clientTop + parent.clientHeight);
        }
      }
      return {
        bounds: bounds.toJSON(),
        visible: { left, top, right, bottom },
        clipped:
          bounds.left < left - 0.5 ||
          bounds.right > right + 0.5 ||
          bounds.top < top - 0.5 ||
          bounds.bottom > bottom + 0.5,
      };
    });
    expect(geometry.clipped, `${selector}: ${JSON.stringify(geometry)}`).toBe(true);
    clipped.push({ selector, geometry });
  }
  for (const { selector } of clipped) {
    const node = page.locator(selector);
    await node.evaluate((element) =>
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    );
    await expect(node).toBeInViewport({ ratio: 1 });
    // Scrolling can move a hovered row away from the pointer. Preserve that
    // state when the incomplete text belongs to the row being inspected.
    if (
      hovered &&
      (await hovered.evaluate(
        (element, target) => element.contains(document.querySelector(target)),
        selector
      ))
    ) {
      await node.hover();
      expect(await hovered.evaluate((element) => element.matches(':hover'))).toBe(true);
    }
    const revealed = await new AxeBuilder({ page })
      .include(selector)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(revealed.violations).toEqual([]);
    expect(revealed.incomplete.filter((item) => item.id === 'color-contrast')).toEqual([]);
  }
  return clipped;
}
