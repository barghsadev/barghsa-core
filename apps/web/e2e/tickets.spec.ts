import { test, expect, type Page } from '@playwright/test';
const profileId = '11111111-1111-4111-8111-111111111111',
  ticketId = '22222222-2222-4222-8222-222222222222';
const key = 'uploads/document/33333333-3333-4333-8333-333333333333.pdf';
const item = {
  id: ticketId,
  subject: 'Delivery question',
  body: 'Please explain delivery',
  priority: 'normal',
  status: 'open',
  userId: 'customer',
  profileId,
  assignedTo: null,
  updatedAt: '2026-09-01T12:00:00Z',
  attachments: [],
  relatedEntityType: null,
  relatedEntityId: null,
};
async function shell(page: Page, locale = 'en') {
  await page.addInitScript((value) => {
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = value;
    }).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/staff/tickets/teams', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/profiles', (route) =>
    route.fulfill({ json: { profiles: [], activeProfileId: null } })
  );
  await page.route('**/api/invitations/pending', (route) =>
    route.fulfill({ json: { invitations: [] } })
  );
  await page.route('**/api/profiles/ownership-transfers', (route) =>
    route.fulfill({ json: { transfers: [] } })
  );
  await page.route('**/api/v1/notifications**', (route) =>
    route.fulfill({ json: { data: [], unread_count: 0 } })
  );
}
for (const locale of ['en', 'fa'])
  test(`customer creates attachment ticket without losing uploads on a failed submit (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let created = false,
      submits = 0,
      uploads = 0;
    await page.route('**/api/tickets?*', (route) =>
      route.fulfill({ json: { data: created ? [item] : [], totalPages: 1 } })
    );
    await page.route('**/api/tickets/options**', (route) =>
      route.fulfill({
        json: { profiles: [{ id: profileId, title: 'Example profile' }], records: [] },
      })
    );
    await page.route('**/api/upload/presigned-url', (route) =>
      route.fulfill({ json: { key, presignedUrl: '/test-ticket-upload' } })
    );
    await page.route('**/test-ticket-upload', (route) => {
      uploads++;
      return route.fulfill({ status: 200, body: '' });
    });
    await page.route('**/api/upload/*/verify', (route) =>
      route.fulfill({ json: { status: 'confirmed' } })
    );
    await page.route('**/api/upload/*/record', (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        purpose: 'ticket_attachment',
        profileId,
      });
      return route.fulfill({ json: { status: 'recorded' } });
    });
    await page.route('**/api/tickets', (route) => {
      expect(route.request().postDataJSON()).toEqual({
        subject: 'Delivery question',
        body: 'Please explain delivery',
        priority: 'normal',
        profileId,
        attachments: [key],
      });
      submits++;
      if (submits === 1) return route.fulfill({ status: 500, json: {} });
      created = true;
      return route.fulfill({ status: 201, json: item });
    });
    await page.route(`**/api/tickets/${ticketId}`, (route) =>
      route.fulfill({
        json: {
          ...item,
          attachments: ['ticket-attachments/fixed'],
          attachmentDownloadUrls: ['https://storage.example.test/fixed'],
        },
      })
    );
    await page.route(`**/api/tickets/${ticketId}/comments`, (route) => route.fulfill({ json: [] }));
    await page.goto('/tickets');
    await page
      .getByRole('button', { name: locale === 'en' ? 'Create ticket' : 'ایجاد تیکت', exact: true })
      .click();
    await page.locator('#ticket-subject').fill(item.subject);
    await page.locator('#ticket-body').fill(item.body);
    await page.locator('#ticket-profile').selectOption(profileId);
    await page.locator('#ticket-files').setInputFiles({
      name: 'help.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\nHelp'),
    });
    await page
      .getByRole('button', { name: locale === 'en' ? 'Submit ticket' : 'ثبت تیکت', exact: true })
      .click();
    await expect(page.locator('#ticket-subject')).toHaveValue(item.subject);
    await expect(page.getByRole('alert')).toBeVisible();
    await page
      .getByRole('button', { name: locale === 'en' ? 'Submit ticket' : 'ثبت تیکت', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: item.subject, level: 2 })).toBeFocused();
    await expect(
      page.getByRole('link', { name: locale === 'en' ? 'Open attachment 1' : 'مشاهده پیوست 1' })
    ).toHaveAttribute('href', 'https://storage.example.test/fixed');
    expect(uploads).toBe(1);
    expect(submits).toBe(2);
  });
test('staff assigns, writes a distinct internal note, resolves and reopens without claiming a failed reply saved', async ({
  page,
}) => {
  await shell(page);
  await page.route('**/api/staff/tickets/teams', (route) =>
    route.fulfill({ json: [{ id: profileId, name: 'Support team', members: ['staff'] }] })
  );
  let current = { ...item, status: 'open', assignedTo: null as string | null },
    notes: { id: string; body: string; visibility: string; authorId: string; createdAt: string }[] =
      [],
    fail = true;
  await page.route('**/api/staff/tickets?*', (route) =>
    route.fulfill({
      json: {
        data: [current],
        totalPages: 1,
        viewer: { userId: 'staff', canWrite: true, canAssignOthers: true },
      },
    })
  );
  await page.route('**/api/staff/tickets/assignees', (route) =>
    route.fulfill({ json: [{ id: 'staff', name: 'Support colleague' }] })
  );
  await page.route(`**/api/staff/tickets/${ticketId}`, (route) => route.fulfill({ json: current }));
  await page.route(`**/api/staff/tickets/${ticketId}/assign`, (route) => {
    expect(route.request().postDataJSON()).toEqual({ assigneeId: 'staff', teamId: profileId });
    current = { ...current, assignedTo: 'staff', status: 'in_progress' };
    return route.fulfill({ json: current });
  });
  await page.route(`**/api/staff/tickets/${ticketId}/comments`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: notes });
    const body = route.request().postDataJSON();
    expect(body).toEqual({ body: 'Private reasoning', visibility: 'internal' });
    if (fail) {
      fail = false;
      return route.fulfill({ status: 409, json: {} });
    }
    notes = [{ id: 'note', ...body, authorId: 'staff', createdAt: item.updatedAt }];
    return route.fulfill({ status: 201, json: notes[0] });
  });
  await page.route(`**/api/staff/tickets/${ticketId}/status`, (route) => {
    current = { ...current, status: route.request().postDataJSON().status };
    return route.fulfill({ json: current });
  });
  await page.goto('/admin/tickets');
  await page.getByRole('button', { name: item.subject, exact: true }).click();
  await page.locator('#ticket-team').selectOption(profileId);
  await page.locator('#ticket-assignee').selectOption('staff');
  await page.getByRole('button', { name: 'Assign ticket', exact: true }).click();
  await page.locator('#ticket-reply').fill('Private reasoning');
  await page.getByRole('checkbox', { name: 'Internal note, staff only' }).check();
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('ticket changed');
  await expect(page.locator('#ticket-reply')).toHaveValue('Private reasoning');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(page.getByText('Private reasoning', { exact: true })).toBeVisible();
  await expect(page.getByText('Private reasoning', { exact: true }).locator('..')).toHaveClass(
    /bg-amber-50/
  );
  await page.screenshot({ path: '/tmp/barghsa-ticket-staff-review.png', fullPage: true });
  await page.locator('#ticket-next-status').selectOption('resolved');
  await page.getByRole('button', { name: 'Save status', exact: true }).click();
  await expect(page.locator('#ticket-reply')).toHaveCount(0);
  await page.locator('#ticket-next-status').selectOption('open');
  await page.getByRole('button', { name: 'Save status', exact: true }).click();
  await page.locator('#ticket-next-status').selectOption('in_progress');
  await expect(page.getByRole('button', { name: 'Save status', exact: true })).toBeEnabled();
});
test('assigned-only staff see no reassignment control and stale lists cannot replace newer filters', async ({
  page,
}) => {
  await shell(page);
  let release: () => void = () => {};
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/staff/tickets?*', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('search') === 'old') {
      await delayed;
      return route.fulfill({
        json: { data: [{ ...item, subject: 'Stale result' }], totalPages: 1 },
      });
    }
    return route.fulfill({
      json: {
        data: [item],
        totalPages: 1,
        viewer: { userId: 'staff', canWrite: true, canAssignOthers: false },
      },
    });
  });
  await page.route(`**/api/staff/tickets/${ticketId}`, (route) =>
    route.fulfill({ json: { ...item, status: 'open', assignedTo: 'staff' } })
  );
  await page.route(`**/api/staff/tickets/${ticketId}/comments`, (route) =>
    route.fulfill({ json: [] })
  );
  await page.goto('/admin/tickets');
  await page.getByRole('button', { name: item.subject, exact: true }).click();
  await expect(page.locator('#ticket-assignee')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save status', exact: true })).toBeEnabled();
  const request = page.waitForRequest((request) => request.url().includes('search=old'));
  await page.locator('#ticket-search').fill('old');
  await request;
  await page.locator('#ticket-search').fill('new');
  await expect(page.getByRole('button', { name: item.subject, exact: true })).toBeVisible();
  release();
  await expect(page.getByRole('button', { name: 'Stale result', exact: true })).toHaveCount(0);
});
test('ticket deep links remain available without a profile or active profile selection', async ({
  page,
}) => {
  await shell(page);
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: profileId }, { id: ticketId }],
        hasDefault: false,
        activeProfileId: null,
      },
    })
  );
  await page.route('**/api/tickets?*', (route) =>
    route.fulfill({ json: { data: [], totalPages: 0 } })
  );
  await page.route(`**/api/tickets/${ticketId}`, (route) => route.fulfill({ json: item }));
  await page.route(`**/api/tickets/${ticketId}/comments`, (route) => route.fulfill({ json: [] }));
  await page.goto(`/tickets?ticketId=${ticketId}`);
  await expect(page.getByRole('heading', { name: item.subject, level: 2 })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
