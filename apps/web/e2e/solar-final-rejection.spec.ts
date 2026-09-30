import { expect, test } from './coverage-fixture';

const requestId = '66666666-6666-4666-8666-666666666666';
const profileId = '11111111-1111-4111-8111-111111111111';
const reviewHash = 'a'.repeat(64);

test('staff can reject a postal-reviewed solar request with a reason', async ({ page }) => {
  let rejected = false;
  let finalReview = false;
  const decisions: Array<Record<string, unknown>> = [];
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        isStaff: true,
        operatingContext: 'staff',
        userId: 'reviewer',
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/admin/solar/postal-guidance', (route) =>
    route.fulfill({
      json: {
        fa: 'راهنمای پستی',
        en: 'Postal guidance',
        destinationAddress: '',
        contactDetails: '',
        originals: [],
      },
    })
  );
  await page.route('**/api/admin/solar/postal-queue?*', (route) =>
    route.fulfill({
      json: {
        requests: rejected
          ? []
          : [
              {
                id: requestId,
                profile_id: profileId,
                profile_name: 'Solar customer',
                request_status: finalReview ? 'final_review' : 'postal_documents_received',
                postal_status: 'received',
                courier: 'Parcel Co',
                tracking_number: 'TRACK-123',
                send_date: '2026-09-23',
                receipt_image_id: null,
                staff_notes: null,
                created_at: '2026-09-23T10:00:00.000Z',
              },
            ],
        nextBefore: null,
      },
    })
  );
  await page.route(`**/api/admin/solar/requests/${requestId}/start-final-review`, (route) => {
    finalReview = true;
    return route.fulfill({ json: { status: 'final_review' } });
  });
  await page.route(`**/api/admin/solar/requests/${requestId}/final-decision/review`, (route) => {
    expect(route.request().postDataJSON()).toEqual({
      decision: 'reject',
      reason: 'Original documents failed final review',
    });
    return route.fulfill({
      json: {
        hash: reviewHash,
        data: {
          requestId,
          currentStatus: 'final_review',
          postalStatus: 'received',
          trackingNumber: 'TRACK-123',
          reason: 'Original documents failed final review',
          outcome: 'rejected',
        },
      },
    });
  });
  await page.route(`**/api/admin/solar/requests/${requestId}/final-reject`, (route) => {
    decisions.push(route.request().postDataJSON() as Record<string, unknown>);
    rejected = true;
    return route.fulfill({ json: { status: 'rejected' } });
  });

  await page.goto('/admin/solar-postal');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await page.getByRole('button', { name: /Solar customer/ }).click();
  await expect(page.getByRole('button', { name: 'Reject request' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start final review' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('button', { name: 'Reject request' })).toBeVisible();
  await page.getByRole('button', { name: 'Reject request' }).click();
  expect(decisions).toHaveLength(0);
  await page
    .getByRole('textbox', { name: 'Reason' })
    .fill('Original documents failed final review');
  await page.getByRole('button', { name: 'Reject request' }).click();
  await expect(page.getByRole('dialog')).toContainText('Original documents failed final review');
  await expect(page.getByRole('dialog')).toContainText('After confirmation');
  await expect(page.getByRole('dialog')).toContainText('Rejected');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => decisions.length).toBe(1);
  expect(decisions[0]).toEqual({
    reason: 'Original documents failed final review',
    expectedReviewHash: reviewHash,
  });
  await expect(page.getByRole('button', { name: /Solar customer/ })).toHaveCount(0);
});
