import { fullNavigation } from './navigation-fixture';
import { fulfillDashboard } from './dashboard-fixture';
import { test, expect } from './coverage-fixture';

for (const locale of ['fa', 'en'] as const) {
  test(`customer asks a sourced knowledge question (${locale})`, async ({ page, baseURL }) => {
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page
      .context()
      .addCookies([{ name: 'barghsa_csrf', value: 'knowledge-fixture', url: baseURL! }]);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
    );
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'viewer',
          isStaff: false,
          navigation: fullNavigation('customer'),
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [
            {
              id: 'profile-1',
              profileType: 'INDIVIDUAL',
              isDefault: true,
              status: 'ACTIVE',
              title: null,
              firstName: 'Ari',
              lastName: 'Buyer',
              nationalId: null,
            },
          ],
          hasDefault: true,
          activeProfileId: 'profile-1',
        },
      })
    );
    await page.route('**/api/ai/knowledge/availability', (route) =>
      route.fulfill({
        json: {
          available: true,
          profileId: 'profile-1',
          profileName: 'Ari Buyer',
          slotKey: 'individual_chatbot',
        },
      })
    );
    await page.route('**/api/dashboard{,/**}', (route) =>
      fulfillDashboard(route, {
        json: {
          profile: { id: 'profile-1', name: 'Ari Buyer' },
          access: { wallet: true, invoices: true },
          wallet: { balance: '1234500', currency: 'IRR' },
          pendingInvoices: 2,
        },
      })
    );
    const sent: Array<Record<string, unknown>> = [];
    await page.route('**/api/ai/knowledge/questions', async (route) => {
      sent.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        json: {
          reply: locale === 'fa' ? 'راهنمای منتشرشده را بخوانید.' : 'Read the published guide.',
          sources: [
            {
              kbId: '01900000-0000-7000-8000-000000000001',
              title: locale === 'fa' ? 'راهنمای مشتریان' : 'Customer guide',
              documentTitle: 'guide.pdf',
              excerpt: locale === 'fa' ? 'بخش راهنما' : 'Guide excerpt',
            },
          ],
          attribution: 'retrieved_context',
          remainingQuota: 4,
        },
      });
    });
    await page.goto('/app');
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'پرسش از راهنمای برقسا' : 'Ask Barghsa guide',
      })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-side', locale === 'fa' ? 'left' : 'right');
    await expect(dialog).toContainText(
      locale === 'fa' ? 'در اختیار مدل قرار نمی‌گیرد' : 'is not sent to the model'
    );
    await expect(dialog).toContainText(
      locale === 'fa' ? 'شما با پروفایل Ari Buyer پرسش می‌کنید.' : "You're asking as Ari Buyer."
    );
    await dialog
      .getByRole('button', {
        name: locale === 'fa' ? 'نمایش وضعیت حساب من' : 'Show my account status',
      })
      .click();
    await expect(dialog).toContainText('Ari Buyer');
    await expect(dialog).toContainText(
      locale === 'fa' ? 'فاکتورهای پرداخت‌نشده' : 'Unpaid invoices'
    );
    await expect(
      dialog.getByRole('link', { name: locale === 'fa' ? 'مشاهده کیف پول' : 'View wallet' })
    ).toBeVisible();
    expect(sent).toHaveLength(0);
    const question = locale === 'fa' ? 'مدارک لازم چیست؟' : 'What documents do I need?';
    const input = dialog.getByLabel(
      locale === 'fa' ? 'پرسش خود را بنویسید' : 'Write your question'
    );
    await input.fill(question);
    await input.press('Enter');
    await expect(dialog).toContainText(
      locale === 'fa' ? 'راهنمای منتشرشده را بخوانید.' : 'Read the published guide.'
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ message: question, requestId: expect.any(String) });
    await dialog.getByText(locale === 'fa' ? 'منابع پاسخ' : 'Answer sources').click();
    await expect(dialog.getByText('guide.pdf')).toBeVisible();
    await expect(dialog.getByText(locale === 'fa' ? 'بخش راهنما' : 'Guide excerpt')).toBeVisible();
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'بستن راهنما' : 'Close guide' })
      .click();
    await expect(dialog).not.toBeVisible();
  });
}

test('customer launcher stays hidden when the active profile has no assigned guide', async ({
  page,
}) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'viewer',
        isStaff: false,
        navigation: fullNavigation('customer'),
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({ json: { profiles: [{ id: 'profile-1' }], hasDefault: true } })
  );
  await page.route('**/api/ai/knowledge/availability', (route) =>
    route.fulfill({ json: { available: false, profileId: null, profileName: null, slotKey: null } })
  );
  await page.goto('/app');
  await expect(page.locator('#dashboard-navigation')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'پرسش از راهنمای برقسا' })).toHaveCount(0);
});

