import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { t } from '@barghsa/i18n/app';
import { t as identityText } from '@barghsa/i18n/conversation-identity';
import { shellText } from '@barghsa/i18n/shell';
const ticketId = '22222222-2222-4222-8222-222222222222';
const uploadKey = 'uploads/image/33333333-3333-4333-8333-333333333333.png';
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1cAAAAASUVORK5CYII=',
  'base64'
);
async function shell(page: Page, locale: 'en' | 'fa', staff: boolean) {
  await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: staff ? 'staff' : 'customer',
        username: 'private-login@example.test',
        isStaff: staff,
        operatingContext: staff ? 'staff' : 'customer',
        canSwitchContext: false,
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({ json: { profiles: [], activeProfileId: null } })
  );
  await page.route('**/api/staff/tickets/teams', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/staff/tickets/assignees', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/notifications**', (route) =>
    route.fulfill({ json: { data: [], unread_count: 0 } })
  );
  await page.route('**/api/user/settings/theme', (route) =>
    route.fulfill({ json: { mode: locale === 'fa' ? 'dark' : 'light' } })
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
}
for (const staff of [false, true])
  for (const locale of ['en', 'fa'] as const) {
    test(`conversation identity saves verified photos, survives retry and removes shared details (${staff ? 'staff' : 'customer'}, ${locale})`, async ({
      page,
    }) => {
      await shell(page, locale, staff);
      const copy = (key: string) => identityText(`conversationIdentity.${key}`, locale);
      let identity = {
        displayName: null as string | null,
        avatarUrl: null as string | null,
        avatarUploadKey: null as string | null,
        revision: 0,
        shareInActivity: false,
        shareInPaymentActivity: false,
      };
      let writes = 0,
        uploads = 0;
      await page.route('**/api/user/settings/conversation-identity', async (route) => {
        if (route.request().method() === 'PUT') {
          const body = route.request().postDataJSON();
          writes++;
          expect(route.request().headers()['x-csrf-token']).toBe('identity-csrf');
          if (writes === 1) return route.fulfill({ status: 503, json: {} });
          expect(body.revision).toBe(identity.revision);
          identity = {
            displayName: body.displayName,
            shareInActivity: body.shareInActivity,
            shareInPaymentActivity: body.shareInPaymentActivity,
            avatarUploadKey:
              body.avatarUploadKey === undefined ? identity.avatarUploadKey : body.avatarUploadKey,
            avatarUrl:
              body.avatarUploadKey === null
                ? null
                : body.avatarUploadKey
                  ? '/test-conversation-avatar'
                  : identity.avatarUrl,
            revision: identity.revision + 1,
          };
        }
        return route.fulfill({ json: identity });
      });
      await page.route('**/api/upload/presigned-url', (route) => {
        uploads++;
        expect(route.request().postDataJSON()).toMatchObject({
          purpose: 'conversation_avatar',
          category: 'image',
        });
        return route.fulfill({ json: { key: uploadKey, presignedUrl: '/test-photo-upload' } });
      });
      await page.route('**/test-photo-upload', (route) => {
        expect(route.request().method()).toBe('PUT');
        expect(route.request().headers()['if-none-match']).toBe('*');
        return route.fulfill({ status: 200, body: '' });
      });
      await page.route('**/api/upload/*/verify', (route) =>
        route.fulfill({ json: { status: 'confirmed' } })
      );
      await page.route('**/api/upload/*/record', (route) => {
        expect(route.request().postDataJSON()).toMatchObject({
          purpose: 'conversation_avatar',
          category: 'image',
        });
        return route.fulfill({ json: { status: 'recorded' } });
      });
      await page.route('**/test-conversation-avatar', (route) =>
        route.fulfill({ contentType: 'image/png', body: image })
      );
      const prefix = staff ? '/api/staff/tickets' : '/api/tickets';
      const row = {
        id: ticketId,
        userId: 'customer',
        subject: 'Identity conversation',
        body: 'Question',
        status: 'open',
        category: 'general',
        priority: 'normal',
        profileId: null,
        assignedTeamId: null,
        assignedTo: null,
        attachments: [],
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
        relatedEntityType: null,
        relatedEntityId: null,
      };
      await page.route(
        (url) => url.pathname === prefix,
        (route) =>
          route.fulfill({
            json: {
              data: [row],
              totalPages: 1,
              viewer: { userId: 'staff', canWrite: true, canAssignOthers: true },
            },
          })
      );
      await page.route(`**${prefix}/${ticketId}`, (route) => route.fulfill({ json: row }));
      await page.route(`**${prefix}/${ticketId}/comments`, (route) =>
        route.fulfill({
          json: [
            {
              id: 'visible',
              authorId: staff ? 'staff' : 'customer',
              authorContext: staff ? 'staff' : 'customer',
              body: 'Shared answer',
              visibility: 'public',
              createdAt: row.createdAt,
              author: {
                displayName: identity.displayName,
                avatarUrl: identity.avatarUrl ? new URL(identity.avatarUrl, page.url()).href : null,
              },
            },
            {
              id: 'private',
              authorId: 'other',
              authorContext: 'staff',
              body: 'Internal only',
              visibility: 'internal',
              createdAt: row.createdAt,
              author: {
                displayName: 'Private colleague',
                avatarUrl: 'https://private.example.test/avatar',
              },
            },
          ],
        })
      );
      let privatePhotos = 0;
      await page.route('https://private.example.test/**', (route) => {
        privatePhotos++;
        return route.fulfill({ status: 404 });
      });
      await page.goto(staff ? '/admin/tickets' : '/tickets');
      await page.evaluate(() => {
        document.cookie = 'barghsa_csrf=identity-csrf; path=/';
      });
      const openEditor = async () => {
        await page
          .getByRole('button', { name: shellText('accountMenu', locale), exact: true })
          .click();
        await page.getByRole('button', { name: copy('title'), exact: true }).click();
        return page.getByRole('dialog', { name: copy('title') });
      };
      const editor = await openEditor();
      await expect(editor.getByLabel(copy('name'), { exact: true })).toHaveValue('');
      await expect(editor).toContainText(copy('description'));
      await expect(
        editor.getByRole('checkbox', { name: copy('activity'), exact: true })
      ).not.toBeChecked();
      await expect(editor).toContainText(copy('activityHelp'));
      await expect(
        editor.getByRole('checkbox', { name: copy('paymentActivity'), exact: true })
      ).not.toBeChecked();
      await expect(editor).toContainText(copy('paymentActivityHelp'));
      await editor
        .getByLabel(copy('name'), { exact: true })
        .fill(locale === 'fa' ? 'آرش پشتیبانی' : 'Chosen support name');
      await editor.getByRole('checkbox', { name: copy('activity'), exact: true }).check();
      await expect(
        editor.getByRole('checkbox', { name: copy('paymentActivity'), exact: true })
      ).not.toBeChecked();
      await editor.getByRole('checkbox', { name: copy('paymentActivity'), exact: true }).check();
      const picker = page.waitForEvent('filechooser');
      await editor.getByRole('button', { name: copy('choosePhoto'), exact: true }).focus();
      await page.keyboard.press('Enter');
      await (await picker).setFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: image });
      await editor.getByRole('button', { name: copy('saveAction'), exact: true }).click();
      await expect(editor.getByRole('alert')).toHaveText(copy('save'));
      await expect(editor).toContainText('portrait.png');
      await expect(
        editor.getByRole('checkbox', { name: copy('activity'), exact: true })
      ).toBeChecked();
      await expect(
        editor.getByRole('checkbox', { name: copy('paymentActivity'), exact: true })
      ).toBeChecked();
      await editor.getByRole('button', { name: copy('saveAction'), exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect(uploads).toBe(1);
      await page
        .locator('[data-slot=ticket-queue-records]')
        .getByRole('button', { name: row.subject, exact: true })
        .click();
      const thread = page.locator('[data-slot=ticket-comment]');
      await expect(thread.first()).toContainText(identity.displayName!);
      await expect(thread.first().locator('img')).toHaveAttribute(
        'src',
        /test-conversation-avatar/
      );
      await expect(thread.first()).toContainText(
        t(staff ? 'tickets.staffAuthor' : 'tickets.customerAuthor', locale)
      );
      if (!staff) {
        await expect(thread).toHaveCount(1);
        expect(privatePhotos).toBe(0);
        await expect(page.locator('[data-slot=ticket-detail]')).not.toContainText(
          'private-login@example.test'
        );
      }
      const again = await openEditor();
      await expect(again.getByLabel(copy('name'), { exact: true })).toHaveValue(
        identity.displayName!
      );
      await expect(
        again.getByRole('checkbox', { name: copy('activity'), exact: true })
      ).toBeChecked();
      await expect(
        again.getByRole('checkbox', { name: copy('paymentActivity'), exact: true })
      ).toBeChecked();
      await again.getByLabel(copy('name'), { exact: true }).fill('');
      await expect(
        again.getByRole('checkbox', { name: copy('paymentActivity'), exact: true })
      ).not.toBeChecked();
      await expect(
        again.getByRole('checkbox', { name: copy('activity'), exact: true })
      ).not.toBeChecked();
      await again.getByRole('button', { name: copy('remove'), exact: true }).click();
      await again.getByRole('button', { name: copy('saveAction'), exact: true }).click();
      await expect(again).toHaveCount(0);
      expect(identity).toEqual({
        displayName: null,
        avatarUrl: null,
        avatarUploadKey: null,
        revision: 2,
        shareInActivity: false,
        shareInPaymentActivity: false,
      });
      await page.reload();
      await page
        .locator('[data-slot=ticket-queue-records]')
        .getByRole('button', { name: row.subject, exact: true })
        .click();
      await expect(page.locator('[data-slot=ticket-comment]').first()).toContainText(
        t(staff ? 'tickets.staffAuthor' : 'tickets.customerAuthor', locale)
      );
      await expect(page.locator('[data-slot=ticket-comment]').first().locator('img')).toHaveCount(
        0
      );
    });
    test(`conversation identity recovers read/conflict failures with an accessible preserved draft (${staff ? 'staff' : 'customer'}, ${locale})`, async ({
      page,
    }, testInfo) => {
      await shell(page, locale, staff);
      let reads = 0,
        writes = 0;
      const copy = (key: string) => identityText(`conversationIdentity.${key}`, locale);
      await page.route('**/api/user/settings/conversation-identity', (route) => {
        if (route.request().method() === 'PUT') {
          writes++;
          const body = route.request().postDataJSON();
          if (writes === 1) {
            expect(body.revision).toBe(1);
            return route.fulfill({ status: 409, json: {} });
          }
          expect(body).toEqual({
            displayName: 'My draft',
            revision: 2,
            shareInActivity: true,
            shareInPaymentActivity: true,
          });
          return route.fulfill({
            json: { displayName: 'My draft', avatarUrl: null, avatarUploadKey: null, revision: 3 },
          });
        }
        reads++;
        return reads === 1
          ? route.fulfill({ status: 503, json: {} })
          : route.fulfill({
              json: {
                displayName: reads === 2 ? 'Old alias' : 'Other edit',
                avatarUrl: null,
                avatarUploadKey: null,
                revision: reads === 2 ? 1 : 2,
              },
            });
      });
      await page.goto(staff ? '/admin/tickets' : '/tickets');
      await page
        .getByRole('button', { name: shellText('accountMenu', locale), exact: true })
        .click();
      await page.getByRole('button', { name: copy('title'), exact: true }).click();
      const editor = page.getByRole('dialog', { name: copy('title') });
      await expect(editor.getByRole('alert')).toHaveText(copy('load'));
      await editor.getByRole('button', { name: copy('retry'), exact: true }).click();
      await expect(editor.getByLabel(copy('name'), { exact: true })).toHaveValue('Old alias');
      await editor.getByLabel(copy('name'), { exact: true }).fill('My draft');
      await editor.getByRole('checkbox', { name: copy('activity'), exact: true }).check();
      await expect(
        editor.getByRole('checkbox', { name: copy('paymentActivity'), exact: true })
      ).not.toBeChecked();
      await editor.getByRole('checkbox', { name: copy('paymentActivity'), exact: true }).check();
      await editor.getByLabel(copy('photo'), { exact: true }).setInputFiles({
        name: 'unsafe.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from('<svg/>'),
      });
      await expect(editor.getByRole('alert')).toHaveText(copy('photoError'));
      await editor.getByRole('button', { name: copy('saveAction'), exact: true }).click();
      await expect(editor.getByRole('alert')).toHaveText(copy('conflict'));
      await expect(
        editor.getByRole('checkbox', { name: copy('activity'), exact: true })
      ).toBeChecked();
      await expect(
        editor.getByRole('checkbox', { name: copy('paymentActivity'), exact: true })
      ).toBeChecked();
      await expect(editor.getByLabel(copy('name'), { exact: true })).toHaveValue('My draft');
      const violations = (
        await new AxeBuilder({ page }).include('[data-slot=dialog-content]').analyze()
      ).violations;
      expect(violations).toEqual([]);
      if (locale === 'fa' && staff && testInfo.project.name === 'chromium') {
        await page.screenshot({ path: '/tmp/barghsa-conversation-fa-mobile.png' });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.screenshot({ path: '/tmp/barghsa-conversation-fa-desktop.png' });
      }
      expect(await editor.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true
      );
      await editor.getByRole('button', { name: copy('saveAction'), exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect(writes).toBe(2);
    });
  }
