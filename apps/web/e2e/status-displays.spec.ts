import { test, expect, type Page } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/app';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { crmShell } from './crm-shell-fixture';

const profileId = '10000000-0000-4000-8000-000000000001';
const orderId = '20000000-0000-4000-8000-000000000001';
async function customerShell(page: Page, locale: 'en' | 'fa') {
  await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'status-customer',
        isStaff: false,
        operatingContext: 'customer',
        canSwitchContext: false,
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        activeProfileId: profileId,
        profiles: [
          {
            id: profileId,
            profileType: 'INDIVIDUAL',
            firstName: 'Test',
            lastName: 'Customer',
            status: 'ACTIVE',
          },
        ],
      },
    })
  );
  await page.route('**/api/profiles/verification-status', (route) =>
    route.fulfill({ json: { activeProfileId: profileId } })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
}

for (const locale of ['en', 'fa'] as const) {
  test(`electricity list labels service and payment independently in both layouts (${locale})`, async ({
    page,
  }, testInfo) => {
    await customerShell(page, locale);
    let reads = 0;
    const states = [
      ['active', 'unpaid', 'success', 'warning'],
      ['completed', 'paid', 'default', 'success'],
      ['draft', 'partially_funded', 'info', 'warning'],
      ['pending_private_future', 'future_paid_state', 'default', 'default'],
    ] as const;
    await page.route('**/api/electricity/orders?*', (route) => {
      reads++;
      return route.fulfill({
        json: {
          orders: states.map(([electricityStatus, financialStatus], i) => ({
            orderId: `20000000-0000-4000-8000-00000000000${i + 1}`,
            electricityStatus,
            financialStatus,
            nextAction: 'none',
            submittedAt: '2026-09-30T09:00:00Z',
            periodStart: '2026-09-30T09:00:00Z',
            periodEnd: '2026-10-30T09:00:00Z',
            totalKwh: '10',
            totalIrR: '10000',
          })),
          nextBefore: null,
        },
      });
    });
    await page.goto('/electricity/orders');
    for (const layout of ['table', 'card'] as const) {
      await page
        .getByRole('button', { name: t(`historyView.${layout}`, locale), exact: true })
        .click();
      const rows = page.locator('[data-slot="dual-status-display"]');
      await expect(rows).toHaveCount(4);
      for (let i = 0; i < states.length; i++) {
        const [commercial, financial, commercialTone, financialTone] = states[i]!;
        const commercialLabel = t('electricity.order.commercialStatus', locale);
        const financialLabel = t('electricity.order.financialStatus', locale);
        const commercialText = t(
          i === 3 ? 'electricity.order.status.unknown' : `electricity.order.status.${commercial}`,
          locale
        );
        const financialText = t(
          i === 3 ? 'electricity.order.status.unknown' : `electricity.order.financial.${financial}`,
          locale
        );
        await expect(rows.nth(i).locator('dt')).toHaveText([commercialLabel, financialLabel]);
        await expect(rows.nth(i).locator('dd')).toHaveText([commercialText, financialText]);
        await expect(rows.nth(i).locator('[data-slot="badge"]').nth(0)).toHaveAttribute(
          'data-variant',
          commercialTone
        );
        await expect(rows.nth(i).locator('[data-slot="badge"]').nth(1)).toHaveAttribute(
          'data-variant',
          financialTone
        );
        await expect(rows.nth(i).locator('[data-slot="badge"]').nth(0)).toHaveAttribute(
          'title',
          `${commercialLabel}: ${commercialText}`
        );
        await expect(rows.nth(i).locator('[data-slot="badge"]').nth(1)).toHaveAttribute(
          'title',
          `${financialLabel}: ${financialText}`
        );
      }
      await expect(page.locator('body')).not.toContainText('pending_private_future');
      await expect(page.locator('body')).not.toContainText('future_paid_state');
      expect(
        (await new AxeBuilder({ page }).include('[data-slot="dual-status-display"]').analyze())
          .violations
      ).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
    }
    expect(reads).toBe(1);
    if (locale === 'fa')
      await page
        .locator('[data-slot="dual-status-display"]')
        .first()
        .screenshot({
          path: `/tmp/barghsa-status-orders-fa-${testInfo.project.name}.png`,
        });
  });

  test(`notification categories stay labeled with icons in inbox and bell (${locale})`, async ({
    page,
  }) => {
    await customerShell(page, locale);
    const categories = ['security', 'payment', 'contract', 'order', 'document', 'system'];
    await page.route('**/api/v1/notifications/unread-count', (route) =>
      route.fulfill({ json: { unread_count: 6 } })
    );
    await page.route('**/api/v1/notifications?*', (route) =>
      route.fulfill({
        json: {
          data: categories.map((type, i) => ({
            id: `30000000-0000-4000-8000-00000000000${i + 1}`,
            type: `${type}.event`,
            titleI18nKey: '',
            bodyI18nKey: '',
            localizedContent: {
              en: { title: `Notice ${i + 1}`, body: 'Customer notice' },
              fa: { title: `پیام ${i + 1}`, body: 'اعلان مشتری' },
            },
            params: {},
            linkRoute: null,
            linkParams: null,
            isRead: false,
            readAt: null,
            createdAt: '2026-09-30T09:00:00Z',
          })),
          next_cursor: null,
          unread_count: 6,
        },
      })
    );
    await page.goto('/notifications');
    const inbox = page.getByRole('main').last();
    await expect(inbox.locator('[data-slot="notification-status-badge"]')).toHaveCount(6);
    await page.getByTestId('notification-bell').click();
    const panel = page.getByTestId('notification-panel');
    await expect(panel.locator('[data-slot="notification-status-badge"]')).toHaveCount(6);
    for (const scope of [inbox, panel])
      for (const category of categories) {
        const label = t(`notifications.type.${category}`, locale);
        const badge = scope
          .locator('[data-slot="notification-status-badge"]')
          .filter({ hasText: label });
        await expect(badge).toBeVisible();
        await expect(badge).toHaveAttribute('title', label);
        await expect(badge.locator('svg[aria-hidden="true"]')).toBeVisible();
      }
    expect(
      (await new AxeBuilder({ page }).include('[data-testid="notification-panel"]').analyze())
        .violations
    ).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  });

  test(`staff order statuses retain translated meanings outside the review queue (${locale})`, async ({
    page,
  }) => {
    await crmShell(page, locale);
    let unknown = false;
    await page.route('**/api/staff/electricity/orders', (route) =>
      route.fulfill({ json: { orders: [], nextAfter: null } })
    );
    await page.route(`**/api/staff/electricity/orders/${orderId}`, (route) =>
      route.fulfill({
        json: {
          orderId,
          contractId: null,
          contractState: null,
          invoiceId: '40000000-0000-4000-8000-000000000001',
          invoiceState: 'Paid',
          customerName: 'Electricity Buyer',
          commercialStatus: unknown ? 'pending_private_future' : 'completed',
          financialStatus: unknown ? 'future_paid_state' : 'paid',
          submittedAt: '2026-09-30T09:00:00Z',
          periodStart: '2026-09-30T09:00:00Z',
          periodEnd: '2026-10-30T09:00:00Z',
          totalKwh: '10',
          totalIrR: '1000',
          paidIrR: '1000',
          fullAddress: 'Electricity Street',
          pricingSnapshot: { lines: [] },
          settingsSnapshot: {},
          contractSnapshot: {},
          revisionReview: null,
          timeline: [],
        },
      })
    );
    await page.route(`**/api/staff/electricity/orders/${orderId}/comments*`, (route) =>
      route.fulfill({ json: { comments: [], nextBefore: null } })
    );
    await page.goto(`/admin/electricity-orders?orderId=${orderId}`);
    const status = page.locator('[data-slot="dual-status-display"]');
    await expect(status.locator('dt')).toHaveText([
      adminText('admin.electricityOrders.commercial', locale),
      adminText('admin.electricityOrders.financial', locale),
    ]);
    await expect(status.locator('dd')).toHaveText([
      t('electricity.order.status.completed', locale),
      adminText('admin.electricityOrders.financial.paid', locale),
    ]);
    await expect(status.locator('[data-slot="badge"]').first()).toHaveAttribute(
      'data-variant',
      'default'
    );
    await expect(status.locator('[data-slot="badge"]').last()).toHaveAttribute(
      'data-variant',
      'success'
    );
    unknown = true;
    await page.reload();
    await expect(status.locator('dd')).toHaveText([
      t('electricity.order.status.unknown', locale),
      t('electricity.order.status.unknown', locale),
    ]);
    await expect(status.locator('[data-slot="badge"]').first()).toHaveAttribute(
      'data-variant',
      'default'
    );
    await expect(status.locator('[data-slot="badge"]').last()).toHaveAttribute(
      'data-variant',
      'default'
    );
    await expect(page.locator('body')).not.toContainText('pending_private_future');
    await expect(page.locator('body')).not.toContainText('future_paid_state');
    expect(
      (await new AxeBuilder({ page }).include('[data-slot="dual-status-display"]').analyze())
        .violations
    ).toEqual([]);
  });
}