test('account status hides denied fields and refuses a switched profile response', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('barghsa.locale', 'en'));
  let dashboard: Record<string, unknown> = {
    profile: { id: 'profile-1', name: 'Agent profile' },
    access: { wallet: false, invoices: false },
    wallet: null,
    pendingInvoices: 777,
  };
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'viewer',
        isStaff: false,
        navigation: fullNavigation('customer'),
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: 'profile-1', profileType: 'LEGAL', isDefault: true, status: 'ACTIVE' }],
        hasDefault: true,
        activeProfileId: 'profile-1',
      },
    })
  );
  await page.route('**/api/ai/knowledge/availability', (route) =>
    route.fulfill({
      json: {
        available: true,
        profileId: 'profile-1',
        profileName: 'Agent profile',
        slotKey: 'legal_entity_chatbot',
      },
    })
  );
  await page.route('**/api/dashboard{,/**}', (route) =>
    fulfillDashboard(route, { json: dashboard })
  );

  await page.goto('/app');
  await page.getByRole('button', { name: 'Ask Barghsa guide' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Show my account status' }).click();
  await expect(dialog.getByText('Unavailable')).toHaveCount(2);
  await expect(dialog.getByRole('link', { name: 'View wallet' })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'View invoices' })).toHaveCount(0);
  await expect(dialog).not.toContainText('777');

  dashboard = {
    profile: { id: 'profile-1', name: 'Agent profile' },
    wallet: { balance: '25', currency: 'IRR' },
    pendingInvoices: 777,
  };
  await dialog.getByRole('button', { name: 'Show my account status' }).click();
  await expect(dialog.getByRole('link', { name: 'View wallet' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'View invoices' })).toHaveCount(0);
  await expect(dialog).not.toContainText('777');

  dashboard = {
    profile: { id: 'profile-2', name: 'Other profile' },
    access: { wallet: true, invoices: true },
    wallet: { balance: '999999', currency: 'IRR' },
    pendingInvoices: 9,
  };
  await dialog.getByRole('button', { name: 'Show my account status' }).click();
  await expect(dialog).toContainText('The active profile changed. Reopen the guide.');
  await expect(dialog).not.toContainText('Other profile');
  await expect(dialog).not.toContainText('999999');
});

test('the full-page guide answers with sources and handles an unassigned profile', async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => localStorage.setItem('barghsa.locale', 'en'));
  await page
    .context()
    .addCookies([{ name: 'barghsa_csrf', value: 'knowledge-page-fixture', url: baseURL! }]);
  let available = true;
  let activeProfileId = 'profile-1';
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'viewer',
        isStaff: false,
        navigation: fullNavigation('customer'),
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [
          {
            id: 'profile-1',
            profileType: 'INDIVIDUAL',
            status: 'ACTIVE',
            firstName: 'Ari',
            lastName: 'Buyer',
          },
          {
            id: 'profile-2',
            profileType: 'LEGAL',
            status: 'ACTIVE',
            firstName: 'Nova',
            lastName: 'Energy',
          },
        ],
        hasDefault: true,
        activeProfileId,
      },
    })
  );
  await page.route('**/api/profiles/switch/profile-2', (route) => {
    activeProfileId = 'profile-2';
    return route.fulfill({ json: { activeProfileId } });
  });
  await page.route('**/api/ai/knowledge/availability', (route) =>
    route.fulfill({
      json: available
        ? {
            available: true,
            profileId: activeProfileId,
            profileName: activeProfileId === 'profile-1' ? 'Ari Buyer' : 'Nova Energy',
            slotKey:
              activeProfileId === 'profile-1' ? 'individual_chatbot' : 'legal_entity_chatbot',
          }
        : { available: false, profileId: null, profileName: null, slotKey: null },
    })
  );
  await page.route('**/api/ai/knowledge/questions', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ message: 'How do invoices work?' });
    return route.fulfill({
      json: {
        reply: 'Pay an issued invoice from its detail page.',
        sources: [
          {
            kbId: '01900000-0000-7000-8000-000000000001',
            title: 'Invoice guide',
            documentTitle: 'invoice-guide.pdf',
            excerpt: 'Issued invoices are visible in your account.',
          },
        ],
        attribution: 'retrieved_context',
        remainingQuota: 4,
      },
    });
  });

  await page.goto('/ai');
  await expect(page.getByRole('heading', { name: 'Barghsa knowledge guide' })).toBeVisible();
  await expect(page.getByText("You're asking as Ari Buyer.")).toBeVisible();
  const guideLink = page.getByRole('link', { name: 'Ask Barghsa guide' });
  const guideNavigationToggle = page.locator('[aria-controls="dashboard-navigation"]');
  const expandedGuideNavigation = !(await guideLink.isVisible());
  if (expandedGuideNavigation) await guideNavigationToggle.click();
  await expect(guideLink).toBeVisible();
  if (expandedGuideNavigation) await guideNavigationToggle.click();
  await expect(page.getByRole('button', { name: 'Ask Barghsa guide' })).toHaveCount(0);
  const input = page.getByLabel('Write your question');
  const initialHeight = await input.evaluate((element) => element.getBoundingClientRect().height);
  await input.fill('Line one\nLine two\nLine three\nLine four\nLine five\nLine six');
  await expect
    .poll(() => input.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(initialHeight);
  await input.fill('How do invoices work?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('Pay an issued invoice from its detail page.')).toBeVisible();
  await page.getByText('Answer sources').click();
  await expect(page.getByText('invoice-guide.pdf')).toBeVisible();

  const profilePicker = page.getByLabel('Switch active profile');
  const navigationToggle = page.locator('[aria-controls="dashboard-navigation"]');
  const openedNavigation = !(await profilePicker.isVisible());
  if (openedNavigation) await navigationToggle.click();
  await profilePicker.selectOption('profile-2');
  if (openedNavigation) await navigationToggle.click();
  await expect(page.getByText("You're asking as Nova Energy.")).toBeVisible();
  await expect(page.getByText('Pay an issued invoice from its detail page.')).toHaveCount(0);

  available = false;
  await page.reload();
  await expect(page.getByText('No guide is assigned to your active profile yet.')).toBeVisible();
  await expect(page.getByLabel('Write your question')).toHaveCount(0);
});
