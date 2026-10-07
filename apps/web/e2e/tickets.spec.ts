import { fullNavigation } from './navigation-fixture';
import { financeContract, financeVersion } from '../src/test/contract-finance-list-fixtures.js';
import { formatBrowserDate } from './browser-date';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { t } from '@barghsa/i18n/app';
import { tTicketForms } from '@barghsa/i18n/ticket-forms';
import { documentText } from '@barghsa/i18n/documents';
import { pdfPreviewImage, pdfPreviewFixture } from './upload-fixture';
const profileId = '11111111-1111-4111-8111-111111111111',
  ticketId = '22222222-2222-4222-8222-222222222222';
const key = `ticket-attachments/33333333-3333-4333-8333-333333333333/${'a'.repeat(64)}`;
const missingKey = `ticket-attachments/33333333-3333-4333-8333-333333333333/${'b'.repeat(64)}`;
const item = {
  id: ticketId,
  subject: 'Delivery question',
  body: 'Please explain delivery',
  priority: 'normal',
  category: 'general',
  assignedTeamId: null,
  status: 'open',
  userId: 'customer',
  profileId,
  assignedTo: null,
  createdAt: '2026-08-31T12:00:00Z',
  updatedAt: '2026-09-01T01:00:00Z',
  attachments: [],
  relatedEntityType: null,
  relatedEntityId: null,
};

