import { tSaving as savingCopy } from '@barghsa/i18n/saving';
import { contractText as contractCopy } from '@barghsa/i18n/contracts';
import { tSavingStaffReview as savingReviewCopy } from '@barghsa/i18n/saving-staff-review';
import { t as appCopy } from '@barghsa/i18n/app';
import { test, expect, type Page } from './coverage-fixture';
import { approveRiskConfirmation } from './confirmation-fixture';
import { checkRoutePresentation } from './route-presentation';

const profileId = '11111111-1111-4111-8111-111111111111';
const planId = '22222222-2222-4222-8222-222222222222';
const hardwareId = '33333333-3333-4333-8333-333333333333';
const addressId = '44444444-4444-4444-8444-444444444444';
const agreementVersionId = '55555555-5555-4555-8555-555555555555';
const savingOrderId = '66666666-6666-4666-8666-666666666666';
const olderOrderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const parentOrderId = '77777777-7777-4777-8777-777777777777';
const invoiceId = '88888888-8888-4888-8888-888888888888';
const contractId = '99999999-9999-4999-8999-999999999999';
const submittedAt = '2026-09-23T10:00:00.000Z';
const stageNames = [
  'request_confirmation',
  'product_delivery',
  'installation_and_document_upload',
  'equipment_handover',
  'process_completion',
];

async function checkAgreementPresentation(page: Page, text: string, direction: 'rtl' | 'ltr') {
  const original = page.viewportSize()!;
  try {
    await page.setViewportSize({ width: 320, height: original.height });
    const agreement = page.getByText(text, { exact: true });
    await expect(agreement).toBeVisible();
    expect(await agreement.textContent()).toBe(text);
    await expect(agreement).toHaveCSS('direction', direction);
    expect(
      await agreement.evaluate((node) => ({
        agreementFits: node.scrollWidth <= node.clientWidth,
        pageFits: document.documentElement.scrollWidth <= innerWidth,
      }))
    ).toEqual({ agreementFits: true, pageFits: true });
  } finally {
    await page.setViewportSize(original);
  }
}

