import { mockPublicAuthCsrf } from './public-auth-fixture';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './coverage-fixture';

for (const locale of ['fa', 'en'])
  for (const darkMode of [false, true])
    test(
      'login fields, normalization and generic errors (' + locale + ', dark=' + darkMode + ')',
      async ({ page }, testInfo) => {
        await page.addInitScript((locale) => {
          const apply = () => {
            document.documentElement.lang = locale;
            document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
          };
          if (document.documentElement) apply();
          new MutationObserver(apply).observe(document, { childList: true });
        }, locale);
        await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
        await mockPublicAuthCsrf(page);
        await page.route('**/api/public/branding/config', (route) =>
          route.fulfill({
            json: {
              appTitle: 'Barghsa',
              slogan: 'Account access',
              primaryColor: '#2563eb',
              secondaryColor: '#64748b',
              accentColor: '#f59e0b',
              logoUrl: null,
              faviconUrl: null,
              darkMode,
            },
          })
        );
        const requests: unknown[] = [];
        let release: (() => void) | null = null;
        await page.route('**/api/auth/login', async (route) => {
          requests.push(route.request().postDataJSON());
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          await route.fulfill({
            status: 401,
            json: {
              error: { code: 'AUTH:LOGIN:INVALID_CREDENTIALS', message: 'private account detail' },
            },
          });
        });
        await page.goto('/login');
        const username = page.locator('#username'),
          password = page.locator('#password'),
          submit = page.locator('button[type=submit]');
        await expect(username).toHaveAttribute('autocomplete', 'username');
        await expect(username).toHaveAttribute('dir', 'ltr');
        await expect(password).toBeVisible();
        await expect(password).toHaveAttribute('autocomplete', 'current-password');
        await expect(submit).toBeDisabled();
        await expect(page.locator('a[href="/register"]')).toBeVisible();
        await expect(page.locator('a[href="/forgot-password"]')).toBeVisible();
        await password.fill('Saved-password-123!');
        const toggle = page.getByRole('button', {
          name: locale === 'fa' ? 'نمایش یا مخفی‌سازی رمز عبور' : 'Toggle password visibility',
        });
        await toggle.click();
        await expect(password).toHaveAttribute('type', 'text');
        await toggle.click();
        await expect(password).toHaveAttribute('type', 'password');
        for (const [raw, normalized] of [
          [' USER@EXAMPLE.TEST ', 'user@example.test'],
          ['09121234567', '+989121234567'],
          ['+441234567890', '+441234567890'],
        ]) {
          await username.fill(raw!);
          // Readiness must not depend on blur, so saved credentials can submit directly.
          await expect(username).toBeFocused();
          await expect(submit).toBeEnabled();
          release = null;
          await username.press('Enter');
          await expect.poll(() => release !== null).toBe(true);
          await expect(submit).toBeDisabled();
          await expect(username).toBeDisabled();
          await expect(password).toBeDisabled();
          await expect(submit).toContainText(locale === 'fa' ? 'در حال ورود' : 'Logging in');
          expect(requests.at(-1)).toEqual({
            username: normalized,
            password: 'Saved-password-123!',
          });
          release!();
          await expect(page.getByRole('alert')).toContainText(
            locale === 'fa' ? 'نام کاربری یا رمز عبور نامعتبر است' : 'Invalid username or password'
          );
          await expect(page.getByRole('alert')).not.toContainText('private account detail');
          await expect(password).toHaveValue('Saved-password-123!');
          await expect(submit).toBeEnabled();
          await expect(page).toHaveURL(/\/login$/);
        }
        expect(requests).toHaveLength(3);
        await submit.hover();
        await expect(submit).toHaveCSS('opacity', '1');
        await submit.evaluate((node) =>
          Promise.all(node.getAnimations().map((animation) => animation.finished))
        );
        const scan = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        expect(scan.violations).toEqual([]);
        const gradients = new Set<string>();
        for (const node of scan.incomplete
          .filter((x) => x.id === 'color-contrast')
          .flatMap((x) => x.nodes)) {
          for (const check of node.any) {
            expect(check.data?.messageKey).toBe('bgGradient');
            for (const related of check.relatedNodes ?? []) {
              expect(related.target).toHaveLength(1);
              gradients.add(related.target[0] as string);
            }
          }
        }
        // These gradients vary only the opacity of one primary color over the
        // page background. Check every endpoint without changing text styles.
        for (const selector of gradients) {
          const region = page.locator(selector);
          expect(await region.evaluate((node) => getComputedStyle(node).backgroundImage)).toContain(
            'linear-gradient'
          );
          const original = await region.getAttribute('style');
          try {
            for (const stop of ['from', 'via', 'to']) {
              const present = await region.evaluate((node, stop) => {
                const value = getComputedStyle(node)
                  .getPropertyValue('--tw-gradient-' + stop)
                  .trim();
                if (!value) return false;
                (node as HTMLElement).style.backgroundImage = 'none';
                (node as HTMLElement).style.backgroundColor = value;
                return true;
              }, stop);
              if (!present) continue;
              const endpoint = await new AxeBuilder({ page })
                .include(selector)
                .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
                .analyze();
              await testInfo.attach('gradient-' + stop, {
                contentType: 'application/json',
                body: JSON.stringify(endpoint),
              });
              expect(endpoint.violations).toEqual([]);
              expect(endpoint.incomplete.filter((x) => x.id === 'color-contrast')).toEqual([]);
            }
          } finally {
            await region.evaluate((node, original) => {
              if (original === null) node.removeAttribute('style');
              else node.setAttribute('style', original);
            }, original);
          }
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
        ).toBeLessThanOrEqual(1);
        const aside = page.locator('aside');
        if (testInfo.project.name === 'chromium') await expect(aside).toBeVisible();
        else await expect(aside).toBeHidden();
        await page.screenshot({
          path:
            '/tmp/barghsa-login-ui-' +
            locale +
            '-' +
            darkMode +
            '-' +
            testInfo.project.name +
            '.png',
          fullPage: true,
        });
      }
    );

test.beforeEach(async ({ page }) => {
  await mockPublicAuthCsrf(page);
});