for (const staff of [false, true])
  for (const locale of ['en', 'fa'] as const) {
    test(`${staff ? 'staff' : 'customer'} previews verified ticket PDF first pages and keeps downloads on derivative failure (${locale})`, async ({
      page,
    }, testInfo) => {
      await shell(page, locale, staff);
      await page.route('**/api/user/settings/theme', (route) =>
        route.fulfill({ json: { mode: locale === 'fa' ? 'dark' : 'light' } })
      );
      const prefix = staff ? '/api/staff/tickets' : '/api/tickets';
      const commentId = '44444444-4444-4444-8444-444444444444',
        privateId = '55555555-5555-4555-8555-555555555555';
      const comments = [
        {
          id: commentId,
          authorId: 'customer',
          authorContext: 'customer',
          body: 'Verified PDF evidence',
          visibility: 'public',
          createdAt: item.createdAt,
          attachmentCount: 2,
          attachments: [
            {
              key: 'ticket-reply-attachments/pdf',
              fileIndex: 1,
              fileName: 'proof.pdf',
              contentType: 'application/pdf',
              url: 'https://storage.example.test/proof.pdf',
            },
          ],
        },
        {
          id: privateId,
          authorId: 'staff',
          authorContext: 'staff',
          body: 'Internal evidence',
          visibility: 'internal',
          createdAt: item.createdAt,
          attachments: [
            {
              key: 'ticket-reply-attachments/private',
              fileIndex: 0,
              fileName: 'private.pdf',
              contentType: 'application/pdf',
              url: 'https://storage.example.test/private.pdf',
            },
          ],
        },
      ];
      await page.route(
        (url) => url.pathname === prefix,
        (route) =>
          route.fulfill({
            json: {
              data: [item],
              totalPages: 1,
              viewer: { userId: 'staff', canWrite: true, canAssignOthers: true },
            },
          })
      );
      await page.route(`**${prefix}/${ticketId}`, (route) =>
        route.fulfill({
          json: {
            ...item,
            attachments: [missingKey, key],
            attachmentDownloadUrls: ['https://storage.example.test/initial.pdf'],
            attachmentFiles: [
              {
                key: key,
                fileIndex: 1,
                fileName: 'initial.pdf',
                contentType: 'application/pdf',
                url: 'https://storage.example.test/initial.pdf',
              },
            ],
          },
        })
      );
      let denied = false,
        privateReads = 0;
      await page.route(`**${prefix}/${ticketId}/comments`, (route) =>
        route.fulfill({ json: comments })
      );
      await page.route(`**${prefix}/${ticketId}/comments/*/attachments/*/preview`, (route) => {
        const url = route.request().url();
        if (url.includes(privateId)) privateReads++;
        if (denied) return route.fulfill({ status: 403, json: {} });
        expect(url).toContain(
          url.includes(privateId) ? '/attachments/0/preview' : '/attachments/1/preview'
        );
        return route.fulfill({
          contentType: 'image/png',
          headers: { 'Cache-Control': 'private, no-store' },
          body: pdfPreviewImage,
        });
      });
      await page.route(`**${prefix}/${ticketId}/attachments/*/preview`, (route) => {
        expect(route.request().url()).toContain('/attachments/1/preview');
        return denied
          ? route.fulfill({ status: 403, json: {} })
          : route.fulfill({ contentType: 'image/png', body: pdfPreviewImage });
      });
      let transientReads = 0,
        reservations = 0;
      await page.route('**/api/upload/preview', (route) => {
        transientReads++;
        expect(route.request().headers()['content-type']).toBe('application/pdf');
        return route.fulfill({ contentType: 'image/png', body: pdfPreviewImage });
      });
      await page.route('**/api/upload/presign*', (route) => {
        reservations++;
        return route.fulfill({ status: 500 });
      });
      await page.goto(staff ? '/admin/tickets' : '/tickets');
      await page.getByRole('button', { name: item.subject, exact: true }).click();
      const initial = page.getByRole('img', {
        name: `${documentText('preview', locale)}: initial.pdf`,
        exact: true,
      });
      await expect
        .poll(() => initial.evaluate((node) => (node as HTMLImageElement).naturalWidth))
        .toBe(640);
      await expect(page.getByRole('link', { name: 'initial.pdf', exact: true })).toHaveAttribute(
        'href',
        'https://storage.example.test/initial.pdf'
      );
      const composer = page.locator('[data-slot=ticket-reply-input]');
      await composer.locator('input[type=file]').setInputFiles({
        name: 'draft.pdf',
        mimeType: 'application/pdf',
        buffer: pdfPreviewFixture(),
      });
      const toggle = composer.getByRole('button', {
        name: `${documentText('preview', locale)}: draft.pdf`,
        exact: true,
      });
      await toggle.click();
      await expect
        .poll(() =>
          composer.getByRole('img').evaluate((node) => (node as HTMLImageElement).naturalWidth)
        )
        .toBe(640);
      await toggle.click();
      await expect(composer.getByRole('img')).toHaveCount(0);
      expect(transientReads).toBe(1);
      expect(reservations).toBe(0);
      const thread = page.locator('[aria-labelledby=ticket-conversation-heading]');
      const image = thread.getByRole('img', {
        name: `${documentText('preview', locale)}: proof.pdf`,
        exact: true,
      });
      await expect
        .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
        .toBe(640);
      await expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
      const link = thread.getByRole('link', { name: /proof.pdf/ });
      await expect(link).toHaveAttribute('href', 'https://storage.example.test/proof.pdf');
      await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
      if (!staff) {
        await expect(thread).not.toContainText('Internal evidence');
        expect(privateReads).toBe(0);
        await expect(thread.getByRole('link', { name: /private.pdf/ })).toHaveCount(0);
      } else
        await expect(
          thread.getByRole('img', {
            name: `${documentText('preview', locale)}: private.pdf`,
            exact: true,
          })
        ).toBeVisible();
      expect(
        (
          await new AxeBuilder({ page })
            .include('[aria-labelledby=ticket-conversation-heading]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      await thread.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `/tmp/barghsa-ticket-pdf-${staff ? 'staff' : 'customer'}-${locale}-${testInfo.project.name}.png`,
      });
      if (!staff) {
        await page.route('**/api/tickets/options*', (route) =>
          route.fulfill({ json: { profiles: [], records: [] } })
        );
        await page.getByRole('button', { name: t('tickets.create', locale), exact: true }).click();
        await page.locator('#ticket-files').setInputFiles({
          name: 'new-ticket.pdf',
          mimeType: 'application/pdf',
          buffer: pdfPreviewFixture(),
        });
        const createToggle = page.getByRole('button', {
          name: `${documentText('preview', locale)}: new-ticket.pdf`,
          exact: true,
        });
        await createToggle.click();
        const draftImage = page.getByRole('img', {
          name: `${documentText('preview', locale)}: new-ticket.pdf`,
          exact: true,
        });
        await expect
          .poll(() => draftImage.evaluate((node) => (node as HTMLImageElement).naturalWidth))
          .toBe(640);
        await createToggle.click();
        expect(transientReads).toBe(2);
        expect(reservations).toBe(0);
      }
      denied = true;
      await page.reload();
      // URL-selected detail is restored; a failed derivative retains its original file action.
      const recovered = page.locator('[aria-labelledby=ticket-conversation-heading]');
      await expect(
        recovered
          .getByRole('img', { name: `${documentText('previewUnavailable', locale)}`, exact: true })
          .first()
      ).toBeVisible();
      await expect(recovered.getByRole('link', { name: /proof.pdf/ })).toHaveAttribute(
        'href',
        'https://storage.example.test/proof.pdf'
      );
      await expect(page.getByRole('link', { name: 'initial.pdf', exact: true })).toHaveAttribute(
        'href',
        'https://storage.example.test/initial.pdf'
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
    });
  }
for (const staff of [false, true])
  for (const locale of ['en', 'fa'] as const)
    test(`${staff ? 'staff' : 'customer'} ticket queue views keep disclosure, conversation and failed-page recovery (${locale})`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.clock.setFixedTime(new Date('2026-10-01T12:00:00Z'));
      await shell(page, locale, staff);
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Support',
            appTitleFa: 'پشتیبانی',
            supportEmail: 'support@example.test',
            supportPhone: '02126658042',
            supportMobile: '09123456789',
            slogan: '',
            primaryColor: '#2563eb',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode: locale === 'fa',
            numberStyle: locale === 'fa' ? 'persian' : 'western',
          },
        })
      );
      const row = {
        ...item,
        priority: 'high',
        updatedAt: '2026-10-01T11:50:00Z',
        relatedEntityType: 'invoice',
        relatedEntityId: profileId,
        assignedTo: 'staff',
      };
      const prefix = staff ? '/api/staff/tickets' : '/api/tickets';
      let reads = 0,
        detailReads = 0,
        status = 200;
      await page.route(
        (url) => url.pathname === prefix,
        (route) => {
          reads++;
          return route.fulfill({
            status,
            json: {
              data: [row],
              totalPages: 2,
              responseTargetHours: 24,
              viewer: { userId: 'staff', canWrite: true, canAssignOthers: true },
            },
          });
        }
      );
      await page.route(`**${prefix}/${ticketId}`, (route) => {
        detailReads++;
        return route.fulfill({ json: row });
      });
      await page.route(`**${prefix}/${ticketId}/comments`, (route) => route.fulfill({ json: [] }));
      await page.route('**/api/staff/tickets/assignees', (route) =>
        route.fulfill({ json: [{ id: 'staff', name: 'Support agent' }] })
      );
      const copy = (key: string) => t(`tickets.${key}`, locale);
      const records = page.locator('[data-slot=ticket-queue-records]');
      const cards = page.getByRole('button', { name: t('historyView.card', locale), exact: true });
      const table = page.getByRole('button', { name: t('historyView.table', locale), exact: true });
      const path = staff ? '/admin/tickets' : '/tickets';
      await page.goto(path);
      await expect(cards).toHaveAttribute('aria-pressed', 'true');
      await expect(records.getByRole('button', { name: item.subject, exact: true })).toBeVisible();
      await expect(records).toContainText('P1');
      await expect(records).toContainText(locale === 'fa' ? '۱۰ دقیقه پیش' : '10 minutes ago');
      const exact = await formatBrowserDate(
        page,
        locale,
        { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' },
        row.updatedAt
      );
      await expect(records).toContainText(exact);
      const disclosure = records.locator('details');
      await expect(disclosure).not.toHaveAttribute('open');
      await disclosure.locator('summary').focus();
      await page.keyboard.press('Enter');
      await expect(disclosure).toHaveAttribute('open', '');
      if (staff) {
        await expect(records).toContainText('Support agent');
        await expect(records.getByRole('link')).toHaveCount(0);
      } else
        await expect(records.getByRole('link')).toHaveAttribute('href', `/invoices/${profileId}`);
      const initialReads = reads;
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(records.getByRole('table')).toBeVisible();
      await expect(records.getByRole('columnheader')).toHaveCount(staff ? 9 : 6);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(records.locator('details')).toHaveAttribute('open', '');
      expect(reads).toBe(initialReads);
      await records.getByRole('button', { name: item.subject, exact: true }).click();
      await expect(page.getByRole('heading', { name: item.subject, level: 2 })).toBeFocused();
      await expect(page.locator('[data-slot=ticket-detail] header time').first()).toHaveAttribute(
        'datetime',
        item.createdAt
      );
      await expect(page.locator('[data-slot=ticket-detail] header')).toContainText(
        await formatBrowserDate(
          page,
          locale,
          { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' },
          item.createdAt
        )
      );
      await page.locator('#ticket-reply').fill('Keep this reply');
      const selectedReads = detailReads;
      status = 503;
      await page.getByRole('button', { name: copy('next'), exact: true }).click();
      await expect(page.getByRole('alert')).toContainText(copy('queueError'));
      const failedReads = reads;
      await table.click();
      await expect(records.getByRole('table')).toBeVisible();
      await cards.click();
      await expect(records.locator('details')).toHaveAttribute('open', '');
      await expect(page.locator('#ticket-reply')).toHaveValue('Keep this reply');
      expect(reads).toBe(failedReads);
      expect(detailReads).toBe(selectedReads);
      status = 200;
      await page.getByRole('button', { name: copy('retry'), exact: true }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(reads).toBe(failedReads + 1);
      await expect(page.locator('#ticket-reply')).toHaveValue('Keep this reply');
      if (locale === 'fa') await expect(page.locator('html')).toHaveClass(/dark/);
      else await expect(page.locator('html')).not.toHaveClass(/dark/);
      expect(
        (
          await new AxeBuilder({ page })
            .include('section.max-w-5xl')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      if (locale === 'fa')
        await records.screenshot({
          path: `/tmp/barghsa-ticket-views-${staff ? 'staff' : 'customer'}-${testInfo.project.name}.png`,
        });
      await table.click();
      await page.reload();
      await expect(table).toHaveAttribute('aria-pressed', 'true');
      await expect(records.getByRole('table')).toBeVisible();
      status = 403;
      await page.getByRole('button', { name: copy('refresh'), exact: true }).click();
      await expect(records).toHaveCount(0);
      await expect(page.locator('#ticket-reply')).toHaveCount(0);
    });
async function shell(page: Page, locale = 'en', staff = false) {
  await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: staff ? 'staff' : 'customer',
        isStaff: staff,
        navigation: fullNavigation(staff ? 'staff' : 'customer'),
        operatingContext: staff ? 'staff' : 'customer',
        canSwitchContext: false,
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'America/Los_Angeles' } })
  );
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
  test(`customer creates a contract-linked attachment ticket without losing uploads on a failed submit (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    const category = locale === 'en' ? 'billing' : 'orders';
    let created = false,
      submits = 0,
      uploads = 0;
    await page.route('**/api/tickets?*', (route) =>
      route.fulfill({
        json: {
          data: created
            ? [
                {
                  ...item,
                  category,
                  relatedEntityType: 'contract',
                  relatedEntityId: profileId,
                  attachments: [key],
                },
              ]
            : [],
          totalPages: 1,
        },
      })
    );
    await page.route('**/api/tickets/options**', (route) =>
      route.fulfill({
        json: {
          profiles: [{ id: profileId, title: 'Example profile' }],
          records: [{ id: profileId, type: 'contract', created_at: item.createdAt }],
        },
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
      const input = route.request().postDataJSON();
      expect(input.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
      expect(input).toEqual({
        idempotencyKey: input.idempotencyKey,
        subject: 'Delivery question',
        body: 'Please explain delivery',
        priority: 'normal',
        category,
        profileId,
        attachments: [key],
        relatedEntityType: 'contract',
        relatedEntityId: profileId,
      });
      submits++;
      if (submits === 1) return route.fulfill({ status: 500, json: {} });
      created = true;
      return route.fulfill({
        status: 201,
        json: {
          ...item,
          category,
          relatedEntityType: 'contract',
          relatedEntityId: profileId,
          attachments: [key],
        },
      });
    });
    await page.route(`**/api/tickets/${ticketId}`, (route) =>
      route.fulfill({
        json: {
          ...item,
          category,
          relatedEntityType: 'contract',
          relatedEntityId: profileId,
          attachments: [key],
          attachmentDownloadUrls: ['https://storage.example.test/fixed'],
        },
      })
    );
    await page.route(`**/api/tickets/${ticketId}/comments`, (route) => route.fulfill({ json: [] }));
    await page.goto('/tickets');
    await page
      .getByRole('button', { name: locale === 'en' ? 'Table' : 'جدول', exact: true })
      .click();
    await page
      .getByRole('button', { name: locale === 'en' ? 'Create ticket' : 'ایجاد تیکت', exact: true })
      .click();
    await page.locator('#ticket-subject').fill(item.subject);
    await page.locator('#ticket-body').fill(item.body);
    await expect(page.locator('#ticket-category')).toHaveValue('general');
    await page.locator('#ticket-category').selectOption(category);
    await page.locator('#ticket-profile').selectOption(profileId);
    await page.locator('#ticket-record').selectOption(`contract:${profileId}`);
    await page.locator('#ticket-files').setInputFiles({
      name: 'help.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\nHelp'),
    });
    await page
      .getByRole('button', { name: locale === 'en' ? 'Submit ticket' : 'ثبت تیکت', exact: true })
      .click();
    await expect(page.locator('#ticket-subject')).toHaveValue(item.subject);
    await expect(page.locator('#ticket-category')).toHaveValue(category);
    await expect(page.getByRole('alert')).toBeVisible();
    await page
      .getByRole('button', { name: tTicketForms('retryOriginal', locale), exact: true })
      .click();
    await expect(page.getByRole('heading', { name: item.subject, level: 2 })).toBeFocused();
    await expect(
      page.getByRole('cell', { name: locale === 'en' ? 'Billing' : 'سفارش‌ها', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: locale === 'en' ? 'Open attachment 1' : 'مشاهده پیوست 1' })
    ).toHaveAttribute('href', 'https://storage.example.test/fixed');
    await expect(
      page
        .getByRole('row')
        .filter({ has: page.getByRole('button', { name: item.subject, exact: true }) })
    ).toContainText(
      await formatBrowserDate(
        page,
        locale,
        {
          timeZone: 'America/Los_Angeles',
          dateStyle: 'medium',
          timeStyle: 'short',
        },
        item.updatedAt
      )
    );
    expect(uploads).toBe(1);
    expect(submits).toBe(2);
  });
for (const locale of ['en', 'fa'] as const) {
  test(`customer ticket list and detail link to the related invoice (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    const invoiceTicket = { ...item, relatedEntityId: profileId, relatedEntityType: 'invoice' };
    const orderTicket = {
      ...item,
      id: profileId,
      subject: 'Order question',
      relatedEntityId: ticketId,
      relatedEntityType: 'order',
    };
    await page.route('**/api/tickets?*', (route) =>
      route.fulfill({ json: { data: [invoiceTicket, orderTicket], totalPages: 1 } })
    );
    await page.route(`**/api/tickets/${ticketId}`, (route) =>
      route.fulfill({ json: invoiceTicket })
    );
    await page.route(`**/api/tickets/${ticketId}/comments`, (route) => route.fulfill({ json: [] }));
    await page.goto('/tickets');
    await page
      .getByRole('button', { name: locale === 'en' ? 'Table' : 'جدول', exact: true })
      .click();
    const invoiceLink = page.getByRole('link', {
      name: `${locale === 'en' ? 'Invoice' : 'صورتحساب'} ${profileId}`,
      exact: true,
    });
    await expect(invoiceLink).toHaveCount(1);
    await expect(invoiceLink).toHaveAttribute('href', `/invoices/${profileId}`);
    const orderRow = page
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: 'Order question', exact: true }) });
    await expect(orderRow.getByRole('link')).toHaveCount(0);
    await expect(orderRow).toContainText(
      locale === 'en' ? 'Record view is unavailable.' : 'نمایش این رکورد در دسترس نیست.'
    );
    await page.getByRole('button', { name: item.subject, exact: true }).click();
    await expect(invoiceLink).toHaveCount(2);
    await expect(invoiceLink.nth(1)).toHaveAttribute('href', `/invoices/${profileId}`);
    await expect(
      page.getByRole('region', { name: locale === 'en' ? 'Customer information' : 'اطلاعات مشتری' })
    ).toHaveCount(0);
  });

  test(`staff ticket detail shows customer contacts and the current profile (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale, true);
    if (locale === 'fa') await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/public/branding/config', (route) =>
      route.fulfill({
        json: {
          appTitle: 'Support',
          slogan: '',
          primaryColor: '#2563eb',
          secondaryColor: '#64748b',
          accentColor: '#f59e0b',
          logoUrl: null,
          faviconUrl: null,
          darkMode: locale === 'fa',
          numberStyle: locale === 'fa' ? 'persian' : 'western',
        },
      })
    );
    let currentProfile: { id: string; title: string } | null = {
      id: profileId,
      title: 'Customer profile',
    };
    await page.route('**/api/staff/tickets?*', (route) =>
      route.fulfill({
        json: {
          data: [item],
          totalPages: 1,
          viewer: { userId: 'staff', canWrite: false, canAssignOthers: false },
        },
      })
    );
    await page.route(`**/api/staff/tickets/${ticketId}`, (route) =>
      route.fulfill({
        json: {
          ...item,
          relatedEntityType: 'invoice',
          relatedEntityId: profileId,
          customer: {
            userId: 'customer',
            username: 'customer@example.test',
            email: 'contact@example.test',
            mobile: '+989121234567',
            profile: currentProfile,
          },
        },
      })
    );
    await page.route(`**/api/staff/tickets/${ticketId}/comments`, (route) =>
      route.fulfill({ json: [] })
    );
    await page.goto('/admin/tickets');
    await page.getByRole('button', { name: item.subject, exact: true }).click();
    const panel = page.getByRole('region', {
      name: locale === 'en' ? 'Customer information' : 'اطلاعات مشتری',
    });
    await expect(panel).toBeVisible();
    for (const value of [
      'customer@example.test',
      'contact@example.test',
      '+989121234567',
      'Customer profile',
    ])
      await expect(panel.getByText(value, { exact: true })).toBeVisible();
    await expect(panel.getByRole('link')).toHaveAttribute(
      'href',
      `/admin/crm/profiles/${profileId}`
    );
    await expect(page.locator('article a[href="/admin/invoices"]')).toHaveCount(0);
    expect(
      (
        await new AxeBuilder({ page })
          .include('section.max-w-5xl')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations
    ).toEqual([]);
    currentProfile = null;
    await page.getByRole('button', { name: item.subject, exact: true }).click();
    await expect(panel.getByRole('link')).toHaveCount(0);
    await expect(panel.getByText('Customer profile', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('contact@example.test', { exact: true })).toBeVisible();
  });
}

test('staff assigns, writes a distinct internal note, resolves and reopens without claiming a failed reply saved', async ({
  page,
}) => {
  await shell(page, 'en', true);
  await page.route('**/api/staff/tickets/teams', (route) =>
    route.fulfill({ json: [{ id: profileId, name: 'Support team', members: ['staff'] }] })
  );
  let current = {
      ...item,
      status: 'open',
      assignedTo: null as string | null,
      assignedTeamId: null as string | null,
    },
    notes: Record<string, unknown>[] = [],
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
    const input = route.request().postDataJSON();
    expect(input.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
    expect(input).toEqual({
      assigneeId: 'staff',
      teamId: profileId,
      idempotencyKey: input.idempotencyKey,
    });
    current = { ...current, assignedTo: 'staff', assignedTeamId: profileId, status: 'in_progress' };
    return route.fulfill({ json: current });
  });
  await page.route(`**/api/staff/tickets/${ticketId}/comments`, (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: notes });
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({
      body: 'Private reasoning',
      visibility: 'internal',
      bodyFormat: 'markdown',
      attachments: [],
    });
    expect(body.submissionId).toMatch(/^[a-f0-9-]{36}$/);
    if (fail) {
      fail = false;
      return route.fulfill({ status: 409, json: {} });
    }
    notes = [
      {
        id: '66666666-6666-4666-8666-666666666666',
        ...body,
        ticketId,
        authorId: 'staff',
        authorContext: 'staff',
        createdAt: item.updatedAt,
        updatedAt: item.updatedAt,
        attachmentCount: 0,
        attachments: [],
        author: null,
      },
    ];
    return route.fulfill({ status: 201, json: notes[0] });
  });
  let failedStatus = false;
  await page.route(`**/api/staff/tickets/${ticketId}/status`, (route) => {
    const input = route.request().postDataJSON();
    expect(input.reason).toBe(
      input.status === 'resolved'
        ? 'Customer confirmed the solution'
        : 'Customer needs another review'
    );
    if (!failedStatus) {
      failedStatus = true;
      return route.fulfill({ status: 503, json: {} });
    }
    current = { ...current, status: input.status };
    return route.fulfill({ json: current });
  });
  await page.goto('/admin/tickets');
  await page.getByRole('button', { name: item.subject, exact: true }).click();
  await page.locator('#ticket-team').selectOption(profileId);
  await page.locator('#ticket-assignee').selectOption('staff');
  await page.getByRole('button', { name: 'Assign ticket', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Internal note, staff only' }).check();
  await page.locator('#ticket-reply').fill('Private reasoning');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(
    page.getByRole('alert').getByText(tTicketForms('uncertain', 'en'), { exact: true })
  ).toHaveText(tTicketForms('uncertain', 'en'));
  await expect(page.locator('#ticket-reply')).toBeDisabled();
  await expect(
    page.getByRole('button', { name: tTicketForms('retryOriginal', 'en'), exact: true })
  ).toBeEnabled();
  await expect(page.locator('#ticket-reply')).toHaveValue('Private reasoning');
  await page
    .getByRole('button', { name: tTicketForms('retryOriginal', 'en'), exact: true })
    .click();
  await expect(
    page.locator('[data-slot=ticket-comment]').getByText('Private reasoning', { exact: true })
  ).toBeVisible();
  await expect(
    page
      .locator('[data-slot=ticket-comment]')
      .getByText('Private reasoning', { exact: true })
      .locator('xpath=ancestor::li[@data-slot="ticket-comment"]')
  ).toContainText(
    await formatBrowserDate(
      page,
      'en',
      { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' },
      item.updatedAt
    )
  );
  await expect(
    page
      .locator('[data-slot=ticket-comment]')
      .getByText('Private reasoning', { exact: true })
      .locator('xpath=ancestor::li[@data-slot="ticket-comment"]')
  ).toHaveClass(/bg-warning-soft/);
  await page.screenshot({ path: '/tmp/barghsa-ticket-staff-review.png', fullPage: true });
  await page.locator('#ticket-next-status').selectOption('resolved');
  await page.getByRole('button', { name: 'Save status', exact: true }).click();
  await expect(page.locator('#ticket-status-reason')).toHaveAttribute('aria-invalid', 'true');
  expect(failedStatus).toBe(false);
  expect(current.status).toBe('in_progress');
  await page.locator('#ticket-status-reason').fill('Customer confirmed the solution');
  await page.getByRole('button', { name: 'Save status', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#ticket-status-reason')).toHaveValue(
    'Customer confirmed the solution'
  );
  await page
    .getByRole('button', { name: tTicketForms('retryOriginal', 'en'), exact: true })
    .click();
  await expect(page.locator('#ticket-reply')).toBeHidden();
  await expect(page.locator('#ticket-reply')).toHaveValue('');
  await page.locator('#ticket-next-status').selectOption('open');
  await page.locator('#ticket-status-reason').fill('Customer needs another review');
  await page.getByRole('button', { name: 'Save status', exact: true }).click();
  await page.locator('#ticket-next-status').selectOption('in_progress');
  await page.locator('#ticket-status-reason').fill('Staff follow-up');
  await expect(page.getByRole('button', { name: 'Save status', exact: true })).toBeEnabled();
});
test('staff with broad read access only edit tickets assigned to them', async ({ page }) => {
  await shell(page, 'en', true);
  let assignedTo = 'another-colleague';
  await page.route('**/api/staff/tickets?*', (route) =>
    route.fulfill({
      json: {
        data: [{ ...item, assignedTo, status: 'in_progress' }],
        totalPages: 1,
        viewer: { userId: 'staff', canWrite: true, canAssignOthers: false },
      },
    })
  );
  await page.route(`**/api/staff/tickets/${ticketId}`, (route) =>
    route.fulfill({ json: { ...item, assignedTo, status: 'in_progress' } })
  );
  await page.route(`**/api/staff/tickets/${ticketId}/comments`, (route) =>
    route.fulfill({
      json: [
        {
          id: 'note',
          body: 'Visible internal history',
          visibility: 'internal',
          authorId: 'another-colleague',
          createdAt: item.updatedAt,
        },
      ],
    })
  );
  await page.goto('/admin/tickets');
  await page.getByRole('button', { name: item.subject, exact: true }).click();
  await expect(page.getByText('Visible internal history', { exact: true })).toBeVisible();
  await expect(page.locator('#ticket-reply')).toHaveCount(0);
  await expect(page.locator('#ticket-next-status')).toHaveCount(0);
  await expect(page.locator('#ticket-assignee')).toHaveCount(0);
  assignedTo = 'staff';
  await page.getByRole('button', { name: item.subject, exact: true }).click();
  await expect(page.locator('#ticket-reply')).toBeVisible();
  await expect(page.locator('#ticket-next-status')).toBeVisible();
});

for (const { locale, darkMode } of [
  { locale: 'en', darkMode: true },
  { locale: 'fa', darkMode: true },
  { locale: 'en', darkMode: false },
  { locale: 'fa', darkMode: false },
])
  test(`ticket form and conversation have readable ${darkMode ? 'dark' : 'light'} colors (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    await page.route('**/api/public/branding/config', (route) =>
      route.fulfill({
        json: {
          appTitle: 'Support',
          appTitleFa: 'پشتیبانی',
          supportEmail: 'support@example.test',
          supportPhone: '02126658042',
          supportMobile: '09123456789',
          slogan: '',
          primaryColor: '#2563eb',
          secondaryColor: '#64748b',
          accentColor: '#f59e0b',
          logoUrl: null,
          faviconUrl: null,
          darkMode,
          numberStyle: locale === 'fa' ? 'persian' : 'western',
        },
      })
    );
    await page.route('**/api/tickets?*', (route) =>
      route.fulfill({ json: { data: [item], totalPages: 1 } })
    );
    await page.route('**/api/tickets/options**', (route) =>
      route.fulfill({ json: { profiles: [], records: [] } })
    );
    await page.route(`**/api/tickets/${ticketId}`, (route) => route.fulfill({ json: item }));
    await page.route(`**/api/tickets/${ticketId}/comments`, (route) =>
      route.fulfill({
        json: [
          {
            id: 'public',
            body: 'A support reply',
            visibility: 'public',
            authorId: 'staff',
            createdAt: item.updatedAt,
          },
        ],
      })
    );
    await page.goto('/tickets');
    if (darkMode) await expect(page.locator('html')).toHaveClass(/dark/);
    else await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.getByRole('button', { name: item.subject, exact: true }).click();
    await expect(page.getByText('A support reply', { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: locale === 'en' ? 'Create ticket' : 'ایجاد تیکت', exact: true })
      .click();
    await page.locator('#ticket-subject').fill('A readable subject');
    await page.locator('#ticket-body').fill('A readable question');
    const submit = page.getByRole('button', {
      name: locale === 'en' ? 'Submit ticket' : 'ثبت تیکت',
      exact: true,
    });
    await expect(submit).toBeEnabled();
    await submit.hover();
    await submit.evaluate(async (element) => {
      await Promise.all(
        element.getAnimations().map((animation) => animation.finished.catch(() => {}))
      );
    });
    expect(
      (
        await new AxeBuilder({ page })
          .include('section.max-w-5xl')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations
    ).toEqual([]);
  });

test('assigned-only staff see no reassignment control and stale lists cannot replace newer filters', async ({
  page,
}) => {
  await shell(page, 'en', true);
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
  await page.locator('#ticket-status-reason').fill('Staff follow-up');
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

for (const staff of [false, true])
  for (const locale of ['en', 'fa'] as const)
    test(`${staff ? 'staff' : 'customer'} formatted reply attachments survive a lost acknowledgement (${locale})`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await shell(page, locale, staff);
      const key = `ticket-reply-attachments/33333333-3333-4333-8333-333333333333/${'c'.repeat(64)}`;
      const prefix = staff ? '/api/staff/tickets' : '/api/tickets',
        copy = (key: string) => t(`tickets.${key}`, locale);
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Support',
            appTitleFa: 'پشتیبانی',
            supportEmail: '',
            supportPhone: '',
            supportMobile: '',
            slogan: '',
            primaryColor: '#2563eb',
            secondaryColor: '#64748b',
            accentColor: '#f59e0b',
            logoUrl: null,
            faviconUrl: null,
            darkMode: locale === 'fa',
            numberStyle: locale === 'fa' ? 'persian' : 'western',
          },
        })
      );
      await page.route(
        (url) => url.pathname === prefix,
        (route) =>
          route.fulfill({
            json: {
              data: [item],
              totalPages: 1,
              viewer: { userId: 'staff', canWrite: true, canAssignOthers: true },
            },
          })
      );
      await page.route(`**${prefix}/${ticketId}`, (route) => route.fulfill({ json: item }));
      await page.route('**/api/staff/tickets/assignees', (route) =>
        route.fulfill({ json: [{ id: 'staff', name: 'Support colleague' }] })
      );
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1EAAAAAASUVORK5CYII=',
        'base64'
      );
      const publicUrl = 'http://127.0.0.1:4173/reply-evidence/public.png',
        privateUrl = 'http://127.0.0.1:4173/reply-evidence/private.png';
      let privateReads = 0,
        presigns = 0,
        puts = 0,
        writes = 0;
      await page.route('**/reply-evidence/**', (route) => {
        if (route.request().url() === privateUrl) privateReads++;
        return route.fulfill({ body: png, contentType: 'image/png' });
      });
      let notes: Record<string, unknown>[] = [
        {
          id: 'private',
          authorId: 'staff',
          body: 'Secret reply evidence',
          visibility: 'internal',
          createdAt: item.updatedAt,
          attachments: [
            { key: 'private', fileName: 'private.png', contentType: 'image/png', url: privateUrl },
          ],
        },
      ];
      let first: Record<string, unknown> | undefined;
      await page.route(`**${prefix}/${ticketId}/comments`, async (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: notes });
        const input = route.request().postDataJSON();
        writes++;
        expect(input).toMatchObject({
          bodyFormat: 'markdown',
          visibility: staff ? 'internal' : 'public',
          attachments: [key],
        });
        expect(input.submissionId).toMatch(/^[a-f0-9-]{36}$/);
        if (!first) {
          first = input;
          notes = [
            ...notes,
            {
              ...input,
              id: '77777777-7777-4777-8777-777777777777',
              ticketId,
              updatedAt: item.updatedAt,
              attachmentCount: 1,
              author: null,
              authorId: staff ? 'staff' : 'customer',
              authorContext: staff ? 'staff' : 'customer',
              createdAt: item.updatedAt,
              attachments: [
                {
                  key,
                  fileIndex: 0,
                  fileName: 'reply.png',
                  contentType: 'image/png',
                  url: publicUrl,
                },
              ],
            },
          ];
          return route.abort('failed');
        }
        expect(input).toEqual(first);
        return route.fulfill({ status: 201, json: notes[1] });
      });
      await page.route('**/api/upload/presigned-url', (route) => {
        presigns++;
        expect(route.request().postDataJSON()).toMatchObject({
          purpose: 'ticket_reply_attachment',
          profileId,
          ticketId,
          fileName: 'reply.png',
        });
        return route.fulfill({
          json: {
            key,
            presignedUrl: 'http://127.0.0.1:4173/reply-upload',
            headers: { 'If-None-Match': '*' },
          },
        });
      });
      await page.route('**/reply-upload', (route) => {
        puts++;
        return route.fulfill({ status: 200 });
      });
      await page.route('**/api/upload/*/verify', (route) =>
        route.fulfill({ json: { status: 'confirmed' } })
      );
      await page.route('**/api/upload/*/record', (route) => {
        expect(route.request().postDataJSON()).toMatchObject({
          purpose: 'ticket_reply_attachment',
          profileId,
          ticketId,
        });
        return route.fulfill({ status: 201, json: { status: 'recorded', key } });
      });
      await page.goto(staff ? '/admin/tickets' : '/tickets');
      await page.getByRole('button', { name: item.subject, exact: true }).click();
      const composer = page.locator('[data-slot=ticket-reply-input]'),
        reply = page.locator('#ticket-reply');
      if (staff) await composer.getByRole('checkbox').check();
      await reply.fill('Reply evidence');
      await reply.evaluate((node) => node.setSelectionRange(0, node.value.length));
      await composer.getByRole('button', { name: copy('bold'), exact: true }).click();
      await expect(reply).toHaveValue('**Reply evidence**');
      await reply.evaluate((node) => node.setSelectionRange(0, node.value.length));
      await composer.getByRole('button', { name: copy('italic'), exact: true }).click();
      await reply.evaluate((node) => node.setSelectionRange(0, node.value.length));
      await composer.getByRole('button', { name: copy('bulletList'), exact: true }).click();
      await composer
        .locator('summary')
        .filter({ hasText: copy('insertLink') })
        .click();
      await page.locator('#ticket-reply-link').fill('javascript:alert(1)');
      await expect(
        composer.getByRole('button', { name: copy('insertLink'), exact: true })
      ).toBeDisabled();
      await page.locator('#ticket-reply-link').fill('https://example.test/help');
      await reply.evaluate((node) =>
        node.setSelectionRange(
          node.value.indexOf('Reply'),
          node.value.indexOf('evidence') + 'evidence'.length
        )
      );
      await composer.getByRole('button', { name: copy('insertLink'), exact: true }).click();
      await composer
        .locator('summary')
        .filter({ hasText: copy('previewReply') })
        .click();
      await expect(composer.locator('strong')).toContainText('Reply evidence');
      await expect(composer.locator('a[href="https://example.test/help"]')).toHaveText(
        'Reply evidence'
      );
      await page.locator('#ticket-reply-files').setInputFiles({
        name: 'bad.exe',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('bad'),
      });
      await expect(
        composer.getByRole('alert').filter({ hasText: copy('invalidReplyFiles') })
      ).toHaveText(copy('invalidReplyFiles'));
      await expect(page.locator('#ticket-reply-files-message')).toBeVisible();
      await page
        .locator('#ticket-reply-files')
        .setInputFiles({ name: 'reply.png', mimeType: 'image/png', buffer: png });
      await expect(composer.getByRole('alert')).toHaveCount(0);
      const dropped = await page.evaluateHandle(() => {
        const data = new DataTransfer();
        data.items.add(new File(['%PDF-1.7\nExtra'], 'dropped.pdf', { type: 'application/pdf' }));
        return data;
      });
      await composer.locator('div.border-dashed').dispatchEvent('drop', { dataTransfer: dropped });
      const retainedReply = await reply.inputValue();
      await composer
        .getByRole('button', {
          name: documentText('moveFileUp', locale).replace('{name}', 'dropped.pdf'),
          exact: true,
        })
        .click();
      const selectedRows = composer.locator('[data-slot=dynamic-field-array] [role=listitem]');
      await expect(selectedRows.first()).toContainText('dropped.pdf');
      await expect(selectedRows.nth(1)).toContainText('reply.png');
      await expect(reply).toHaveValue(retainedReply);
      await expect(
        composer.getByRole('button', {
          name: documentText('moveFileDown', locale).replace('{name}', 'dropped.pdf'),
          exact: true,
        })
      ).toBeFocused();
      if (locale === 'fa') {
        await selectedRows.first().scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `/tmp/barghsa-dynamic-reply-${staff ? 'staff' : 'customer'}-${testInfo.project.name}.png`,
        });
      }
      await composer
        .getByRole('button', { name: `${copy('removeFile')} dropped.pdf`, exact: true })
        .click();
      await composer.getByRole('button', { name: copy('send'), exact: true }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(reply).not.toHaveValue('');
      await expect(
        composer.getByRole('button', { name: `${copy('removeFile')} reply.png`, exact: true })
      ).toBeVisible();
      await page
        .getByRole('button', { name: tTicketForms('retryOriginal', locale), exact: true })
        .click();
      await expect(reply).toHaveValue('');
      await expect(
        composer.getByRole('button', { name: `${copy('removeFile')} reply.png`, exact: true })
      ).toHaveCount(0);
      expect({ presigns, puts, writes }).toEqual({ presigns: 1, puts: 1, writes: 2 });
      const message = page.locator('[data-slot=ticket-comment]').filter({ hasText: 'reply.png' });
      await expect(message.locator('strong')).toContainText('Reply evidence');
      await expect(message.getByRole('link', { name: 'reply.png', exact: true })).toHaveAttribute(
        'href',
        publicUrl
      );
      if (!staff) {
        await expect(page.getByText('Secret reply evidence')).toHaveCount(0);
        expect(privateReads).toBe(0);
      }
      await composer.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      const violations = (
        await new AxeBuilder({ page }).include('[data-slot=ticket-detail]').analyze()
      ).violations;
      expect(violations).toEqual([]);
      if (locale === 'fa')
        await page.locator('[data-slot=ticket-detail]').screenshot({
          path: `/tmp/barghsa-ticket-reply-${staff ? 'staff' : 'customer'}-${testInfo.project.name}.png`,
        });
    });

