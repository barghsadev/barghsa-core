import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';

const profileId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function shell(page: Page, locale: string) {
  await page.addInitScript((lang) => {
    const apply = () => {
      if (document.documentElement) {
        document.documentElement.lang = lang;
        document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
      }
    };
    apply();
    new MutationObserver(apply).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (r) => r.fulfill({ status: 404, json: {} }));
  await page.route('**/api/profiles', (r) =>
    r.fulfill({
      json: {
        profiles: [{ id: profileId, title: 'Main profile', status: 'VERIFIED' }],
        hasDefault: true,
        activeProfileId: profileId,
      },
    })
  );
}
for (const locale of ['en', 'fa']) {
  for (const verified of [true, false]) {
    test(`manual verification notice shows named result and inbox history (${locale}, verified=${verified})`, async ({
      page,
    }) => {
      await shell(page, locale);
      await page.setViewportSize({ width: locale === 'fa' ? 375 : 1280, height: 850 });
      let isRead = false;
      const localizedContent = {
        en: {
          title: verified ? 'Your profile was verified' : 'Profile verification revoked',
          body: verified
            ? 'A staff reviewer verified your profile "Main <profile>".'
            : 'Verification of your profile "Main <profile>" was revoked. Reason: Documents need review\nOpen profile settings, select this profile and correct the requested details. Send a support ticket to request another review.',
        },
        fa: {
          title: verified ? 'پروفایل شما تأیید شد' : 'تأیید پروفایل لغو شد',
          body: verified
            ? 'پروفایل «Main <profile>» توسط کارشناس تأیید شد.'
            : 'تأیید پروفایل «Main <profile>» لغو شد. دلیل: Documents need review\nدر تنظیمات پروفایل، این پروفایل را انتخاب و اطلاعات درخواست‌شده را اصلاح کنید. برای بررسی دوباره، تیکت پشتیبانی ارسال کنید.',
        },
      };
      const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      await page.route('**/api/profiles/verification-status', (r) =>
        r.fulfill({
          json: {
            activeProfileId: profileId,
            profileStatus: verified ? 'VERIFIED' : 'ACTIVE',
            isVerified: verified,
            verificationRequired: true,
            verificationMethod: 'manual',
            canAutoVerify: false,
            verificationNotice: isRead ? null : { id, localizedContent },
          },
        })
      );
      await page.route('**/api/v1/notifications?*', (r) =>
        r.fulfill({
          json: {
            data: [
              {
                id,
                type: verified ? 'profile_verified' : 'profile_unverified',
                localizedContent,
                titleI18nKey: 'notifications.legacy.title',
                bodyI18nKey: 'notifications.legacy.body',
                params: {},
                linkRoute: '/settings/profile',
                linkParams: null,
                isRead,
                readAt: null,
                createdAt: new Date().toISOString(),
              },
            ],
            next_cursor: null,
            unread_count: isRead ? 0 : 1,
          },
        })
      );
      await page.route(`**/api/v1/notifications/${id}/read`, (r) => {
        isRead = true;
        return r.fulfill({ json: { unread_count: 0 } });
      });
      await page.goto('/dashboard');
      const banner = page.getByTestId('verification-notice');
      const content = localizedContent[locale as 'en' | 'fa'];
      await expect(banner).toContainText(content.title);
      await expect(banner).toContainText(content.body);
      await expect(banner.locator('profile')).toHaveCount(0);
      await expect(banner).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
      await expect(
        banner.getByRole('link', {
          name: locale === 'fa' ? 'تنظیمات پروفایل' : 'Profile Settings',
          exact: true,
        })
      ).toHaveAttribute('href', '/settings/profile');
      if (!verified)
        await expect(
          banner.getByRole('link', {
            name:
              locale === 'fa' ? 'پیگیری تأیید از پشتیبانی' : 'Contact support about verification',
          })
        ).toHaveAttribute('href', '/tickets');
      for (const dark of [false, true]) {
        await page
          .locator('html')
          .evaluate((node, value) => node.classList.toggle('dark', value), dark);
        expect(
          (await new AxeBuilder({ page }).include('[data-testid="verification-notice"]').analyze())
            .violations
        ).toEqual([]);
      }
      await banner
        .getByRole('link', {
          name: locale === 'fa' ? 'مشاهده همه اعلان‌ها' : 'View all notifications',
        })
        .click();
      await expect(page).toHaveURL(/\/notifications$/);
      const row = page.getByRole('button').filter({ hasText: content.body });
      await expect(row).toBeVisible();
      await banner
        .getByRole('button', { name: locale === 'fa' ? 'بستن' : 'Dismiss', exact: true })
        .click();
      await expect(banner).toHaveCount(0);
      expect(isRead).toBe(false);
      await row.click();
      await expect(page).toHaveURL(/\/settings\/profile$/);
      expect(isRead).toBe(true);
      await expect(banner).toHaveCount(0);
    });
  }
  test(`verification banner drops old content after failed refresh and ignores malformed notices (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let fail = false;
    await page.route('**/api/profiles/verification-status', (r) =>
      r.fulfill(
        fail
          ? { status: 503, json: {} }
          : {
              json: {
                activeProfileId: profileId,
                isVerified: true,
                verificationRequired: true,
                canAutoVerify: false,
                verificationNotice: {
                  id: 'notice',
                  localizedContent: {
                    en: { title: 'Private result', body: 'Private detail' },
                    fa: { title: 'نتیجه خصوصی', body: 'جزئیات خصوصی' },
                  },
                },
              },
            }
      )
    );
    await page.goto('/dashboard');
    const banner = page.getByTestId('verification-notice');
    await expect(banner).toBeVisible();
    fail = true;
    await banner
      .getByRole('link', {
        name: locale === 'fa' ? 'مشاهده همه اعلان‌ها' : 'View all notifications',
      })
      .click();
    await expect(banner).toHaveCount(0);
    await page.route('**/api/profiles/verification-status', (r) =>
      r.fulfill({
        json: {
          activeProfileId: profileId,
          isVerified: true,
          verificationRequired: true,
          canAutoVerify: false,
          verificationNotice: { id: 42, localizedContent: { en: { title: { bad: true } } } },
        },
      })
    );
    await page.goto('/dashboard');
    await expect(banner).toHaveCount(0);
  });
}
