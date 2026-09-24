import { expect, test } from './coverage-fixture';

const profileId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const contractId = '33333333-3333-4333-8333-333333333333';
const invoiceId = '44444444-4444-4444-8444-444444444444';

test('solar customer sees invoice payment, review, then published contract handoff', async ({
  page,
}) => {
  let invoiceState = 'Unpaid';
  let contractPublished = false;
  const request = () => ({
    id: requestId,
    profile_id: profileId,
    status: 'contract_created',
    status_reason: null,
    support_path: null,
    contract_id: contractId,
    contract_published: contractPublished,
    initial_invoice_id: invoiceId,
    initial_invoice_state: invoiceState,
    building_type: 'building_apartment',
    grid_type: 'on_grid',
    agreement_version: '2026-09',
    agreement_snapshot: 'Construction terms',
    agreement_accepted_at: '2026-09-23T10:00:00.000Z',
    submitted_at: '2026-09-23T10:00:00.000Z',
  });

  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({ json: { userId: 'buyer', requiresTosAcceptance: false } })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: profileId, profileType: 'INDIVIDUAL', title: 'Buyer' }],
        activeProfileId: profileId,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Pacific/Kiritimati' } })
  );
  await page.route('**/api/solar/requests?*', (route) =>
    route.fulfill({ json: { requests: [request()], nextBefore: null } })
  );
  await page.route(`**/api/solar/requests/${requestId}`, (route) =>
    route.fulfill({
      json: {
        request: request(),
        history: [
          { event: 'solar.request.submitted', at: '2026-09-23T10:00:00.000Z' },
          { event: 'solar.final.approve', at: '2026-09-24T10:00:00.000Z' },
          { event: 'solar.contract.created', at: '2026-09-24T11:00:00.000Z' },
        ],
      },
    })
  );

  await page.goto('/solar/requests');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  const row = page.getByRole('link', { name: /Contract created/ });
  await expect(row.locator('time')).toHaveText('09/24/2026');
  await expect(row).toContainText('Review and pay the issued invoice.');
  await expect(row).toContainText('Who acts next: You');
  await row.click();

  const summary = page.getByRole('region', { name: 'Status and next action' });
  const history = page.getByRole('region', { name: 'Request history' });
  await expect(history.getByRole('listitem')).toHaveCount(3);
  await expect(history.locator('time').first()).toContainText('Sep 24, 2026');
  await expect(history).toContainText('Contract and invoice created');
  await page.getByRole('button', { name: 'Switch language to Persian' }).click();
  await expect(page.getByRole('region', { name: 'تاریخچه درخواست' })).toContainText(
    'قرارداد و فاکتور ایجاد شد'
  );
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await expect(
    summary.getByRole('link', { name: 'Review and pay the issued invoice.' })
  ).toHaveAttribute('href', `/invoices/${invoiceId}`);
  await expect(summary).toContainText('Who acts next');
  await expect(summary).toContainText('You');

  invoiceState = 'PaymentUnderReview';
  await page.reload();
  await expect(summary).toContainText('Staff are reviewing your invoice payment.');
  await expect(summary).toContainText('Our team');
  await expect(
    summary.getByRole('link', { name: 'Review and pay the issued invoice.' })
  ).toHaveCount(0);

  invoiceState = 'Paid';
  contractPublished = true;
  await page.reload();
  await expect(summary.getByRole('link', { name: 'View contract' })).toHaveAttribute(
    'href',
    `/contracts?contractId=${contractId}`
  );
});
