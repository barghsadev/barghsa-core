import { createHash } from 'node:crypto';
import { tConsultation as consultationCopy } from '@barghsa/i18n/consultation';
import { t as appCopy } from '@barghsa/i18n/app';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { tWalletInvoicePayment as walletCopy } from '@barghsa/i18n/wallet-invoice-payment';
import type { WalletPaymentReviewData } from '@barghsa/shared/finance';
import { fullNavigation } from './navigation-fixture';
import { approveRiskConfirmation } from './confirmation-fixture';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type Route } from './coverage-fixture';
import { shellText } from '@barghsa/i18n/shell';

async function switchLanguage(page: Page, locale: 'en' | 'fa') {
  const switcher = page.getByRole('button', { name: shellText('language', locale), exact: true });
  const compact = !(await switcher.isVisible());
  if (compact)
    await page.getByRole('button', { name: shellText('accountMenu', locale), exact: true }).click();
  await switcher.click();
  if (compact) await page.keyboard.press('Escape');
}

async function expectOfferTextFits(
  page: Page,
  surface: Locator,
  fields: readonly { value: string; direction: 'ltr' | 'rtl' }[]
) {
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: viewport.height });
  for (const { value, direction } of fields) {
    const text = surface.getByText(value, { exact: true });
    await expect(text).toBeVisible();
    await expect(text).toHaveCSS('direction', direction);
    const fits = await text.evaluate((node) => {
      const bounds = node.parentElement!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(node);
      return Array.from(range.getClientRects()).every(
        (line) => line.left >= bounds.left - 1 && line.right <= bounds.right + 1
      );
    });
    expect(fits, `Full ${direction} offer text fits its row at 320px`).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize(viewport);
}

const profileId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const invoiceId = '44444444-4444-4444-8444-444444444444';
const transactionId = '55555555-5555-4555-8555-555555555555';
const submittedAt = '2026-09-23T10:00:00.000Z';
const title = { en: 'Energy consultation', fa: 'مشاوره انرژی' };