for (const locale of ['en', 'fa'] as const)
  test(`customer saves a saving order, submits the reviewed quote, and tracks fulfillment (${locale})`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    const drafts: Array<Record<string, unknown>> = [];
    const submissions: Array<Record<string, unknown>> = [];
    const staffActions: Array<{ path: string; body: Record<string, unknown> }> = [];
    const staffReviewHash = 'b'.repeat(64);
    let approved = false;
    let stageIndex = -1;
    let invoiceState = 'Unpaid';
    let contractState = 'AwaitingCustomerAcceptance';
    let operatingContext: 'customer' | 'staff' = 'customer';
    let detailReads = 0;
    let releaseFirstDetail!: () => void;
    const firstDetail = new Promise<void>((resolve) => {
      releaseFirstDetail = resolve;
    });
    const termsDirection = locale === 'fa' ? 'ltr' : 'rtl';
    const termsTitle = locale === 'fa' ? 'Accepted terms' : 'شرایط پذیرفته‌شده';
    const termsReference = 'SAVING-REFERENCE-'.repeat(12);
    const termsBody =
      locale === 'fa'
        ? `The customer accepts this plan.\n${termsReference}`
        : `لورم ایپسوم، شرایط صرفه‌جویی انرژی\n${termsReference}`;
    const quotedTermsBody =
      locale === 'fa'
        ? `The quoted agreement body.\n${termsReference}`
        : `لورم ایپسوم، شرایط استعلام‌شده\nThe quoted agreement body.\n${termsReference}`;
    const acceptedTerms = `${termsTitle}\n${termsBody}`;

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
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [{ id: profileId, profileType: 'INDIVIDUAL', title: 'Buyer' }],
          activeProfileId: profileId,
          hasDefault: true,
        },
      })
    );
    await page.route('**/api/profiles/verification-status', (route) =>
      route.fulfill({
        json: {
          activeProfileId: profileId,
          profileStatus: 'ACTIVE',
          verificationRequired: true,
          isVerified: true,
        },
      })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Pacific/Kiritimati' } })
    );
    await page.route('**/api/saving/plans', (route) =>
      route.fulfill({
        json: {
          plans: [
            {
              id: planId,
              title: { en: 'Home saving plan', fa: 'طرح صرفه‌جویی خانه' },
              description: null,
              price: '100000',
              status: 'active',
              available: true,
              hardware: [
                {
                  id: hardwareId,
                  title: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
                  description: null,
                  price: '200000',
                  status: 'active',
                },
              ],
              agreement: {
                versionId: agreementVersionId,
                title: termsTitle,
                body: termsBody,
              },
            },
          ],
        },
      })
    );
    const provinceId = '55555555-5555-4555-8555-555555555555';
    const cityId = '66666666-6666-4666-8666-666666666666';
    const addressWrites: Array<Record<string, unknown>> = [];
    const savedAddress = {
      id: addressId,
      profileId,
      provinceId,
      cityId,
      fullAddress: 'Saving Street',
      postalCode: '1234567890',
      mainAddress: true,
      createdAt: submittedAt,
      updatedAt: submittedAt,
    };
    await page.route(`**/api/profiles/${profileId}/addresses`, (route) => {
      if (route.request().method() === 'POST') {
        addressWrites.push(route.request().postDataJSON() as Record<string, unknown>);
        if (addressWrites.length === 1)
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION:INPUT:INVALID',
                fields: ['postalCode'],
                message: 'private-saving-address-diagnostic',
              },
            },
          });
        return route.fulfill({ status: 201, json: addressWrites.length === 2 ? {} : savedAddress });
      }
      return route.fulfill({
        json: { addresses: addressWrites.length === 3 ? [savedAddress] : [] },
      });
    });
    await page.route('**/api/geography/provinces', (route) =>
      route.fulfill({ json: [{ id: provinceId, nameFa: 'استان', nameEn: 'Province' }] })
    );
    await page.route(`**/api/geography/provinces/${provinceId}/cities`, (route) =>
      route.fulfill({ json: [{ id: cityId, provinceId, nameFa: 'شهر', nameEn: 'City' }] })
    );
    await page.route('**/api/saving/orders/draft?*', (route) => {
      if (route.request().method() === 'PUT') {
        drafts.push(route.request().postDataJSON() as Record<string, unknown>);
        return route.fulfill({ json: { ...drafts.at(-1), updatedAt: submittedAt } });
      }
      return route.fulfill({ json: { currentStep: 1, data: null, updatedAt: null } });
    });
    await page.route('**/api/saving/orders/duplicate', (route) =>
      route.fulfill({ json: { duplicate: false, existingOrderId: null } })
    );
    await page.route('**/api/saving/orders/verify-bill', (route) =>
      route.fulfill({ json: { status: 'verified' } })
    );
    await page.route('**/api/saving/orders/quote', (route) =>
      route.fulfill({
        json: {
          reviewDigest: 'a'.repeat(64),
          plan: {
            id: planId,
            title: { en: 'Quoted home saving plan', fa: 'طرح استعلام‌شده خانه' },
          },
          hardware: {
            id: hardwareId,
            title: { en: 'Quoted efficient device', fa: 'دستگاه استعلام‌شده' },
          },
          billIdentifier: '1234567890123',
          address: {
            id: addressId,
            province_id: provinceId,
            city_id: cityId,
            full_address: 'Updated quoted Saving Street',
            postal_code: '9876543210',
          },
          agreement: {
            versionId: agreementVersionId,
            title: 'Quoted terms',
            body: quotedTermsBody,
          },
          subtotalIrR: '300000',
          discountIrR: '0',
          vatIrR: '0',
          totalIrR: '300000',
          lines: [
            {
              type: 'plan',
              title: { en: 'Home saving plan', fa: 'طرح صرفه‌جویی خانه' },
              amountIrR: '100000',
              discountIrR: '0',
              vatIrR: '0',
            },
            {
              type: 'hardware',
              title: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
              amountIrR: '200000',
              discountIrR: '0',
              vatIrR: '0',
            },
          ],
        },
      })
    );
    await page.route(`**/api/wallet/${profileId}`, (route) =>
      route.fulfill({ json: { availableBalance: '500000' } })
    );
    await page.route('**/api/saving/orders', (route) => {
      submissions.push(route.request().postDataJSON() as Record<string, unknown>);
      if (submissions.length === 1) {
        return route.fulfill({ status: 503, json: { message: 'private-saving-order-diagnostic' } });
      }
      return route.fulfill({ status: 201, json: { savingOrderId } });
    });
    await page.route('**/api/saving/orders?*', (route) => {
      const before = new URL(route.request().url()).searchParams.get('before');
      return route.fulfill({
        json: before
          ? {
              orders: [
                {
                  id: olderOrderId,
                  status: 'awaiting_staff_review',
                  financial_status: 'unpaid',
                  invoice_id: null,
                  invoice_state: 'Unpaid',
                  contract_id: null,
                  contract_state: 'AwaitingStaffReview',
                  cancellation_pending: false,
                  bill_identifier: '9876543210123',
                  submitted_at: '2026-09-22T10:00:00.000Z',
                  plan_title: { en: 'Older saving plan', fa: 'طرح قدیمی' },
                  hardware_title: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
                  total_amount: '200000',
                },
              ],
              nextBefore: null,
            }
          : {
              orders: [
                {
                  id: savingOrderId,
                  status: approved ? 'approved' : 'awaiting_staff_review',
                  financial_status: 'unpaid',
                  invoice_id: invoiceId,
                  invoice_state: invoiceState,
                  contract_id: approved ? contractId : null,
                  contract_state: approved ? contractState : 'AwaitingStaffReview',
                  cancellation_pending: false,
                  bill_identifier: '1234567890123',
                  submitted_at: submittedAt,
                  plan_title: { en: 'Home saving plan', fa: 'طرح صرفه‌جویی خانه' },
                  hardware_title: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
                  total_amount: '300000',
                },
              ],
              nextBefore: savingOrderId,
            },
      });
    });
    await page.route(`**/api/saving/orders/${savingOrderId}`, async (route) => {
      const wrongOrder = ++detailReads === 1;
      if (wrongOrder) await firstDetail;
      return route.fulfill({
        json: {
          id: wrongOrder ? olderOrderId : savingOrderId,
          order_id: parentOrderId,
          profile_id: profileId,
          saving_plan_id: planId,
          hardware_product_id: hardwareId,
          current_hardware_title: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
          installation_address_id: addressId,
          can_edit: false,
          status: approved ? 'approved' : 'awaiting_staff_review',
          financial_status: 'unpaid',
          bill_identifier: '1234567890123',
          submitted_at: submittedAt,
          address_snapshot: { full_address: 'Saving Street', postal_code: '1234567890' },
          pricing_snapshot: {
            plan: {
              title: wrongOrder
                ? { en: 'PRIVATE_OTHER_SAVING_ORDER', fa: 'PRIVATE_OTHER_SAVING_ORDER' }
                : { en: 'Home saving plan', fa: 'طرح صرفه‌جویی خانه' },
            },
            hardware: { title: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' } },
            subtotalIrR: '300000',
            discountIrR: '0',
            vatIrR: '0',
            totalIrR: '300000',
          },
          verification_result: { status: 'verified' },
          agreement_snapshot: acceptedTerms,
          agreement_updated: false,
          contract_version_id: null,
          contract_id: approved ? contractId : null,
          contract_state: approved ? contractState : 'AwaitingStaffReview',
          invoice_id: invoiceId,
          invoice_state: invoiceState,
          cancellation_pending: false,
          stages: stageNames.map((stage, index) => ({
            stage,
            status: approved
              ? index < stageIndex
                ? 'completed'
                : index === stageIndex
                  ? 'in_progress'
                  : 'pending'
              : 'pending',
            completed_at: approved && index < stageIndex ? submittedAt : null,
            explanation: null,
            handover_description: null,
          })),
          revisions: [],
          addressAmendments: [],
          hardwareAmendments: [],
          hardwareUpgrades: [],
        },
      });
    });
    const staffPricingSnapshot = {
      plan: { title: { en: 'Home saving plan', fa: 'طرح صرفه‌جویی خانه' } },
      lines: [
        {
          title: { en: 'Home saving plan', fa: 'طرح صرفه‌جویی خانه' },
          amountIrR: '100000',
          discountIrR: '0',
          netIrR: '100000',
          vatIrR: '0',
        },
        {
          title: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
          amountIrR: '200000',
          discountIrR: '0',
          netIrR: '200000',
          vatIrR: '0',
        },
      ],
    };
    const staffOrder = () => ({
      id: savingOrderId,
      orderId: parentOrderId,
      profileId,
      customerName: 'Buyer',
      status: approved ? 'approved' : 'awaiting_staff_review',
      financialStatus: 'unpaid',
      submittedAt,
      billIdentifier: '1234567890123',
      addressSnapshot: { full_address: 'Saving Street' },
      installationAddressId: addressId,
      hardwareProductId: hardwareId,
      hardwareTitle: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
      pricingSnapshot: staffPricingSnapshot,
      agreementSnapshot: 'The customer accepts this plan.',
      contractId,
      invoiceId,
      versionId: agreementVersionId,
      invoiceState,
      contractState: approved ? contractState : 'AwaitingStaffReview',
      totalIrR: '300000',
      paidIrR: '0',
      refundedIrR: '0',
      pendingRefundIrR: '0',
    });
    await page.route('**/api/staff/saving/orders?*', (route) => {
      const lane = new URL(route.request().url()).searchParams.get('lane');
      return route.fulfill({
        json: {
          orders: lane === (approved ? 'fulfillment' : 'review') ? [staffOrder()] : [],
          nextAfter: null,
        },
      });
    });
    await page.route(`**/api/staff/saving/orders/${savingOrderId}`, (route) =>
      route.fulfill({
        json: {
          ...staffOrder(),
          stages: stageNames.map((stage, index) => ({
            stage,
            status: approved
              ? index < stageIndex
                ? 'completed'
                : index === stageIndex
                  ? 'in_progress'
                  : 'pending'
              : 'pending',
            completed_at: index < stageIndex ? submittedAt : null,
            explanation: null,
            handover_description: null,
          })),
          events: [],
          revisions: [],
          addressAmendments: [],
          hardwareAmendments: [],
          hardwareUpgrades: [],
          addressOptions: [],
          hardwareOptions: [],
          canAmendAddress: false,
          canAmendHardware: false,
        },
      })
    );
    await page.route(`**/api/staff/saving/orders/${savingOrderId}/financial-review`, (route) =>
      route.fulfill({
        json: {
          schemaVersion: 1,
          scope: { action: 'saving.staff-review.approve', profileId, resourceId: savingOrderId },
          data: {
            action: 'approve',
            reason: '',
            customerName: 'Buyer',
            profileName: 'Buyer',
            billIdentifier: '1234567890123',
            hardwareTitle: { en: 'Efficient device', fa: 'دستگاه کم‌مصرف' },
            addressSnapshot: { full_address: 'Saving Street' },
            pricingSnapshot: staffPricingSnapshot,
            agreementSnapshot: 'The customer accepts this plan.',
            contractId,
            contractState: 'AwaitingStaffReview',
            versionId: agreementVersionId,
            versionNumber: 1,
            contractSnapshot: {},
            invoiceId,
            invoiceState: 'Unpaid',
            invoiceTotal: '300000',
            paidAmount: '0',
            refundedAmount: '0',
            pendingRefundAmount: '0',
            outcome: 'publish_contract',
            refundAmount: '0',
            releasesGiftCode: false,
          },
          hash: staffReviewHash,
        },
      })
    );
    await page.route(`**/api/staff/saving/orders/${savingOrderId}/approve`, (route) => {
      staffActions.push({
        path: 'approve',
        body: route.request().postDataJSON() as Record<string, unknown>,
      });
      approved = true;
      stageIndex = 1;
      return route.fulfill({ json: { savingOrderId, status: 'approved', refundId: null } });
    });
    const invoice = {
      invoiceId,
      role: 'original',
      state: 'Unpaid',
      totalAmount: '300000',
      paidAmount: '0',
      refundedAmount: '0',
      accountingAmount: '300000',
      adjustmentKind: null,
      issuedAt: submittedAt,
      payableFrom: submittedAt,
      dueAt: '2026-09-30T10:00:00.000Z',
      dueAtOverrideReason: null,
      cancelledAt: null,
      createdAt: submittedAt,
      replacesInvoiceId: null,
      adjustmentForInvoiceId: null,
      explanation: null,
      lines: [],
    };
    await page.route(`**/api/invoices/${invoiceId}`, (route) =>
      route.fulfill({
        json: {
          viewedInvoiceId: invoiceId,
          originalInvoiceId: invoiceId,
          savingOrderId,
          invoice,
          chain: [invoice],
          payments: [],
          bankReceipts: [],
          refunds: [],
        },
      })
    );

    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page.goto('/savings');
    await expect(
      page.getByRole('heading', {
        name: locale === 'fa' ? 'طرح صرفه‌جویی خانه' : 'Home saving plan',
      })
    ).toBeVisible();
    await checkRoutePresentation(page, info, locale);
    const catalogueAgreement = page.locator('summary').filter({ hasText: termsTitle });
    await catalogueAgreement.click();
    await checkAgreementPresentation(page, termsBody, termsDirection);
    await catalogueAgreement.click();
    await page.getByRole('link', { name: savingCopy('startOrder', locale) }).click();
    const next = page.getByRole('button', { name: savingCopy('next', locale), exact: true });
    const choice = (key: string) =>
      page.getByRole('radiogroup', { name: savingCopy(key, locale), exact: true });
    const checkbox = (key: string) =>
      page.getByRole('checkbox', { name: savingCopy(key, locale), exact: true });
    await expect(choice('choosePlan')).toHaveAttribute('aria-required', 'true');
    await page
      .getByRole('radio', {
        name: new RegExp(locale === 'fa' ? 'طرح صرفه‌جویی خانه' : 'Home saving plan'),
      })
      .check();
    await next.click();
    await expect(choice('chooseHardware')).toHaveAttribute('aria-required', 'true');
    await page
      .getByRole('radio', {
        name: new RegExp(locale === 'fa' ? 'دستگاه کم‌مصرف' : 'Efficient device'),
      })
      .check();
    await expect(checkbox('confirmHardware')).toHaveAttribute('aria-required', 'true');
    await checkbox('confirmHardware').check();
    await next.click();
    const bill = page.getByRole('textbox', { name: savingCopy('billIdentifier', locale) });
    await expect(bill).toHaveAttribute('aria-required', 'true');
    await bill.fill('1');
    await expect(bill).toHaveAttribute('aria-invalid', 'true');
    await expect(bill).toHaveAccessibleDescription(savingCopy('invalidBill', locale));
    await expect(
      page.getByRole('button', { name: savingCopy('verifyBill', locale) })
    ).toBeDisabled();
    await bill.fill('1234567890123');
    await expect(bill).not.toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: savingCopy('verifyBill', locale) }).click();
    await expect(next).toBeEnabled();
    await next.click();
    await page.getByRole('button', { name: savingCopy('newAddress', locale), exact: true }).click();
    const province = page.locator('#saving-address-province');
    await province.selectOption(provinceId);
    const city = page.locator('#saving-address-city');
    await city.selectOption(cityId);
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      const { width, height } = (await city.boundingBox())!;
      expect(width).toBeGreaterThanOrEqual(44);
      expect(height).toBeGreaterThanOrEqual(44);
    }
    await page
      .getByRole('textbox', { name: savingCopy('fullAddress', locale), exact: true })
      .fill(savedAddress.fullAddress);
    await page
      .getByRole('textbox', { name: savingCopy('postalCode', locale), exact: true })
      .fill(savedAddress.postalCode);
    const saveAddress = page.getByRole('button', {
      name: savingCopy('saveAddress', locale),
      exact: true,
    });
    const fullAddress = page.getByRole('textbox', {
      name: savingCopy('fullAddress', locale),
      exact: true,
    });
    const postalCode = page.getByRole('textbox', {
      name: savingCopy('postalCode', locale),
      exact: true,
    });
    for (const field of [province, city, fullAddress, postalCode])
      await expect(field).toHaveAttribute('aria-required', 'true');
    const addressError = appCopy('settings.addresses.error.create', locale);
    const addressUnconfirmed = savingCopy('addressUnconfirmed', locale);
    const addressSaved = page.locator('[data-sonner-toast][data-type="success"]').filter({
      hasText: appCopy('settings.addresses.success.create', locale),
    });
    const errorToasts = page.locator('[data-sonner-toast][data-type="error"]');
    await saveAddress.click();
    await expect(page.getByRole('alert').filter({ hasText: addressError })).toHaveText(
      addressError
    );
    await expect(errorToasts.filter({ hasText: addressError })).toHaveText(addressError);
    await expect(page.getByText('private-saving-address-diagnostic')).toHaveCount(0);
    await expect(postalCode).toHaveAttribute('aria-invalid', 'true');
    await expect(postalCode).toHaveAccessibleDescription(
      appCopy('formWizard.invalidField', locale)
    );
    await expect(fullAddress).not.toHaveAttribute('aria-invalid', 'true');
    await expect(fullAddress).toBeEditable();
    await expect(fullAddress).toHaveValue(savedAddress.fullAddress);
    await expect(addressSaved).toHaveCount(0);
    expect(addressWrites).toHaveLength(1);

    await saveAddress.click();
    await expect(page.getByRole('alert').filter({ hasText: addressUnconfirmed })).toBeVisible();
    await expect(postalCode).not.toHaveAttribute('aria-invalid', 'true');
    await expect(errorToasts.filter({ hasText: addressUnconfirmed })).toHaveText(
      addressUnconfirmed
    );
    await expect(fullAddress).toBeDisabled();
    await expect(fullAddress).toHaveValue(savedAddress.fullAddress);
    await expect(next).toBeDisabled();
    await expect(addressSaved).toHaveCount(0);
    expect(addressWrites).toHaveLength(2);
    expect(addressWrites[1]!.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
    expect(addressWrites[1]!.idempotencyKey).not.toBe(addressWrites[0]!.idempotencyKey);
    await page
      .getByRole('button', { name: savingCopy('retryAddress', locale), exact: true })
      .click();
    await expect(page.getByText('Saving Street')).toBeVisible();
    await expect(addressSaved).toHaveCount(1);
    expect(addressWrites).toHaveLength(3);
    expect(addressWrites[2]).toEqual(addressWrites[1]);
    await expect(choice('chooseAddress')).toHaveAttribute('aria-required', 'true');
    await expect(page.locator(`input[name=addressId][value="${addressId}"]`)).toBeChecked();
    await next.click();
    await checkAgreementPresentation(page, termsBody, termsDirection);
    await expect(checkbox('acceptAgreement')).toHaveAttribute('aria-required', 'true');
    await checkbox('acceptAgreement').check();
    await next.click();
    await expect(page.getByText(`${savingCopy('walletBalance', locale)}:`)).toContainText(
      new Intl.NumberFormat(locale).format(500000)
    );
    const financialReview = page.getByRole('region', {
      name: savingCopy('stepReview', locale),
      exact: true,
    });
    await expect(financialReview).toContainText(savingCopy('subtotal', locale));
    await expect(financialReview).toContainText(new Intl.NumberFormat(locale).format(300000));
    await expect(financialReview).toContainText('Updated quoted Saving Street');
    await expect(financialReview).toContainText('9876543210');
    await expect(financialReview).toContainText(
      locale === 'fa' ? 'طرح استعلام‌شده خانه' : 'Quoted home saving plan'
    );
    await expect(financialReview).toContainText(
      locale === 'fa' ? 'دستگاه استعلام‌شده' : 'Quoted efficient device'
    );
    await expect(financialReview).toContainText('The quoted agreement body.');
    await checkAgreementPresentation(page, quotedTermsBody, termsDirection);
    await checkRoutePresentation(page, info, locale);
    await expect(checkbox('submitForReview')).toHaveAttribute('aria-required', 'true');
    await checkbox('submitForReview').check();
    const submit = page.getByRole('button', { name: savingCopy('submit', locale), exact: true });
    await expect(submit).toBeDisabled();
    await approveRiskConfirmation(page, locale, 'financial');
    await submit.click();
    const error = savingCopy('orderError', locale);
    await expect(page.getByRole('main').getByRole('alert').filter({ hasText: error })).toHaveText(
      error
    );
    await expect(errorToasts.filter({ hasText: error })).toHaveText(error);
    await expect(page.getByText('private-saving-order-diagnostic')).toHaveCount(0);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page).toHaveURL(new RegExp(`/savings/orders/${savingOrderId}$`));
    const detail = page.getByRole('main');
    try {
      await expect(detail.getByRole('heading', { level: 1 })).toHaveText(
        savingCopy('orderDetail', locale)
      );
      await expect(detail.getByText(savingCopy('loading', locale), { exact: true })).toBeVisible();
    } finally {
      releaseFirstDetail();
    }
    await expect(
      detail.getByRole('alert').filter({ hasText: savingCopy('error', locale) })
    ).toBeVisible();
    await expect(detail.getByText('PRIVATE_OTHER_SAVING_ORDER')).toHaveCount(0);
    expect(detailReads).toBe(1);
    await detail.getByRole('button', { name: savingCopy('retry', locale), exact: true }).click();
    await expect.poll(() => detailReads).toBe(2);
    await expect(page.locator(`time[datetime="${submittedAt}"]`).first()).toHaveText(
      new Intl.DateTimeFormat(locale, {
        timeZone: 'Pacific/Kiritimati',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(submittedAt))
    );
    await expect(
      page.getByRole('heading', { name: savingCopy('fulfillment', locale) })
    ).toBeVisible();
    await expect(page.getByRole('list', { name: savingCopy('fulfillment', locale) })).toContainText(
      savingCopy('request_confirmation', locale)
    );
    const savedAgreement = detail
      .locator('summary')
      .filter({ hasText: savingCopy('acceptedAgreement', locale) });
    await savedAgreement.click();
    await checkAgreementPresentation(page, acceptedTerms, termsDirection);
    await savedAgreement.click();
    expect(drafts).toHaveLength(5);
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(submissions[0]).toMatchObject({
      idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/),
      profileId,
      savingPlanId: planId,
      hardwareProductId: hardwareId,
      agreementVersionId,
      expectedQuoteDigest: 'a'.repeat(64),
      submitForStaffReview: true,
    });

    operatingContext = 'staff';
    await page.goto('/admin/saving-orders');
    await page
      .getByRole('button', {
        name: new RegExp(`Buyer.*${locale === 'fa' ? 'طرح صرفه‌جویی خانه' : 'Home saving plan'}`),
      })
      .click();
    await page.getByRole('button', { name: savingCopy('staffApprove', locale) }).click();
    await expect(page.getByRole('dialog')).toContainText(
      savingReviewCopy('staffReviewOutcome.publish_contract', locale)
    );
    await expect(page.getByRole('dialog')).toContainText('The customer accepts this plan.');
    const approve = page
      .getByRole('dialog')
      .getByRole('button', { name: appCopy('team.confirm', locale), exact: true });
    await expect(approve).toBeDisabled();
    await approveRiskConfirmation(page, locale, 'financial');
    await approve.click();
    await page
      .getByRole('button', { name: savingCopy('fulfillment', locale), exact: true })
      .click();
    await page
      .getByRole('button', {
        name: new RegExp(`Buyer.*${locale === 'fa' ? 'طرح صرفه‌جویی خانه' : 'Home saving plan'}`),
      })
      .click();
    await expect(
      page.getByText(savingCopy('product_delivery', locale), { exact: true })
    ).toBeVisible();
    await expect(page.getByText(savingCopy('staffPaymentRequired', locale))).toBeVisible();
    await page
      .getByRole('textbox', { name: savingCopy('staffReason', locale) })
      .fill('Ready to deliver');
    await expect(
      page.getByRole('button', { name: savingCopy('staffComplete', locale) })
    ).toBeDisabled();
    expect(staffActions).toMatchObject([
      {
        path: 'approve',
        body: { expectedVersionId: agreementVersionId, expectedReviewHash: staffReviewHash },
      },
    ]);
    operatingContext = 'customer';
    await page.goto(`/savings/orders/${savingOrderId}`);
    await expect(page.getByRole('list', { name: savingCopy('fulfillment', locale) })).toContainText(
      savingCopy('product_delivery', locale)
    );
    await expect(page.locator('li[aria-current="step"]')).toContainText(
      savingCopy('product_delivery', locale)
    );
    await page.getByRole('link', { name: savingCopy('orders', locale) }).click();
    await expect(page.getByRole('heading', { name: savingCopy('orders', locale) })).toBeVisible();
    await page
      .getByRole('group', { name: appCopy('historyView.group', locale) })
      .getByRole('button', { name: appCopy('historyView.card', locale), exact: true })
      .click();
    await expect(
      page.getByRole('heading', {
        name: locale === 'fa' ? 'طرح صرفه‌جویی خانه' : 'Home saving plan',
      })
    ).toBeVisible();
    await expect(page.locator(`time[datetime="${submittedAt}"]`).first()).toHaveText(
      new Intl.DateTimeFormat(locale, {
        timeZone: 'Pacific/Kiritimati',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(submittedAt))
    );
    await page.getByRole('button', { name: savingCopy('moreOrders', locale) }).click();
    await expect(
      page.getByRole('heading', {
        name: locale === 'fa' ? 'طرح صرفه‌جویی خانه' : 'Home saving plan',
      })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: locale === 'fa' ? 'طرح قدیمی' : 'Older saving plan' })
    ).toBeVisible();
    await page
      .getByRole('link', { name: savingCopy('orderDetail', locale) })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/savings/orders/${savingOrderId}$`));
    await page.getByRole('link', { name: savingCopy('viewInvoice', locale) }).click();
    await expect(
      page.getByRole('heading', { name: appCopy('invoices.details.title', locale) })
    ).toBeVisible();
    await page
      .getByRole('link', { name: appCopy('invoices.details.backToSavingOrder', locale) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/savings/orders/${savingOrderId}$`));
    await page.getByRole('link', { name: savingCopy('viewContract', locale) }).click();
    await expect(page).toHaveURL(new RegExp(`/contracts\\?contractId=${contractId}$`));
    await expect(page.getByRole('heading', { name: contractCopy('title', locale) })).toBeVisible();

    contractState = 'Active';
    invoiceState = 'PartiallyFunded';
    await page.goto('/savings/orders');
    await expect(
      page.getByRole('link', { name: savingCopy('action.payInvoice', locale) })
    ).toHaveAttribute('href', `/invoices/${invoiceId}`);
    await page.goto(`/savings/orders/${savingOrderId}`);
    await expect(
      page.getByRole('region', { name: appCopy('workflow.summary', locale) }).getByRole('link', {
        name: savingCopy('action.payInvoice', locale),
      })
    ).toHaveAttribute('href', `/invoices/${invoiceId}`);
    await expect(
      page.getByText(savingCopy('PartiallyFunded', locale), { exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: savingCopy('viewInvoice', locale) })
    ).toHaveAttribute('href', `/invoices/${invoiceId}`);

    invoiceState = 'Draft';
    await page.goto(`/savings/orders/${savingOrderId}`);
    await expect(page.getByText(savingCopy('action.awaitInvoice', locale))).toBeVisible();
    await expect(page.getByRole('link', { name: savingCopy('viewInvoice', locale) })).toHaveCount(
      0
    );

    invoiceState = 'Cancelled';
    await page.goto(`/savings/orders/${savingOrderId}`);
    await expect(
      page.getByRole('link', { name: savingCopy('viewInvoice', locale) })
    ).toHaveAttribute('href', `/invoices/${invoiceId}`);
  });
