import { test, expect } from './coverage-fixture';

const profileId = '11111111-1111-4111-8111-111111111111';
const orderId = '66666666-6666-4666-8666-666666666666';
const contractId = '77777777-7777-4777-8777-777777777777';
const invoiceId = '88888888-8888-4888-8888-888888888888';
const address = {
  id: '22222222-2222-4222-8222-222222222222',
  profileId,
  provinceId: '33333333-3333-4333-8333-333333333333',
  cityId: '44444444-4444-4444-8444-444444444444',
  fullAddress: 'Electricity Street',
  postalCode: '1234567890',
  mainAddress: true,
};
const addedAddress = {
  ...address,
  id: '99999999-9999-4999-8999-999999999999',
  fullAddress: 'New Power Street',
  postalCode: '9876543210',
  mainAddress: false,
};
const products = (['thermal', 'green', 'free_market', 'energy_saving'] as const).map(
  (systemKey, index) => ({
    id: `${index + 5}5555555-5555-4555-8555-555555555555`,
    systemKey,
    title: { en: systemKey, fa: `برق ${systemKey}` },
    description: null,
    status: 'active',
    price: String((index + 1) * 100000),
    orderable: true,
    simpleOrderable: index === 0,
    simpleOrderBlockReasons: [],
    limits: { minKwh: '0', maxKwh: '10000' },
  })
);