for (const locale of ['en', 'fa'] as const)
  test(`customer consultation moves through staff offer, payment handoff, and completion (${locale})`, async ({
    page,
  }) => {
    const reference = `CONSULTATION-${'2026ENERGY'.repeat(10)}`;
    const scope = {
      value:
        locale === 'fa'
          ? `لورم ایپسوم ارزیابی تأمین انرژی ${reference}`
          : `Supply assessment ${reference}`,
      direction: locale === 'fa' ? 'rtl' : 'ltr',
    } as const;
    const deliverables = {
      value:
        locale === 'fa' ? `Written report ${reference}` : `گزارش مکتوب بررسی انرژی ${reference}`,
      direction: locale === 'fa' ? 'ltr' : 'rtl',
    } as const;
    const fields = [scope, deliverables];
    let status = 'submitted';
    let submitted = false;
    let acceptedAt: string | null = null;
    let invoiceState = 'Unpaid';
    let staffOwnerId: string | null = null;
    let reviewWrites = 0;
    let operatingContext: 'customer' | 'staff' = 'customer';
    let quotedFee: unknown = null;
    let offer: { fee: string; scope: string; deliverables: string; validUntil: string } | null =
      null;
    let heldPreview: Route | undefined;
    let heldAccept: Route | undefined;
    let offerReads = 0;
    const offerDecisions: Array<'accept' | 'decline'> = [];
    const acceptWrites: unknown[] = [];
    const walletPayments: unknown[] = [];
    const offerReview = (decision: 'accept' | 'decline') => ({
      schemaVersion: 1,
      hash: (decision === 'accept' ? 'b' : 'c').repeat(64),
      scope: { action: `consultation.offer-${decision}`, profileId, resourceId: requestId },
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
    });
    const acceptReceipt = () => ({
      requestId,
      status: 'offer_pending',
      paymentRequired: true,
      invoiceId,
      financialReview: offerReview('accept'),
    });
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
      staff_owner_id: staffOwnerId,
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
    await page.route(`**/api/consultations/requests/${requestId}`, (route) => {
      offerReads++;
      return route.fulfill({
        json: {
          request:
            offerReads === 1
              ? { ...customerRequest(), scope: { private: 'Invalid detail' } }
              : customerRequest(),
          history,
          adjustments: [],
          refunds: [],
        },
      });
    });
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
      reviewWrites++;
      expect(status).toBe('submitted');
      status = 'under_review';
      history.push({ status, actor_type: 'staff', reason: null, created_at: submittedAt });
      return route.fulfill({
        json: { requestId: locale === 'fa' ? productId : requestId, status },
      });
    });
    await page.route(`**/api/admin/consultations/requests/${requestId}/assign`, (route) => {
      expect(route.request().postDataJSON()).toEqual({ assignTo: 'self' });
      staffOwnerId = 'buyer';
      history.push({
        status,
        actor_type: 'staff',
        reason: 'Assigned to staff',
        created_at: submittedAt,
      });
      return route.fulfill({ json: { requestId, status, staffOwnerId, staffTeam: null } });
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
        scope: scope.value,
        deliverables: deliverables.value,
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
      const body: unknown = route.request().postDataJSON();
      expect(body).toEqual({ expectedReviewHash: 'b'.repeat(64) });
      acceptWrites.push(body);
      if (acceptWrites.length === 1) {
        heldAccept = route;
        return;
      }
      acceptedAt = submittedAt;
      return route.fulfill({ json: acceptReceipt() });
    });
    await page.route(`**/api/consultations/requests/${requestId}/offer-review`, (route) => {
      const { decision } = route.request().postDataJSON() as { decision: 'accept' | 'decline' };
      expect(['accept', 'decline']).toContain(decision);
      expect(offer).not.toBeNull();
      offerDecisions.push(decision);
      if (offerDecisions.length === 1) {
        heldPreview = route;
        return;
      }
      return route.fulfill({ json: offerReview(decision) });
    });
    await page.route(`**/api/invoices/${invoiceId}`, (route) => {
      if (!offer || !acceptedAt) return route.fulfill({ status: 404, json: {} });
      const paid = invoiceState === 'Paid';
      const invoice = {
        invoiceId,
        role: 'original',
        state: invoiceState,
        totalAmount: offer.fee,
        paidAmount: paid ? offer.fee : '0',
        refundedAmount: '0',
        accountingAmount: offer.fee,
        adjustmentKind: null,
        issuedAt: submittedAt,
        payableFrom: submittedAt,
        dueAt: offer.validUntil,
        cancelledAt: null,
        createdAt: submittedAt,
        replacesInvoiceId: null,
        adjustmentForInvoiceId: null,
        explanation: null,
        lines: [],
      };
      return route.fulfill({
        json: {
          viewedInvoiceId: invoiceId,
          originalInvoiceId: invoiceId,
          consultationId: requestId,
          invoice,
          chain: [invoice],
          payments: paid
            ? [
                {
                  id: transactionId,
                  source: 'wallet',
                  amount: offer.fee,
                  state: 'Confirmed',
                  createdAt: submittedAt,
                },
              ]
            : [],
          bankReceipts: [],
          refunds: [],
        },
      });
    });
    const walletReview = () => {
      const paid = invoiceState === 'Paid';
      const availableBalance = paid ? '400000' : '900000';
      const data: WalletPaymentReviewData = {
        currency: 'IRR',
        profile: { id: profileId, title: 'Buyer Example', type: 'INDIVIDUAL' },
        invoice: {
          id: invoiceId,
          state: invoiceState,
          orderId: null,
          serviceType: 'consultation',
          issuedAt: submittedAt,
          payableFrom: submittedAt,
          dueAt: offer!.validUntil,
          totalAmount: offer!.fee,
          paidAmount: paid ? offer!.fee : '0',
          remainingAmount: paid ? '0' : offer!.fee,
        },
        lines: [],
        totals: null,
        payment: {
          source: 'wallet',
          availableBefore: availableBalance,
          availableAfter: '400000',
        },
        contracts: [],
        cancellation: 'separate_review_required',
      };
      return {
        schemaVersion: 1,
        scope: { action: 'invoice.wallet-payment', profileId, resourceId: invoiceId },
        data,
        hash: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
      };
    };
    await page.route(`**/api/invoices/${invoiceId}/wallet-payment`, (route) => {
      if (!offer || !acceptedAt) return route.fulfill({ status: 404, json: {} });
      const review = walletReview();
      if (route.request().method() === 'GET')
        return route.fulfill({
          json: {
            invoiceId,
            profileId,
            remainingAmount: review.data.invoice.remainingAmount,
            availableBalance: review.data.payment.availableBefore,
            canPay: invoiceState === 'Unpaid',
            review,
          },
        });
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers()['x-csrf-token']).toBe('consultation-wallet-csrf');
      expect(invoiceState).toBe('Unpaid');
      expect(status).toBe('offer_pending');
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body).toEqual({
        idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/),
        expectedRemainingAmount: '500000',
        expectedReviewHash: review.hash,
      });
      walletPayments.push(body);
      invoiceState = 'Paid';
      status = 'offer_accepted';
      history.push({ status, actor_type: 'customer', reason: null, created_at: submittedAt });
      return route.fulfill({
        json: {
          invoiceId,
          profileId,
          idempotencyKey: body.idempotencyKey,
          state: invoiceState,
          amount: offer.fee,
          walletTransactionId: transactionId,
          reviewHash: review.hash,
        },
      });
    });
    await page.route(`**/api/admin/consultations/requests/${requestId}/complete`, (route) => {
      expect(status).toBe('offer_accepted');
      expect(invoiceState).toBe('Paid');
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
    await expect(
      page.getByRole('heading', { name: consultationCopy('details', locale), exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(consultationCopy('detailLoadError', locale), { exact: true })
    ).toBeVisible();
    await expect(page.getByText(consultationCopy('noFee', locale))).toHaveCount(0);
    await page.getByRole('button', { name: consultationCopy('informationReload', locale) }).click();
    await expect.poll(() => offerReads).toBe(2);
    await expect(page.getByText(consultationCopy('noFee', locale))).toBeVisible();

    operatingContext = 'staff';
    await page.goto('/admin/consultations');
    await expect(
      page.getByRole('heading', { name: consultationCopy('staffTitle', locale) })
    ).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`${title[locale]}.*Buyer Example`) }).click();
    await page.getByRole('button', { name: consultationCopy('startReview', locale) }).click();
    const reviewDialog = page.getByRole('dialog', {
      name: consultationCopy('startReview', locale),
    });
    const reviewConfirm = reviewDialog.getByRole('button', {
      name: appCopy('team.confirm', locale),
    });
    await reviewConfirm.click();
    const recorded = page
      .locator('[data-sonner-toast][data-type="success"]')
      .filter({ hasText: confirmationText('recorded', locale) });
    if (locale === 'fa') {
      const unresolved = page.locator('[role="alert"]').filter({
        hasText: consultationCopy('actionUnconfirmed', locale),
      });
      await expect(unresolved).toBeVisible();
      await expect(reviewConfirm).toBeDisabled();
      await expect(recorded).toHaveCount(0);
      await reviewDialog.getByRole('button', { name: appCopy('team.cancel', locale) }).click();
      await unresolved.getByRole('button', { name: consultationCopy('retry', locale) }).click();
      await expect(unresolved).toHaveCount(0);
    }
    await expect(recorded).toBeVisible();
    await expect(reviewDialog).toHaveCount(0);
    expect(reviewWrites).toBe(1);
    const assignSelf = consultationCopy('assignSelf', locale);
    await page.getByRole('button', { name: assignSelf, exact: true }).click();
    const assignDialog = page.getByRole('dialog', { name: assignSelf, exact: true });
    await assignDialog.getByRole('button', { name: appCopy('team.confirm', locale) }).click();
    await expect(assignDialog).toHaveCount(0);
    await expect(
      page
        .getByRole('region', { name: consultationCopy('details', locale), exact: true })
        .locator('[data-slot=consultation-assignment]')
    ).toContainText(consultationCopy('assignedStaff', locale));
    await expect(
      page.getByRole('button', { name: consultationCopy('issueFee', locale) })
    ).toBeVisible();
    await page.getByLabel(consultationCopy('feeIrr', locale)).fill('500000');
    await page.getByLabel(consultationCopy('offerValidUntil', locale)).fill('2030-01-01T12:30');
    await page.getByLabel(consultationCopy('scope', locale)).fill(scope.value);
    await page.getByLabel(consultationCopy('deliverables', locale)).fill(deliverables.value);
    await page.getByRole('button', { name: consultationCopy('issueFee', locale) }).click();
    const feeReview = page.getByRole('dialog', { name: consultationCopy('issueFee', locale) });
    await expect(feeReview).toContainText(consultationCopy('feeReviewTitle', locale));
    await expect(feeReview).toContainText(scope.value);
    await expect(feeReview).toContainText(deliverables.value);
    await expect(feeReview).toContainText(`${new Intl.NumberFormat(locale).format(500000)} IRR`);
    await expectOfferTextFits(page, feeReview, fields);
    const confirmFee = feeReview.getByRole('button', { name: appCopy('team.confirm', locale) });
    await expect(confirmFee).toBeDisabled();
    await approveRiskConfirmation(page, locale, 'financial');
    await confirmFee.click();
    await expect.poll(() => status).toBe('offer_pending');
    const savedOffer = page.getByRole('region', { name: consultationCopy('savedOffer', locale) });
    await expect(savedOffer).toContainText(`${new Intl.NumberFormat(locale).format(500000)} IRR`);
    await expect(savedOffer).toContainText(scope.value);
    await expect(savedOffer).toContainText(deliverables.value);
    await expectOfferTextFits(page, savedOffer, fields);
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
    await expect(page.locator('main[data-area=dashboard]')).not.toContainText('private-owner-id');
    expect(
      (
        await new AxeBuilder({ page })
          .include('main[data-area=dashboard]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations
    ).toEqual([]);
    await expect(page.getByText(scope.value)).toBeVisible();
    await expect(page.getByText(deliverables.value)).toBeVisible();
    await expectOfferTextFits(page, page.locator('main[data-area=dashboard]'), fields);
    const alternate = locale === 'en' ? 'fa' : 'en';
    await switchLanguage(page, locale);
    await page.clock.install();
    const decline = page.getByRole('button', { name: consultationCopy('declineOffer', alternate) });
    await decline.click();
    await expect.poll(() => !!heldPreview).toBe(true);
    await expect(decline).toBeDisabled();
    await page.clock.fastForward(15_001);
    await expect(
      page.getByText(consultationCopy('actionError', alternate), { exact: true })
    ).toBeVisible();
    await expect(decline).toBeEnabled();
    expect(offerDecisions).toEqual(['decline']);
    await heldPreview!.fulfill({ json: offerReview('decline') }).catch(() => undefined);
    await expect(
      page.getByRole('dialog', { name: consultationCopy('decisionReviewTitle', alternate) })
    ).toHaveCount(0);
    await decline.click();
    const declineReview = page.getByRole('dialog', {
      name: consultationCopy('decisionReviewTitle', alternate),
    });
    await expect(declineReview).toContainText(scope.value);
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
    await expect(review).toContainText(scope.value);
    await expect(review).toContainText(deliverables.value);
    await expectOfferTextFits(page, review, fields);
    const accept = review.getByRole('button', { name: consultationCopy('acceptOffer', locale) });
    await expect(accept).toBeDisabled();
    await approveRiskConfirmation(page, locale, 'financial');
    await accept.click();
    await expect.poll(() => !!heldAccept).toBe(true);
    await expect(accept).toBeDisabled();
    const readsBeforeRecovery = offerReads;
    await page.clock.fastForward(15_001);
    await expect(review).toHaveCount(0);
    await expect(
      page.getByText(consultationCopy('decisionUnconfirmed', locale), { exact: true })
    ).toBeVisible();
    await expect.poll(() => offerReads).toBeGreaterThan(readsBeforeRecovery);
    await expect(page).toHaveURL(new RegExp(`/consultations/${requestId}$`));
    await expect(
      page.getByRole('button', { name: consultationCopy('declineOffer', locale) })
    ).toBeDisabled();
    expect(acceptWrites).toHaveLength(1);
    await heldAccept!.fulfill({ json: acceptReceipt() }).catch(() => undefined);
    await page.getByRole('button', { name: consultationCopy('acceptOffer', locale) }).click();
    await expect(accept).toBeDisabled();
    await approveRiskConfirmation(page, locale, 'financial');
    await accept.click();
    await expect(page).toHaveURL(new RegExp(`/invoices/${invoiceId}$`));
    expect(acceptWrites).toEqual([
      { expectedReviewHash: 'b'.repeat(64) },
      { expectedReviewHash: 'b'.repeat(64) },
    ]);
    expect(offerDecisions).toEqual(['decline', 'decline', 'accept', 'accept']);
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
    const viewInvoice = page.getByRole('link', { name: consultationCopy('viewInvoice', locale) });
    await expect(viewInvoice).toHaveAttribute('href', `/invoices/${invoiceId}`);
    const paymentHash = walletReview().hash;
    await page.context().addCookies([
      {
        name: 'barghsa_csrf',
        value: 'consultation-wallet-csrf',
        url: new URL(page.url()).origin,
      },
    ]);
    await viewInvoice.click();
    const wallet = page.locator('#wallet-invoice-payment');
    await wallet.getByRole('button', { name: walletCopy('pay', locale), exact: true }).click();
    const confirmWallet = page.getByRole('dialog').getByRole('button', {
      name: appCopy('team.confirm', locale),
      exact: true,
    });
    await expect(confirmWallet).toBeDisabled();
    expect(walletPayments).toHaveLength(0);
    await approveRiskConfirmation(page, locale, 'financial');
    await confirmWallet.click();
    await expect(wallet.getByRole('status')).toContainText(transactionId);
    expect(walletPayments).toEqual([
      {
        idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/),
        expectedRemainingAmount: '500000',
        expectedReviewHash: paymentHash,
      },
    ]);
    await expect(
      page.getByRole('progressbar', { name: appCopy('invoices.payment.progress', locale) })
    ).toHaveAttribute('aria-valuenow', '100');
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
