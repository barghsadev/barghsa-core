import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './coverage-fixture';

const profileId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const invoiceId = '44444444-4444-4444-8444-444444444444';
const submittedAt = '2026-09-23T10:00:00.000Z';
const title = { en: 'Energy consultation', fa: 'مشاوره انرژی' };

test('customer consultation moves through staff offer, payment handoff, and completion', async ({
  page,
}) => {
  let status = 'submitted';
  let submitted = false;
  let acceptedAt: string | null = null;
  let invoiceState = 'Unpaid';
  let operatingContext: 'customer' | 'staff' = 'customer';
  let offer: { fee: string; scope: string; deliverables: string; validUntil: string } | null = null;
  const history: Array<{
    status: string;
    actor_type: 'staff' | 'customer';
    reason: string | null;
    created_at: string;
  }> = [{ status: 'submitted', actor_type: 'customer', reason: null, created_at: submittedAt }];
  const customerRequest = () => ({
    id: requestId,
    status,
    product_snapshot: { title },
    submitted_at: submittedAt,
    staff_owner_username: null,
    staff_team: null,
    fee: offer?.fee ?? null,
    scope: offer?.scope ?? null,
    deliverables: offer?.deliverables ?? null,
    expected_next_step: null,
    offer_valid_until: offer?.validUntil ?? null,
    invoice_id: offer ? invoiceId : null,
    invoice_state: offer ? invoiceState : null,
    has_paid_invoice: offer !== null && invoiceState === 'Paid',
    accepted_at: acceptedAt,
  });
  const staffRequest = () => ({
    ...customerRequest(),
    profile_id: profileId,
    profile_name: 'Buyer Example',
    staff_owner_id: null,
    priority: 'normal',
    uncovered_credit: '0',
  });

  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        isStaff: true,
        userId: 'buyer',
        operatingContext,
        canSwitchContext: true,
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [
          {
            id: profileId,
            profileType: 'INDIVIDUAL',
            firstName: 'Buyer',
            lastName: 'Example',
            title: null,
          },
        ],
        activeProfileId: profileId,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/consultations/products?*', (route) =>
    route.fulfill({
      json: {
        products: [
          {
            id: productId,
            systemKey: null,
            title,
            description: { en: 'Plan an efficient supply.', fa: 'برنامه‌ریزی تأمین بهینه.' },
          },
        ],
      },
    })
  );
  await page.route('**/api/consultations/requests?*', (route) =>
    route.fulfill({ json: { requests: submitted ? [customerRequest()] : [], nextBefore: null } })
  );
  await page.route('**/api/consultations/requests', (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toMatchObject({ profileId, productId });
    submitted = true;
    return route.fulfill({ status: 201, json: { requestId } });
  });
  await page.route(`**/api/consultations/requests/${requestId}`, (route) =>
    route.fulfill({ json: { request: customerRequest(), history, adjustments: [], refunds: [] } })
  );
  await page.route('**/api/admin/consultations/teams', (route) =>
    route.fulfill({ json: { teams: [] } })
  );
  await page.route('**/api/admin/consultations/requests?*', (route) =>
    route.fulfill({ json: { requests: submitted ? [staffRequest()] : [], nextAfter: null } })
  );
  await page.route(`**/api/admin/consultations/requests/${requestId}`, (route) =>
    route.fulfill({ json: { request: staffRequest(), history } })
  );
  await page.route(`**/api/admin/consultations/requests/${requestId}/review`, (route) => {
    expect(status).toBe('submitted');
    status = 'under_review';
    history.push({ status, actor_type: 'staff', reason: null, created_at: submittedAt });
    return route.fulfill({ json: { status } });
  });
  await page.route(`**/api/admin/consultations/requests/${requestId}/fee`, (route) => {
    expect(status).toBe('under_review');
    const input = route.request().postDataJSON() as Record<string, string>;
    expect(input).toMatchObject({
      fee: '500000',
      scope: 'Supply assessment',
      deliverables: 'Written report',
    });
    offer = {
      fee: input.fee!,
      scope: input.scope!,
      deliverables: input.deliverables!,
      validUntil: input.validUntil!,
    };
    status = 'offer_pending';
    history.push({ status, actor_type: 'staff', reason: null, created_at: submittedAt });
    return route.fulfill({ json: { status, invoiceId } });
  });
  await page.route(`**/api/consultations/requests/${requestId}/accept`, (route) => {
    expect(status).toBe('offer_pending');
    expect(route.request().postDataJSON()).toEqual({ expectedReviewHash: 'b'.repeat(64) });
    acceptedAt = submittedAt;
    return route.fulfill({
      json: { paymentRequired: true, invoiceId, financialReview: { hash: 'b'.repeat(64) } },
    });
  });
  await page.route(`**/api/consultations/requests/${requestId}/offer-review`, (route) => {
    const { decision } = route.request().postDataJSON() as { decision: 'accept' | 'decline' };
    expect(['accept', 'decline']).toContain(decision);
    expect(offer).not.toBeNull();
    return route.fulfill({
      json: {
        schemaVersion: 1,
        hash: (decision === 'accept' ? 'b' : 'c').repeat(64),
        scope: {
          action: `consultation.offer-${decision}`,
          profileId,
          resourceId: requestId,
        },
        data: {
          decision,
          serviceTitle: title,
          scope: offer!.scope,
          deliverables: offer!.deliverables,
          fee: offer!.fee,
          previousFee: '0',
          validUntil: offer!.validUntil,
          acceptedAt: null,
          invoice: {
            id: invoiceId,
            state: 'Unpaid',
            totalAmount: offer!.fee,
            paidAmount: '0',
            adjustmentKind: null,
          },
          outcome: decision === 'accept' ? 'payment_required' : 'cancel_unpaid_invoice',
        },
      },
    });
  });
  await page.route(`**/api/admin/consultations/requests/${requestId}/complete`, (route) => {
    expect(status).toBe('offer_accepted');
    expect(route.request().postDataJSON()).toEqual({ reason: 'Consultation delivered' });
    status = 'completed';
    history.push({
      status,
      actor_type: 'staff',
      reason: 'Consultation delivered',
      created_at: submittedAt,
    });
    return route.fulfill({ json: { status } });
  });

  await page.goto('/consultations');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await expect(page.getByRole('heading', { name: 'Consultations' })).toBeVisible();
  await page.getByRole('radio', { name: /Energy consultation/ }).check();
  await page
    .getByRole('checkbox', { name: 'I confirm this request is for the selected profile.' })
    .check();
  await page.getByRole('button', { name: 'Request consultation' }).click();
  await expect(page).toHaveURL(new RegExp(`/consultations/${requestId}$`));
  await expect(
    page.getByText('Staff have not proposed a fee yet. No invoice has been created.')
  ).toBeVisible();

  operatingContext = 'staff';
  await page.goto('/admin/consultations');
  await expect(page.getByRole('heading', { name: 'Consultation work queue' })).toBeVisible();
  await page.getByRole('button', { name: /Energy consultation.*Buyer Example/ }).click();
  await page.getByRole('button', { name: 'Start review' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('button', { name: 'Issue fee offer and invoice' })).toBeVisible();
  await page.getByLabel('Fee (IRR)').fill('500000');
  await page.getByLabel('Offer valid until').fill('2030-01-01T12:30');
  await page.getByLabel('Scope').fill('Supply assessment');
  await page.getByLabel('Deliverables').fill('Written report');
  await page.getByRole('button', { name: 'Issue fee offer and invoice' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => status).toBe('offer_pending');
  const savedOffer = page.getByRole('region', { name: 'Current fee offer' });
  await expect(savedOffer).toContainText('500,000 IRR');
  await expect(savedOffer).toContainText('Supply assessment');
  await expect(savedOffer).toContainText('Written report');
  await expect(savedOffer.locator('time')).toHaveAttribute('datetime', offer!.validUntil);
  await expect(savedOffer).toContainText('Awaiting payment');
  await expect(savedOffer.getByRole('link', { name: 'View invoice' })).toHaveAttribute(
    'href',
    `/admin/invoices?invoiceId=${invoiceId}`
  );

  operatingContext = 'customer';
  await page.goto(`/consultations/${requestId}`);
  await expect(page.getByText('Supply assessment')).toBeVisible();
  await expect(page.getByText('Written report')).toBeVisible();
  await page.getByRole('button', { name: 'Switch language to Persian' }).click();
  await page.getByRole('button', { name: 'رد پیشنهاد' }).click();
  const declineReview = page.getByRole('dialog', { name: 'بررسی پیشنهاد مشاوره' });
  await expect(declineReview).toContainText('Supply assessment');
  await expect(declineReview).toContainText('لغو');
  const scan = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(scan.violations).toEqual([]);
  await declineReview.getByRole('button', { name: 'بازگشت به پیشنهاد' }).click();
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await page.getByRole('button', { name: 'Accept offer and pay' }).click();
  const review = page.getByRole('dialog', { name: 'Review consultation offer' });
  await expect(review).toContainText('500,000');
  await expect(review).toContainText('Supply assessment');
  await expect(review).toContainText('Written report');
  await review.getByRole('button', { name: 'Accept offer and pay' }).click();
  await expect(page).toHaveURL(new RegExp(`/invoices/${invoiceId}$`));
  await expect(page.getByRole('heading', { name: 'Invoice details' })).toBeVisible();
  expect(acceptedAt).toBe(submittedAt);

  await page.goto(`/consultations/${requestId}`);
  await expect(
    page.getByRole('region', { name: 'Status and next action' }).getByRole('link', {
      name: 'You accepted this offer. Pay the invoice to start the consultation.',
    })
  ).toHaveAttribute('href', `/invoices/${invoiceId}`);
  await page.goto('/consultations');
  await expect(page.getByRole('link', { name: 'View invoice' })).toHaveAttribute(
    'href',
    `/invoices/${invoiceId}`
  );

  // Invoice settlement is covered by finance tests; this fixture resumes at its confirmed result.
  invoiceState = 'Paid';
  status = 'offer_accepted';
  history.push({ status, actor_type: 'customer', reason: null, created_at: submittedAt });
  operatingContext = 'staff';
  await page.goto('/admin/consultations');
  await page.getByRole('button', { name: /Energy consultation.*Buyer Example/ }).click();
  await page.getByLabel('Reason or information requested').fill('Consultation delivered');
  await page.getByRole('button', { name: 'Mark completed' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => status).toBe('completed');

  operatingContext = 'customer';
  await page.goto(`/consultations/${requestId}`);
  await expect(page.getByRole('heading', { name: 'Status history' })).toBeVisible();
  await expect(page.locator('ol').getByText('Consultation delivered')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Status and next action' })).toContainText(
    'Completed'
  );
});