for (const locale of ['en', 'fa'] as const) {
  test(`advanced electricity journey shows a localized bundle and submits its reviewed quote (${locale})`, async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-09-23T10:00:00.000Z') });
    await page.addInitScript((value) => {
      const apply = () => {
        document.documentElement.lang = value;
      };
      apply();
      new MutationObserver(apply).observe(document, { childList: true });
    }, locale);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'buyer',
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/profiles', (route) =>
      route.fulfill({
        json: {
          profiles: [{ id: profileId, profileType: 'LEGAL', title: 'Buyer' }],
          activeProfileId: profileId,
          hasDefault: true,
        },
      })
    );
    await page.route('**/api/user/settings/timezone', (route) =>
      route.fulfill({ json: { timezone: 'Asia/Tehran' } })
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
    await page.route('**/api/products/electricity', (route) => route.fulfill({ json: products }));
    await page.route('**/api/electricity/periods/advanced', (route) =>
      route.fulfill({
        json: {
          limits: { leadTimeDays: 0, maxContractDuration: 24 },
          mandatoryGreenEnabled: true,
        },
      })
    );
    const savedAddresses = [address];
    await page.route(`**/api/profiles/${profileId}/addresses`, (route) => {
      if (route.request().method() === 'POST') {
        savedAddresses.push(addedAddress);
        return route.fulfill({ status: 201, json: addedAddress });
      }
      return route.fulfill({ json: { addresses: savedAddresses } });
    });
    await page.route('**/api/geography/provinces', (route) =>
      route.fulfill({
        json: [{ id: address.provinceId, nameFa: 'تهران', nameEn: 'Tehran' }],
      })
    );
    await page.route(`**/api/geography/provinces/${address.provinceId}/cities`, (route) =>
      route.fulfill({
        json: [
          {
            id: address.cityId,
            provinceId: address.provinceId,
            nameFa: 'تهران',
            nameEn: 'Tehran',
          },
        ],
      })
    );
    const drafts: Array<Record<string, unknown>> = [];
    await page.route('**/api/electricity/drafts/advanced?*', (route) =>
      route.fulfill({
        json: drafts.at(-1) ?? { currentStep: 1, data: null, updatedAt: null },
      })
    );
    await page.route('**/api/electricity/drafts/advanced', (route) => {
      drafts.push(route.request().postDataJSON());
      return route.fulfill({ json: { ...drafts.at(-1), updatedAt: '2026-09-23T10:00:00.000Z' } });
    });
    const previews: Array<Record<string, unknown>> = [];
    let reviewedTotal = '0';
    await page.route('**/api/electricity/preview/advanced', (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      previews.push(body);
      const quantities = body.quantities as Record<string, string>;
      const thermal = Number(quantities.thermal);
      const green = Math.ceil(thermal / 24);
      const totalKwh =
        thermal + green + Number(quantities.free_market) + Number(quantities.energy_saving);
      const lines = [
        ['thermal', thermal, '100000'],
        ['green', green, '200000'],
        ['free_market', Number(quantities.free_market), '300000'],
        ['energy_saving', Number(quantities.energy_saving), '400000'],
      ]
        .filter((line) => Number(line[1]) > 0)
        .map(([systemKey, quantityKwh, unitPriceIrR]) => ({
          systemKey,
          quantityKwh: String(quantityKwh),
          unitPriceIrR,
          subtotalIrR: String(Number(quantityKwh) * Number(unitPriceIrR)),
          discountIrR: '0',
          vatIrR: '0',
        }));
      const total = lines.reduce((sum, line) => sum + Number(line.subtotalIrR), 0);
      reviewedTotal = String(total);
      return route.fulfill({
        json: {
          reviewDigest: 'a'.repeat(64),
          periodStart: body.startAt,
          periodEnd: body.endAt,
          durationHours: String(
            (new Date(body.endAt as string).getTime() -
              new Date(body.startAt as string).getTime()) /
              3_600_000
          ),
          totalKwh: String(totalKwh),
          averagePowerKw: '0.02',
          greenRuleApplies: thermal > 0,
          mandatoryGreenEnabled: true,
          walletBalanceIrR: '500000',
          lines,
          subtotalIrR: String(total),
          discountIrR: '0',
          vatIrR: '0',
          totalIrR: String(total),
        },
      });
    });
    const submissions: Array<Record<string, unknown>> = [];
    await page.route('**/api/electricity/orders/advanced', (route) => {
      submissions.push(route.request().postDataJSON());
      return route.fulfill({
        status: 201,
        json: { orderId },
      });
    });

    await page.route(`**/api/electricity/orders/${orderId}`, (route) =>
      route.fulfill({
        json: {
          orderId,
          profileId,
          commercialStatus: 'PENDING',
          electricityStatus: 'awaiting_staff_review',
          financialStatus: 'unpaid',
          nextAction: 'await_review',
          periodStart: previews.at(-1)?.startAt,
          periodEnd: previews.at(-1)?.endAt,
          totalKwh: '14',
          fullAddress: address.fullAddress,
          postalCode: address.postalCode,
          contractId,
          contractState: 'AwaitingStaffReview',
          versionId: '99999999-9999-4999-8999-999999999999',
          invoiceId,
          invoiceState: 'Unpaid',
          totalIrR: reviewedTotal,
          paidIrR: '0',
          refundedIrR: '0',
          lines: [
            {
              productId: products[0]!.id,
              systemKey: 'thermal',
              title: products[0]!.title,
              quantityKwh: '10',
              unitPriceIrR: '100000',
              lineTotalIrR: '1000000',
            },
          ],
          timeline: [],
        },
      })
    );

    await page.goto('/electricity');
    if (locale === 'en') {
      await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
    }
    await page
      .getByRole('link', {
        name: locale === 'fa' ? 'سفارش پیشرفته' : 'Advanced order',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('heading', {
        name: locale === 'fa' ? 'سفارش پیشرفته برق' : 'Advanced electricity order',
      })
    ).toBeVisible();
    const wizard = page.locator('main[dir]');
    await expect(wizard).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
    const next = page.getByRole('button', {
      name: locale === 'fa' ? 'ادامه' : 'Continue',
      exact: true,
    });
    await next.click();
    await page.locator('#advanced-thermal').fill('10');
    await page.locator('#advanced-free_market').fill('3');
    await expect(page.locator('#advanced-green')).toBeDisabled();
    await expect(page.locator('#advanced-green')).toHaveValue('1');
    await expect(next).toBeEnabled();
    await next.click();
    await expect(wizard).toContainText('1405-07');
    await expect(wizard).toContainText(locale === 'fa' ? 'موجودی کیف پول' : 'Wallet balance');
    await next.click();
    await page
      .getByRole('textbox', {
        name: locale === 'fa' ? 'کد هدیه (اختیاری)' : 'Gift code (optional)',
      })
      .fill('POWER');
    await expect.poll(() => previews.at(-1)?.giftCode).toBe('POWER');
    await next.click();
    await expect(wizard).toContainText(address.fullAddress);
    await page
      .getByRole('button', {
        name: locale === 'fa' ? 'افزودن آدرس جدید' : 'Add New Address',
      })
      .click();
    await expect(page).toHaveURL(/\/settings\/addresses\?/);
    await page
      .getByRole('button', { name: locale === 'fa' ? 'افزودن آدرس' : 'Add Address' })
      .click();
    await page.locator('#addresses-field-1').selectOption(address.provinceId);
    await page.locator('#addresses-field-2').selectOption(address.cityId);
    await page.locator('#addresses-field-3').fill(addedAddress.fullAddress);
    await page.locator('#addresses-field-4').fill(addedAddress.postalCode);
    await page
      .getByRole('button', { name: locale === 'fa' ? 'ذخیره' : 'Save', exact: true })
      .click();
    await expect(page.getByText(addedAddress.fullAddress)).toBeVisible();
    await page
      .getByRole('link', {
        name:
          locale === 'fa' ? 'بازگشت به سفارش پیشرفته برق' : 'Return to advanced electricity order',
      })
      .click();
    await expect(page).toHaveURL(/\/electricity\/advanced$/);
    await expect(wizard).toContainText(addedAddress.fullAddress);
    await page.locator('input[name="advanced-address"]').nth(1).check();
    await page
      .getByRole('button', { name: locale === 'fa' ? 'ثبت سفارش' : 'Submit Order', exact: true })
      .click();
    await expect(page).toHaveURL(/\/electricity\/orders\/66666666-/);
    await expect(page.locator(`a[href="/invoices/${invoiceId}"]`)).toBeVisible();
    expect(drafts).toHaveLength(5);
    expect(drafts.at(-1)?.currentStep).toBe(5);
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      profileId,
      expectedQuoteDigest: 'a'.repeat(64),
      quantities: { thermal: '10', green: '0', free_market: '3', energy_saving: '0' },
      giftCode: 'POWER',
      address: {
        provinceId: addedAddress.provinceId,
        cityId: addedAddress.cityId,
        fullAddress: addedAddress.fullAddress,
        postalCode: addedAddress.postalCode,
      },
    });
  });
}