for (const staff of [false, true])
  for (const locale of ['en', 'fa'] as const)
    test(`${staff ? 'staff' : 'customer'} ticket business links open the correct record (${locale})`, async ({
      page,
    }) => {
      test.setTimeout(60000);
      await shell(page, locale, staff);
      const savingId = '33333333-3333-4333-8333-333333333333';
      const records = [
        {
          type: 'contract',
          destination: 'contract',
          id: profileId,
          href: `${staff ? '/admin/contracts' : '/contracts'}?contractId=${profileId}`,
        },
        {
          type: 'invoice',
          destination: 'invoice',
          id: profileId,
          href: staff ? `/admin/invoices?invoiceId=${profileId}` : `/invoices/${profileId}`,
        },
        {
          type: 'order',
          destination: 'electricity_order',
          id: profileId,
          href: staff
            ? `/admin/electricity-orders?orderId=${profileId}`
            : `/electricity/orders/${profileId}`,
        },
        {
          type: 'order',
          destination: 'saving_order',
          id: savingId,
          href: staff ? `/admin/saving-orders?orderId=${savingId}` : `/savings/orders/${savingId}`,
        },
      ];
      const rows = records.map((record, index) => ({
        ...item,
        id: `${index + 4}4444444-4444-4444-8444-444444444444`,
        subject: `Question ${record.destination}`,
        relatedEntityType: record.type,
        relatedEntityId: profileId,
        relatedRecord: { sourceId: profileId, destination: record.destination, id: record.id },
      }));
      const prefix = staff ? '/api/staff/tickets' : '/api/tickets';
      await page.route(
        (url) => url.pathname === prefix,
        (route) =>
          route.fulfill({
            json: {
              data: rows,
              totalPages: 1,
              viewer: { userId: 'staff', canWrite: true, canAssignOthers: true },
            },
          })
      );
      for (const row of rows) {
        await page.route(`**${prefix}/${row.id}`, (route) => route.fulfill({ json: row }));
        await page.route(`**${prefix}/${row.id}/comments`, (route) => route.fulfill({ json: [] }));
      }
      await page.route('**/api/staff/tickets/assignees', (route) => route.fulfill({ json: [] }));
      await page.route('**/api/profiles', (route) =>
        route.fulfill({
          json: {
            profiles: [{ id: financeContract.profileId, title: 'Buyer', profileType: 'LEGAL' }],
            activeProfileId: financeContract.profileId,
            hasDefault: true,
          },
        })
      );
      const contractBase = staff ? '/api/admin/contracts' : '/api/contracts';
      await page.route(
        (url) => url.pathname === contractBase,
        (route) => route.fulfill({ json: { contracts: [], nextBefore: null } })
      );
      await page.route(`**${contractBase}/${profileId}`, (route) =>
        route.fulfill({
          json: staff
            ? financeContract
            : { ...financeContract, version: financeVersion, canAccept: false },
        })
      );
      await page.route(`**${contractBase}/${profileId}/versions*`, (route) =>
        route.fulfill({ json: { versions: [financeVersion], nextBefore: null } })
      );
      await page.route(`**${contractBase}/${profileId}/activation*`, (route) =>
        route.fulfill({
          json: { checks: [], isCurrent: true, ready: false, evaluatedAt: item.createdAt },
        })
      );
      await page.route(`**${contractBase}/${profileId}/signature?*`, (route) =>
        route.fulfill({
          json: {
            contractId: profileId,
            versionId: financeVersion.id,
            state: 'Active',
            isCurrent: true,
            isAmendment: false,
            canRequest: false,
            canRecord: false,
            request: null,
            signature: null,
          },
        })
      );
      await page.route(`**${contractBase}/${profileId}/cancellation-status`, (route) =>
        route.fulfill({
          json: {
            contractId: profileId,
            state: 'Active',
            cancelledAt: null,
            financialStatus: 'not_cancelled',
            financiallyClosed: false,
            refundAmount: '0',
            returnedAmount: '0',
            refunds: [],
            canCancel: false,
            canChooseRefund: false,
          },
        })
      );
      const invoice = {
        invoiceId: profileId,
        profileId: financeContract.profileId,
        orderId: null,
        type: 'manual',
        role: 'original',
        state: 'Paid',
        totalAmount: '100',
        paidAmount: '100',
        refundedAmount: '0',
        accountingAmount: '100',
        adjustmentKind: null,
        issuedAt: item.createdAt,
        payableFrom: item.createdAt,
        dueAt: null,
        createdAt: item.createdAt,
        cancelledAt: null,
        replacesInvoiceId: null,
        adjustmentForInvoiceId: null,
        explanation: null,
        lines: [],
      };
      let invoiceReads = 0;
      await page.route('**/api/admin/invoices/ledger?*', (route) => {
        expect(new URL(route.request().url()).searchParams.get('invoiceId')).toBe(profileId);
        invoiceReads++;
        return route.fulfill({ json: { items: [invoice], nextCursor: null } });
      });
      await page.route(`**/api/admin/invoices/ledger/${profileId}`, (route) =>
        route.fulfill({
          json: { ...invoice, activity: { payments: [], bankReceipts: [], refunds: [] } },
        })
      );
      await page.route(`**/api/invoices/${profileId}`, (route) => {
        invoiceReads++;
        return route.fulfill({
          json: {
            viewedInvoiceId: profileId,
            originalInvoiceId: profileId,
            invoice,
            chain: [invoice],
            payments: [],
            bankReceipts: [],
            refunds: [],
          },
        });
      });
      const electricity = {
        orderId: profileId,
        profileId: financeContract.profileId,
        customerName: 'Buyer',
        commercialStatus: 'CONFIRMED',
        electricityStatus: 'approved',
        financialStatus: 'unpaid',
        nextAction: 'await_payment',
        periodStart: item.createdAt,
        periodEnd: '2027-08-31T00:00:00Z',
        totalKwh: '10',
        fullAddress: 'Resolved electricity address',
        postalCode: '1234567890',
        contractId: profileId,
        invoiceId: profileId,
        versionId: financeVersion.id,
        contractState: null,
        invoiceState: null,
        totalIrR: '100',
        paidIrR: '0',
        refundedIrR: '0',
        lines: [],
        timeline: [],
        pricingSnapshot: { lines: [] },
        settingsSnapshot: {},
        contractSnapshot: {},
        submittedAt: item.createdAt,
      };
      const electricityBase = staff ? '/api/staff/electricity/orders' : '/api/electricity/orders';
      await page.route(
        (url) => url.pathname === electricityBase,
        (route) => route.fulfill({ json: { orders: [], nextAfter: null } })
      );
      await page.route(`**${electricityBase}/${profileId}`, (route) =>
        route.fulfill({
          json: { ...electricity, commercialStatus: staff ? 'approved' : 'CONFIRMED' },
        })
      );
      const saving = {
        id: savingId,
        orderId: profileId,
        profileId: financeContract.profileId,
        customerName: 'Buyer',
        status: 'awaiting_staff_review',
        financialStatus: 'unpaid',
        submittedAt: item.createdAt,
        billIdentifier: '1234567890123',
        addressSnapshot: { full_address: 'Resolved saving address', postal_code: '1234567890' },
        hardwareTitle: { en: 'Resolved hardware', fa: 'دستگاه مرتبط' },
        pricingSnapshot: {
          plan: { title: { en: 'Resolved saving plan', fa: 'طرح مرتبط' } },
          hardware: { title: { en: 'Resolved hardware', fa: 'دستگاه مرتبط' } },
          subtotalIrR: '100',
          discountIrR: '0',
          vatIrR: '0',
          totalIrR: '100',
        },
        totalIrR: '100',
        paidIrR: '0',
        stages: [],
        events: [],
        revisions: [],
        addressAmendments: [],
        hardwareAmendments: [],
        hardwareUpgrades: [],
        addressOptions: [],
        hardwareOptions: [],
        canAmendAddress: false,
        canAmendHardware: false,
      };
      const savingBase = staff ? '/api/staff/saving/orders' : '/api/saving/orders';
      await page.route(
        (url) => url.pathname === savingBase,
        (route) => route.fulfill({ json: { orders: [], nextAfter: null, nextBefore: null } })
      );
      await page.route(`**${savingBase}/${savingId}`, (route) =>
        route.fulfill({
          json: staff
            ? saving
            : {
                ...saving,
                order_id: profileId,
                profile_id: financeContract.profileId,
                current_hardware_title: saving.hardwareTitle,
                financial_status: 'unpaid',
                bill_identifier: '1234567890123',
                submitted_at: item.createdAt,
                address_snapshot: saving.addressSnapshot,
                pricing_snapshot: saving.pricingSnapshot,
                agreement_snapshot: 'Accepted saving terms',
                verification_result: { status: 'verified' },
                can_edit: false,
              },
        })
      );
      const path = staff ? '/admin/tickets' : '/tickets';
      const queue = page.locator('[data-slot=ticket-queue-records]');
      const table = page.getByRole('button', { name: t('historyView.table', locale), exact: true });
      await page.goto(path);
      await table.click();
      for (const record of records)
        await expect(queue.locator(`a[href="${record.href}"]`)).toBeVisible();
      await queue.getByRole('button', { name: rows[0]!.subject, exact: true }).click();
      const detail = page.locator('[data-slot=ticket-detail]');
      await expect(detail.locator('a')).toHaveAttribute('href', records[0]!.href);
      await detail.locator('a').focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`contractId=${profileId}`));
      await expect(page.getByText('Published electricity terms', { exact: true })).toBeVisible();
      for (const record of records.slice(1)) {
        await page.goto(path);
        await expect(queue.locator(`a[href="${record.href}"]`)).toBeVisible();
        await queue.locator(`a[href="${record.href}"]`).click();
        await expect(page).toHaveURL(new RegExp(record.href.replace('?', '\\?') + '$'));
        if (record.destination === 'invoice') {
          await expect.poll(() => invoiceReads).toBeGreaterThan(0);
          if (staff)
            await expect(
              page.locator('section[aria-labelledby=invoice-ledger-title]')
            ).toContainText(profileId);
          else await expect(page.getByTestId(`invoice-card-${profileId}`)).toBeVisible();
        } else if (record.destination === 'electricity_order')
          await expect(
            page.getByText('Resolved electricity address', { exact: false })
          ).toBeVisible();
        else
          await expect(page.getByText('Resolved saving address', { exact: false })).toBeVisible();
      }
    });
