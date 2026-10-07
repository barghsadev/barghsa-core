import { tConsultation as consultationCopy } from '@barghsa/i18n/consultation';
import { t as appCopy } from '@barghsa/i18n/app';
import { fullNavigation } from './navigation-fixture';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './coverage-fixture';
import { shellText } from '@barghsa/i18n/shell';

async function switchLanguage(page: Page, locale: 'en' | 'fa') {
  const switcher = page.getByRole('button', { name: shellText('language', locale), exact: true });
  const compact = !(await switcher.isVisible());
  if (compact)
    await page.getByRole('button', { name: shellText('accountMenu', locale), exact: true }).click();
  await switcher.click();
  if (compact) await page.keyboard.press('Escape');
}

const profileId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const invoiceId = '44444444-4444-4444-8444-444444444444';
const submittedAt = '2026-09-23T10:00:00.000Z';
const title = { en: 'Energy consultation', fa: 'مشاوره انرژی' };

for (const locale of ['en', 'fa'] as const)
  test(`customer consultation moves through staff offer, payment handoff, and completion (${locale})`, async ({
    page,
  }) => {
    let status = 'submitted';
    let submitted = false;
    let acceptedAt: string | null = null;
    let invoiceState = 'Unpaid';
    let operatingContext: 'customer' | 'staff' = 'customer';
    let quotedFee: unknown = null;
    let offer: { fee: string; scope: string; deliverables: string; validUntil: string } | null =
      null;
    const history: Array<{
      status: string;
      actor_type: 'staff' | 'customer';
      reason: string | null;
      created_at: string;
    }> = [{ status: 'submitted', actor_type: 'customer', reason: null, created_at: submittedAt }];
    const customerRequest = () => ({
      id: requestId,
      profile_id: profileId,
      status,
      product_snapshot: { title },
      submitted_at: submittedAt,
      staff_owner_username: null,
      staff_owner_id: status === 'submitted' ? null : 'private-owner-id',
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
          navigation: fullNavigation(operatingContext),
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
      return route.fulfill({ status: 201, json: { requestId, status: 'submitted' } });
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
      return route.fulfill({ json: { requestId, status } });
    });
    await page.route(`**/api/admin/consultations/requests/${requestId}/fee-review`, (route) => {
      const input = route.request().postDataJSON() as Record<string, string>;
      quotedFee = {
        schemaVersion: 1,
        hash: 'a'.repeat(64),
        scope: { action: 'consultation.fee-offer', profileId, resourceId: requestId },
        data: {
          serviceTitle: title,
          profileName: 'Buyer Example',
          scope: input.scope,
          deliverables: input.deliverables,
          fee: input.fee,
          validUntil: input.validUntil,
          reason: null,
          previousInvoice: null,
          outcome: 'issue_invoice',
        },
      };
      return route.fulfill({ json: quotedFee });
    });
    await page.route(`**/api/admin/consultations/requests/${requestId}/fee`, (route) => {
      expect(status).toBe('under_review');
      const input = route.request().postDataJSON() as Record<string, string>;
      expect(input).toMatchObject({
        expectedReviewHash: 'a'.repeat(64),
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
      return route.fulfill({
        json: { requestId, status, invoiceId, financialReview: quotedFee },
      });
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
      return route.fulfill({ json: { requestId, status } });
    });

    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.goto('/consultations');
    await expect(
      page.getByRole('heading', { name: consultationCopy('title', locale) })
    ).toBeVisible();
    await page.getByRole('radio', { name: new RegExp(title[locale]) }).check();
    await page.getByRole('checkbox', { name: consultationCopy('confirm', locale) }).check();
    await page.getByRole('button', { name: consultationCopy('request', locale) }).click();
    await expect(page).toHaveURL(new RegExp(`/consultations/${requestId}$`));
    await expect(page.getByText(consultationCopy('noFee', locale))).toBeVisible();

    operatingContext = 'staff';
    await page.goto('/admin/consultations');
    await expect(
      page.getByRole('heading', { name: consultationCopy('staffTitle', locale) })
    ).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`${title[locale]}.*Buyer Example`) }).click();
    await page.getByRole('button', { name: consultationCopy('startReview', locale) }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: appCopy('team.confirm', locale) })
      .click();
    await expect(
      page.getByRole('button', { name: consultationCopy('issueFee', locale) })
    ).toBeVisible();
    await page.getByLabel(consultationCopy('feeIrr', locale)).fill('500000');
    await page.getByLabel(consultationCopy('offerValidUntil', locale)).fill('2030-01-01T12:30');
    await page.getByLabel(consultationCopy('scope', locale)).fill('Supply assessment');
    await page.getByLabel(consultationCopy('deliverables', locale)).fill('Written report');
    await page.getByRole('button', { name: consultationCopy('issueFee', locale) }).click();
    const feeReview = page.getByRole('dialog', { name: consultationCopy('issueFee', locale) });
    await expect(feeReview).toContainText(consultationCopy('feeReviewTitle', locale));
    await expect(feeReview).toContainText('Supply assessment');
    await expect(feeReview).toContainText('Written report');
    await expect(feeReview).toContainText(`${new Intl.NumberFormat(locale).format(500000)} IRR`);
    await feeReview.getByRole('button', { name: appCopy('team.confirm', locale) }).click();
    await expect.poll(() => status).toBe('offer_pending');
    const savedOffer = page.getByRole('region', { name: consultationCopy('savedOffer', locale) });
    await expect(savedOffer).toContainText(`${new Intl.NumberFormat(locale).format(500000)} IRR`);
    await expect(savedOffer).toContainText('Supply assessment');
    await expect(savedOffer).toContainText('Written report');
    await expect(savedOffer.locator('time')).toHaveAttribute('datetime', offer!.validUntil);
    await expect(savedOffer).toContainText(consultationCopy('invoice_state_Unpaid', locale));
    await expect(
      savedOffer.getByRole('link', { name: consultationCopy('viewInvoice', locale) })
    ).toHaveAttribute('href', `/admin/invoices?invoiceId=${invoiceId}`);

    operatingContext = 'customer';
    await page.goto(`/consultations/${requestId}`);
    await expect(
      page.getByText(consultationCopy('assignedStaff', locale), { exact: true })
    ).toBeVisible();
    await expect(page.locator('#dashboard-content')).not.toContainText('private-owner-id');
    expect(
      (
        await new AxeBuilder({ page })
          .include('#dashboard-content')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations
    ).toEqual([]);
    await expect(page.getByText('Supply assessment')).toBeVisible();
    await expect(page.getByText('Written report')).toBeVisible();
    const alternate = locale === 'en' ? 'fa' : 'en';
    await switchLanguage(page, locale);
    await page.getByRole('button', { name: consultationCopy('declineOffer', alternate) }).click();
    const declineReview = page.getByRole('dialog', {
      name: consultationCopy('decisionReviewTitle', alternate),
    });
    await expect(declineReview).toContainText('Supply assessment');
    await expect(declineReview).toContainText(
      consultationCopy('decisionReviewCancelOutcome', alternate)
    );
    // Contrast must be measured after the shared dialog's fade-in finishes.
    await expect(declineReview).toHaveCSS('opacity', '1');
    const scan = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(scan.violations).toEqual([]);
    await declineReview
      .getByRole('button', { name: consultationCopy('decisionReviewClose', alternate) })
      .click();
    await switchLanguage(page, alternate);
    await page.getByRole('button', { name: consultationCopy('acceptOffer', locale) }).click();
    const review = page.getByRole('dialog', {
      name: consultationCopy('decisionReviewTitle', locale),
    });
    await expect(review).toContainText(new Intl.NumberFormat(locale).format(500000));
    await expect(review).toContainText('Supply assessment');
    await expect(review).toContainText('Written report');
    await review.getByRole('button', { name: consultationCopy('acceptOffer', locale) }).click();
    await expect(page).toHaveURL(new RegExp(`/invoices/${invoiceId}$`));
    await expect(
      page.getByRole('heading', { name: appCopy('invoices.details.title', locale) })
    ).toBeVisible();
    expect(acceptedAt).toBe(submittedAt);

    await page.goto(`/consultations/${requestId}`);
    await expect(
      page.getByRole('region', { name: appCopy('workflow.summary', locale) }).getByRole('link', {
        name: consultationCopy('acceptedAwaitingPayment', locale),
      })
    ).toHaveAttribute('href', `/invoices/${invoiceId}`);
    await page.goto('/consultations');
    await expect(
      page.getByRole('link', { name: consultationCopy('viewInvoice', locale) })
    ).toHaveAttribute('href', `/invoices/${invoiceId}`);

    // Invoice settlement is covered by finance tests; this fixture resumes at its confirmed result.
    invoiceState = 'Paid';
    status = 'offer_accepted';
    history.push({ status, actor_type: 'customer', reason: null, created_at: submittedAt });
    operatingContext = 'staff';
    await page.goto('/admin/consultations');
    await page.getByRole('button', { name: new RegExp(`${title[locale]}.*Buyer Example`) }).click();
    await page.getByLabel(consultationCopy('note', locale)).fill('Consultation delivered');
    await page.getByRole('button', { name: consultationCopy('complete', locale) }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: appCopy('team.confirm', locale) })
      .click();
    await expect.poll(() => status).toBe('completed');
    // Wait for the committed detail and pending route update before switching fixture context.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.locator('ol').getByText('Consultation delivered', { exact: true })
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/admin/consultations\\?requestId=${requestId}$`));

    operatingContext = 'customer';
    await page.goto(`/consultations/${requestId}`);
    await expect(
      page.getByRole('heading', { name: consultationCopy('history', locale) })
    ).toBeVisible();
    await expect(page.locator('ol').getByText('Consultation delivered')).toBeVisible();
    await expect(
      page.getByRole('region', { name: appCopy('workflow.summary', locale) })
    ).toContainText(consultationCopy('status_completed', locale));
  });