test('electricity order, paid invoice and published contract keep the selected language', async ({
  page,
}) => {
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({ json: { userId: 'buyer', requiresTosAcceptance: false } })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: profileId, profileType: 'LEGAL', title: 'Buyer' }],
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
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/electricity/orders?*', (route) =>
    route.fulfill({
      json: {
        orders: [
          {
            orderId,
            electricityStatus: 'approved',
            financialStatus: 'paid',
            nextAction: 'accept_contract',
            submittedAt: '2026-09-23T10:00:00.000Z',
            periodStart: '2026-10-01T00:00:00.000Z',
            periodEnd: '2026-10-08T00:00:00.000Z',
            totalKwh: '10',
            totalIrR: '1000000',
          },
        ],
        nextBefore: null,
      },
    })
  );
  const invoice = {
    invoiceId,
    role: 'original',
    state: 'Paid',
    totalAmount: '1000000',
    paidAmount: '1000000',
    refundedAmount: '0',
    accountingAmount: '1000000',
    adjustmentKind: null,
    issuedAt: '2026-09-23T10:00:00.000Z',
    payableFrom: '2026-09-23T10:00:00.000Z',
    dueAt: '2026-09-30T10:00:00.000Z',
    dueAtOverrideReason: null,
    cancelledAt: null,
    createdAt: '2026-09-23T10:00:00.000Z',
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
        electricityOrderId: orderId,
        consultationId: null,
        invoice,
        chain: [invoice],
        payments: [],
        bankReceipts: [],
        refunds: [],
      },
    })
  );
  await page.route(`**/api/electricity/orders/${orderId}`, (route) =>
    route.fulfill({
      json: {
        orderId,
        profileId,
        commercialStatus: 'CONFIRMED',
        electricityStatus: 'approved',
        financialStatus: 'paid',
        nextAction: 'accept_contract',
        periodStart: '2026-10-01T00:00:00.000Z',
        periodEnd: '2026-10-08T00:00:00.000Z',
        totalKwh: '10',
        fullAddress: address.fullAddress,
        postalCode: address.postalCode,
        contractId,
        contractState: 'AwaitingCustomerAcceptance',
        versionId: '99999999-9999-4999-8999-999999999999',
        invoiceId,
        invoiceState: 'Paid',
        totalIrR: '1000000',
        paidIrR: '1000000',
        refundedIrR: '0',
        lines: [],
        timeline: [],
      },
    })
  );

  await page.goto('/electricity/orders');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await expect(page.getByRole('heading', { name: 'Electricity orders' })).toBeVisible();
  await page.getByRole('link', { name: new RegExp(orderId) }).click();
  await expect(page).toHaveURL(new RegExp(`/electricity/orders/${orderId}$`));
  await page.getByRole('link', { name: new RegExp(invoiceId) }).click();
  await expect(page.getByRole('heading', { name: 'Invoice details' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to electricity order' }).click();
  await expect(page).toHaveURL(new RegExp(`/electricity/orders/${orderId}$`));
  await expect(page.getByRole('region', { name: 'Status and next action' })).toContainText(
    'Review and accept the published contract'
  );
  await expect(
    page.getByRole('link', { name: 'Review and accept the published contract.' })
  ).toHaveAttribute('href', `/contracts?contractId=${contractId}`);
  await page.getByRole('link', { name: 'Review and accept the published contract.' }).click();
  await expect(page).toHaveURL(new RegExp(`/contracts\\?contractId=${contractId}$`));
  await expect(page.getByRole('heading', { name: 'Contracts' })).toBeVisible();
});
