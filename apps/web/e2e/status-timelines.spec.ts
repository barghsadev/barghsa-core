import { fullNavigation } from './navigation-fixture';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { contractText } from '@barghsa/i18n/contracts';
import { t } from '@barghsa/i18n/app';
import { tConsultation } from '@barghsa/i18n/consultation';

const id = '10000000-0000-4000-8000-000000000001';
const profileId = '20000000-0000-4000-8000-000000000001';
const currentVersionId = '30000000-0000-4000-8000-000000000001';
const oldVersionId = '40000000-0000-4000-8000-000000000001';
const firstAt = '2026-10-01T10:00:00.000Z';
const lastAt = '2026-10-02T10:00:00.000Z';

async function shell(page: Page, locale: 'en' | 'fa', staff = false) {
  await crmShell(page, locale);
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'timeline-user',
        isStaff: staff,
        operatingContext: staff ? 'staff' : 'customer',
        navigation: fullNavigation(staff ? 'staff' : 'customer'),
        canSwitchContext: false,
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        activeProfileId: profileId,
        hasDefault: true,
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

async function inspect(page: Page, tones: string[]) {
  const timeline = page.locator('[data-slot="status-timeline"]').first();
  await expect(timeline).toBeVisible();
  await expect(timeline.locator('li')).toHaveCount(tones.length);
  for (let index = 0; index < tones.length; index++)
    await expect(timeline.locator('[data-tone]').nth(index)).toHaveAttribute(
      'data-tone',
      tones[index]!
    );
  await expect(timeline.locator('time').first()).toHaveAttribute('datetime', firstAt);
  const bounds = (await timeline.boundingBox())!;
  for (const dot of await timeline.locator('[data-tone]').all()) {
    const marker = (await dot.boundingBox())!;
    expect(marker.x - 4).toBeGreaterThanOrEqual(bounds.x - 1);
    expect(marker.x + marker.width + 4).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  }
  expect(
    (await new AxeBuilder({ page }).include('[data-slot="status-timeline"]').analyze()).violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  return timeline;
}

for (const locale of ['en', 'fa'] as const) {
  for (const staff of [false, true]) {
    test(`contract timeline follows selected version and clears on account denial (${locale}, staff=${staff})`, async ({
      page,
    }, info) => {
      await shell(page, locale, staff);
      const word = (key: string) => contractText(key, locale);
      const base = `/api/${staff ? 'admin/' : ''}contracts`;
      let denied = false;
      const currentHistory = [
        {
          id: 'published',
          event: 'contract.published',
          at: firstAt,
          actorType: 'staff',
          actorName: 'نام Legal <script>',
          reason: null,
        },
        {
          id: 'accepted',
          event: 'contract.accepted',
          at: lastAt,
          actorType: 'customer',
          reason: '<script>private-note-is-literal</script>',
        },
      ];
      const oldHistory = [
        {
          id: 'completed',
          event: 'contract.completed',
          at: firstAt,
          actorType: 'system',
          reason: 'Older version recorded note',
        },
      ];
      const version = (old = false) => ({
        id: old ? oldVersionId : currentVersionId,
        versionNumber: old ? 1 : 2,
        content: { title: 'Stored terms', text: 'Read-only contract terms' },
        changeDescription: old ? 'Old published terms' : 'Current published terms',
        createdAt: firstAt,
        publishedAt: firstAt,
        acceptedAt: lastAt,
      });
      const contract = (old = false) => ({
        id,
        profileId,
        serviceType: 'savings',
        state: 'Completed',
        currentVersionId,
        ...(staff ? { currentVersion: version() } : { version: version(old), canAccept: false }),
        history: old ? oldHistory : currentHistory,
        historyTruncated: !old,
      });
      await page.route(`**${base}?*`, (route) =>
        route.fulfill({ json: { contracts: [], nextBefore: null } })
      );
      await page.route(`**${base}/${id}`, (route) =>
        denied
          ? route.fulfill({ status: 403, json: { error: 'AUTHZ:FORBIDDEN' } })
          : route.fulfill({ json: contract() })
      );
      await page.route(`**${base}/${id}/versions`, (route) =>
        route.fulfill({ json: { versions: [version(), version(true)], nextBefore: null } })
      );
      await page.route(`**${base}/${id}/versions/${oldVersionId}`, (route) =>
        route.fulfill({
          json: staff
            ? { ...version(true), history: oldHistory, historyTruncated: false }
            : contract(true),
        })
      );
      await page.route(`**${base}/${id}/activation?*`, (route) =>
        route.fulfill({
          json: { checks: [], isCurrent: false, ready: false, evaluatedAt: firstAt },
        })
      );
      await page.route(`**${base}/${id}/signature?*`, (route) =>
        route.fulfill({
          json: { request: null, signature: null, canRequest: false, canRecord: false },
        })
      );
      await page.route(`**/api/${staff ? 'admin/' : ''}documents?*`, (route) =>
        route.fulfill({ json: { documents: [], nextBefore: null } })
      );
      await page.goto(`/${staff ? 'admin/' : ''}contracts?contractId=${id}`);
      const timeline = await inspect(page, ['warning', 'success']);
      await expect(timeline).toContainText(word('timeline.contract.published'));
      await expect(timeline).toContainText(word('staff'));
      await expect(timeline.locator('bdi').first()).toContainText('نام Legal <script>');
      await expect(timeline).toContainText(word('customer'));
      await expect(timeline).toContainText('<script>private-note-is-literal</script>');
      await expect(timeline.locator('script')).toHaveCount(0);
      await expect(page.getByText(word('statusHistoryTruncated'), { exact: true })).toBeVisible();
      await page
        .getByRole('button', {
          name: `${word('version')} ${(1).toLocaleString(locale)}`,
          exact: true,
        })
        .click();
      const oldTimeline = await inspect(page, ['default']);
      await expect(oldTimeline).toContainText('Older version recorded note');
      await expect(oldTimeline).not.toContainText('private-note-is-literal');
      await expect(oldTimeline).not.toContainText('نام Legal <script>');
      await expect(page.getByText(word('statusHistoryTruncated'), { exact: true })).toHaveCount(0);
      if (locale === 'fa' && staff && info.project.name === 'mobile-safari')
        await oldTimeline.screenshot({
          path: '/tmp/barghsa-status-timeline-contract-fa-mobile-safari.png',
        });
      denied = true;
      await page.reload();
      await expect(page).not.toHaveURL(/contractId=/);
      await expect(page.locator('[data-slot="status-timeline"]')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('private-note-is-literal');
      await expect(page.locator('body')).not.toContainText('Older version recorded note');
    });
  }

  test(`customer order, consultation and receipt histories share localized status rendering (${locale})`, async ({
    page,
  }, info) => {
    await shell(page, locale);
    await page.route(`**/api/electricity/orders/${id}`, (route) =>
      route.fulfill({
        json: {
          orderId: id,
          profileId,
          mode: 'simple',
          electricityStatus: 'completed',
          financialStatus: 'paid',
          nextAction: 'none',
          periodStart: firstAt,
          periodEnd: lastAt,
          totalKwh: '10',
          fullAddress: 'Customer address',
          postalCode: '1234567890',
          contractId: id,
          contractState: 'Completed',
          versionId: currentVersionId,
          invoiceId: id,
          invoiceState: 'Paid',
          totalIrR: '1000',
          paidIrR: '1000',
          refundedIrR: '0',
          lines: [],
          timeline: [
            {
              id: 'one',
              event: 'electricity.order_submitted',
              at: firstAt,
              actor: 'internal-customer-id',
              reason: null,
              comment: null,
            },
            {
              id: 'two',
              event: 'electricity.order_review.reject',
              at: lastAt,
              actor: 'internal-staff-id',
              actorName: 'Chosen electricity staff <name>',
              actorContext: 'staff',
              reason: 'Recorded rejection reason',
              comment: 'Recorded customer comment',
            },
            {
              id: 'three',
              event: '__proto__',
              at: lastAt,
              actor: null,
              reason: null,
              comment: null,
            },
          ],
        },
      })
    );
    await page.goto(`/electricity/orders/${id}`);
    let timeline = await inspect(page, ['info', 'destructive', 'default']);
    await expect(timeline).toContainText(t('electricity.order.timeline.submitted', locale));
    await expect(timeline).toContainText(t('electricity.order.timeline.updated', locale));
    await expect(timeline).toContainText('Recorded rejection reason');
    await expect(timeline.locator('bdi').nth(1)).toHaveText(
      'Chosen electricity staff <name> · ' + t('history.context.staff', locale)
    );
    await expect(timeline).toContainText('Recorded customer comment');
    await expect(timeline).toContainText(t('history.context.staff', locale));
    await expect(timeline).toContainText(t('history.context.unknown', locale));
    await expect(page.locator('body')).not.toContainText('internal-staff-id');
    await expect(page.locator('body')).not.toContainText('__proto__');

    await page.route(`**/api/consultations/requests/${id}`, (route) =>
      route.fulfill({
        json: {
          request: {
            id,
            profile_id: profileId,
            status: 'completed',
            product_snapshot: { title: { en: 'Consultation', fa: 'مشاوره' } },
            submitted_at: firstAt,
            staff_owner_username: null,
            staff_team: null,
            fee: null,
            scope: null,
            deliverables: null,
            expected_next_step: null,
            offer_valid_until: null,
            invoice_id: null,
            invoice_state: null,
            has_paid_invoice: false,
            accepted_at: null,
          },
          history: [
            {
              status: 'submitted',
              created_at: firstAt,
              actor_type: 'customer',
              reason: 'Customer request note',
            },
            {
              status: 'completed',
              created_at: lastAt,
              actor_type: 'staff',
              actor_name: 'Chosen consultation staff نام',
              reason: 'Recorded completion note',
            },
            {
              status: 'private_future_status',
              created_at: lastAt,
              actor_type: 'private_future_actor',
              reason: null,
            },
          ],
          adjustments: [],
          refunds: [],
        },
      })
    );
    await page.goto(`/consultations/${id}`);
    timeline = await inspect(page, ['info', 'default', 'default']);
    await expect(timeline).toContainText(tConsultation('status_submitted', locale));
    await expect(timeline).toContainText(t('history.context.staff', locale));
    await expect(timeline).toContainText('Chosen consultation staff نام');
    await expect(timeline).toContainText(tConsultation('status_unknown', locale));
    await expect(timeline).toContainText('Recorded completion note');
    await expect(timeline).not.toContainText('private_future');
    await expect(timeline).toContainText(t('history.context.customer', locale));
    await expect(timeline).toContainText(t('history.context.unknown', locale));

    const invoice = {
      invoiceId: id,
      role: 'original',
      state: 'Paid',
      totalAmount: '1000',
      paidAmount: '1000',
      refundedAmount: '0',
      accountingAmount: null,
      adjustmentKind: null,
      issuedAt: firstAt,
      payableFrom: firstAt,
      dueAt: lastAt,
      cancelledAt: null,
      createdAt: firstAt,
      replacesInvoiceId: null,
      adjustmentForInvoiceId: null,
      explanation: null,
      lines: [],
    };
    await page.route(`**/api/invoices/${id}`, (route) =>
      route.fulfill({
        json: {
          viewedInvoiceId: id,
          originalInvoiceId: id,
          invoice,
          chain: [invoice],
          payments: [],
          refunds: [],
          bankReceipts: [
            {
              id: currentVersionId,
              amount: '1000',
              state: 'Confirmed',
              paymentDate: '2026-10-01',
              payerReference: 'Customer bank reference',
              bankName: null,
              customerNote: null,
              rejectionReason: null,
              confirmedAt: lastAt,
              createdAt: firstAt,
              statusHistory: [
                { state: 'Submitted', occurredAt: firstAt, backfilled: false },
                { state: 'UnderReview', occurredAt: lastAt, backfilled: true },
                { state: 'Confirmed', occurredAt: lastAt, backfilled: false },
              ],
            },
          ],
        },
      })
    );
    await page.goto(`/invoices/${id}`);
    timeline = await inspect(page, ['info', 'warning', 'success']);
    await expect(timeline).toContainText(t('invoices.activity.state.Confirmed', locale));
    await expect(timeline).toContainText(t('invoices.activity.historicalTime', locale));
    if (locale === 'fa' && info.project.name === 'mobile-safari')
      await timeline.screenshot({
        path: '/tmp/barghsa-status-timeline-receipt-fa-mobile-safari.png',
      });
  });
}
