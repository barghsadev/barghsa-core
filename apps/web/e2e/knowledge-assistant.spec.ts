import { test, expect } from './coverage-fixture';

for (const locale of ['fa', 'en'] as const) {
  test(`customer asks a sourced knowledge question (${locale})`, async ({ page, baseURL }) => {
    await page
      .context()
      .addCookies([{ name: 'barghsa_csrf', value: 'knowledge-fixture', url: baseURL! }]);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({ json: { userId: 'viewer', isStaff: false, requiresTosAcceptance: false } })
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
        json: { available: true, profileId: 'profile-1', slotKey: 'individual_chatbot' },
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
    if (locale === 'en') await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'پرسش از راهنمای برقسا' : 'Ask Barghsa guide',
      })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-side', locale === 'fa' ? 'left' : 'right');
    await expect(dialog).toContainText(
      locale === 'fa'
        ? 'به سفارش‌ها، کیف پول و فاکتورهای شما دسترسی ندارد'
        : 'cannot access your orders'
    );
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
    expect(sent[0]).toMatchObject({ message: question, requestId: expect.any(String) });
    expect(sent[0]).not.toHaveProperty('profileId');
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
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({ json: { userId: 'viewer', isStaff: false, requiresTosAcceptance: false } })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({ json: { profiles: [{ id: 'profile-1' }], hasDefault: true } })
  );
  await page.route('**/api/ai/knowledge/availability', (route) =>
    route.fulfill({ json: { available: false, profileId: null, slotKey: null } })
  );
  await page.goto('/app');
  await expect(page.locator('#dashboard-navigation')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'پرسش از راهنمای برقسا' })).toHaveCount(0);
});
