import { fullNavigation } from './navigation-fixture';
import { test, expect } from './coverage-fixture';
import { shellText } from '@barghsa/i18n/shell';
import { t } from '@barghsa/i18n/app';

for (const locale of ['fa', 'en'] as const) {
  test(`staff inbox stays in the staff workspace (${locale})`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    let operatingContext: 'staff' | 'customer' = 'staff';
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'dual-role-user',
          isStaff: true,
          operatingContext,
          navigation: fullNavigation(operatingContext),
          canSwitchContext: true,
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/auth/sessions/context', (route) => {
      operatingContext = (route.request().postDataJSON() as { context: 'staff' | 'customer' })
        .context;
      return route.fulfill({ json: { operatingContext } });
    });
    const notices = [
      {
        id: '01900000-0000-7000-8000-000000000001',
        operatingContext: 'staff',
        type: 'finance.chargeback_unresolved',
        titleI18nKey: 'notifications.legacy.title',
        bodyI18nKey: 'notifications.legacy.body',
        localizedContent: {
          fa: { title: 'بررسی مالی', body: 'تأیید مالی لازم است.' },
          en: { title: 'Finance review', body: 'Financial review is required.' },
        },
        params: {},
        linkRoute: '/admin/approval-requests',
        linkParams: null,
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: '01900000-0000-7000-8000-000000000002',
        operatingContext: 'account',
        type: 'auth.refresh_token_reused',
        titleI18nKey: 'notifications.legacy.title',
        bodyI18nKey: 'notifications.legacy.body',
        localizedContent: {
          fa: { title: 'امنیت حساب', body: 'نشست‌ها را بررسی کنید.' },
          en: { title: 'Account security', body: 'Review your sessions.' },
        },
        params: {},
        linkRoute: '/settings/security',
        linkParams: null,
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: '01900000-0000-7000-8000-000000000003',
        operatingContext: 'customer',
        type: 'payment.invoice_paid',
        titleI18nKey: 'notifications.legacy.title',
        bodyI18nKey: 'notifications.legacy.body',
        localizedContent: {
          fa: { title: 'پرداخت مشتری', body: 'فاکتور پرداخت شد.' },
          en: { title: 'Customer payment', body: 'Your invoice was paid.' },
        },
        params: {},
        linkRoute: '/invoices',
        linkParams: null,
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
      },
    ];
    await page.route('**/api/v1/notifications**', (route) => {
      const visible = notices.filter(
        (item) => item.operatingContext === operatingContext || item.operatingContext === 'account'
      );
      if (route.request().method() === 'PATCH') {
        const notice = notices.find((item) => route.request().url().includes(item.id));
        if (notice) notice.isRead = true;
        return route.fulfill({
          json: { unread_count: visible.filter((item) => !item.isRead).length },
        });
      }
      if (route.request().url().includes('/unread-count'))
        return route.fulfill({
          json: { unread_count: visible.filter((item) => !item.isRead).length },
        });
      return route.fulfill({
        json: {
          data: visible,
          next_cursor: null,
          unread_count: visible.filter((item) => !item.isRead).length,
        },
      });
    });

    await page.goto('/app');
    await expect(page.getByTestId('notification-bell')).toBeVisible();
    await page.getByTestId('notification-bell').click();
    await page.getByTestId('notification-panel').locator('a[href="/admin/inbox"]').click();
    await expect(page).toHaveURL(/\/admin\/inbox$/);
    await expect(page.locator('main')).toContainText(
      locale === 'fa' ? 'بررسی مالی' : 'Finance review'
    );

    await page.getByRole('button', { name: /امنیت حساب|Account security/ }).click();
    await expect(page).toHaveURL(/\/settings\/security$/);
    await expect(
      page.getByRole('heading', { name: t('settings.security.title', locale), exact: true })
    ).toBeVisible();
    await expect(page.locator('#admin-navigation')).toBeAttached();
    await page.goto('/admin/inbox');
    await page.getByRole('button', { name: /بررسی مالی|Finance review/ }).click();
    await expect(page).toHaveURL(/\/admin\/approval-requests$/);
    await page.evaluate(() => {
      document.cookie = 'barghsa_csrf=test-csrf; path=/';
    });
    await page.getByRole('button', { name: shellText('accountMenu', locale), exact: true }).click();
    await page.getByRole('button', { name: /Switch to customer|رفتن به حالت مشتری/ }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.getByTestId('notification-bell').click();
    await expect(page.getByTestId('notification-panel')).toContainText(
      locale === 'fa' ? 'پرداخت مشتری' : 'Customer payment'
    );
    await expect(page.getByTestId('notification-panel')).not.toContainText(
      locale === 'fa' ? 'بررسی مالی' : 'Finance review'
    );
    await page.goto('/admin/inbox');
    await expect(page).toHaveURL(/\/app$/);
  });
}
