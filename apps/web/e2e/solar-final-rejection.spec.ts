import { expect, test } from './coverage-fixture';

const requestId = '66666666-6666-4666-8666-666666666666';
const profileId = '11111111-1111-4111-8111-111111111111';

test('staff can reject a postal-reviewed solar request with a reason', async ({ page }) => {
  let rejected = false;
  const decisions: Array<Record<string, unknown>> = [];
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
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
                request_status: 'postal_documents_received',
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
  await page.route(`**/api/admin/solar/requests/${requestId}/final-reject`, (route) => {
    decisions.push(route.request().postDataJSON() as Record<string, unknown>);
    rejected = true;
    return route.fulfill({ json: { status: 'rejected' } });
  });

  await page.goto('/admin/solar-postal');
  await page.getByRole('button', { name: 'تغییر زبان به انگلیسی' }).click();
  await page.getByRole('button', { name: /Solar customer/ }).click();
  await page.getByRole('button', { name: 'Reject request' }).click();
  expect(decisions).toHaveLength(0);
  await page
    .getByRole('textbox', { name: 'Reason' })
    .fill('Original documents failed final review');
  await page.getByRole('button', { name: 'Reject request' }).click();
  await expect(page.getByRole('dialog')).toContainText('Original documents failed final review');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => decisions.length).toBe(1);
  expect(decisions[0]).toEqual({ reason: 'Original documents failed final review' });
  await expect(page.getByRole('button', { name: /Solar customer/ })).toHaveCount(0);
});
