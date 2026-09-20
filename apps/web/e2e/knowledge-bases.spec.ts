import AxeBuilder from '@axe-core/playwright';
import { mockOppositeNumerals } from './number-preference-fixture';
import { test, expect } from './coverage-fixture';
for (const locale of ['en', 'fa'])
  test(`Knowledge-base form retries captured input after password verification (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        if (document.documentElement) document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    let failed = true,
      verified = false,
      denied = false;
    const attempts: unknown[] = [];
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await mockOppositeNumerals(page, locale);
    await page.route('**/api/admin/knowledge-bases', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill(
          denied ? { status: 403, json: {} } : failed ? { status: 503, json: {} } : { json: [] }
        );
      attempts.push(route.request().postDataJSON());
      if (!verified)
        return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
      denied = true;
      return route.fulfill({ status: 201, json: {} });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = route.request().postDataJSON().password === 'correct';
      return route.fulfill({ status: verified ? 200 : 401, json: {} });
    });
    await page.goto('/admin/knowledge-bases');
    await expect(page.getByRole('alert')).toBeVisible();
    failed = false;
    await page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true }).click();
    await page
      .getByRole('button', { name: fa ? 'افزودن پایگاه دانش' : 'Add knowledge base', exact: true })
      .click();
    await page.getByLabel(fa ? 'عنوان' : 'Title', { exact: true }).fill('Local draft');
    await page.getByRole('button', { name: fa ? 'ذخیره' : 'Save', exact: true }).click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    await confirm.click();
    await dialog.locator('input[type="password"]').fill('wrong');
    await confirm.click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.locator('input[type="password"]').fill('correct');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(attempts).toEqual(
      Array(2).fill({
        title: 'Local draft',
        description: '',
      })
    );
    await expect(page.getByRole('alert')).toContainText(
      fa ? 'اجازه مدیریت' : 'permission to manage'
    );
    await expect(page.locator('input')).toHaveCount(0);
  });
for (const locale of ['en', 'fa'])
  test(`knowledge-base groups and document status (${locale})`, async ({ page }) => {
    const fa = locale === 'fa';
    await page.addInitScript((value) => {
      if (document.documentElement) document.documentElement.lang = value;
      new MutationObserver(() => {
        document.documentElement.lang = value;
      }).observe(document, { childList: true });
    }, locale);
    const kb = {
      id: '01900000-0000-7000-8000-000000000001',
      title: 'Operations',
      description: 'Meter reading guidance',
      documentCount: 1,
    };
    const group = {
      id: '01900000-0000-7000-8000-000000000002',
      title: 'Staff knowledge',
      description: 'Support team',
      memberCount: 0,
    };
    let linked = false;
    let attached = true;
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await mockOppositeNumerals(page, locale);
    await page.route('**/api/admin/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/members') && route.request().method() === 'POST') {
        expect(route.request().postDataJSON()).toEqual({ kbId: kb.id });
        linked = true;
        return route.fulfill({ status: 204 });
      }
      if (path.includes('/members/') && route.request().method() === 'DELETE') {
        linked = false;
        return route.fulfill({ status: 204 });
      }
      if (path.endsWith('/documents/available'))
        return route.fulfill({
          json: [{ storageKey: 'uploads/document/guide.pdf', fileName: 'Guide.pdf' }],
        });
      if (path.endsWith('/documents') && route.request().method() === 'POST') {
        expect(route.request().postDataJSON()).toEqual({
          storageKey: 'uploads/document/guide.pdf',
        });
        attached = true;
        return route.fulfill({ json: {} });
      }
      if (path.endsWith('/documents/doc') && route.request().method() === 'DELETE') {
        attached = false;
        return route.fulfill({ status: 204 });
      }
      if (path.endsWith('/knowledge-bases')) return route.fulfill({ json: [kb] });
      if (path.endsWith('/kb-groups'))
        return route.fulfill({ json: [{ ...group, memberCount: linked ? 1 : 0 }] });
      if (path.endsWith(kb.id))
        return route.fulfill({
          json: {
            ...kb,
            documents: attached
              ? [
                  {
                    id: 'doc',
                    storageKey: 'uploads/document/guide.pdf',
                    fileName: 'Guide.pdf',
                    processingStatus: 'pending',
                  },
                ]
              : [],
            groups: [],
          },
        });
      if (path.endsWith(group.id))
        return route.fulfill({ json: { ...group, members: linked ? [kb] : [] } });
      return route.fulfill({ status: 404, json: {} });
    });
    await page.goto('/admin/knowledge-bases');
    await expect(page.locator('main')).toContainText(fa ? '1' : '۱');
    await page
      .getByRole('button', { name: `${fa ? 'باز کردن' : 'Open'} Operations`, exact: true })
      .click();
    await expect(page.getByText('Guide.pdf', { exact: true })).toBeVisible();
    await expect(
      page.getByText(fa ? 'در انتظار پردازش' : 'Awaiting processing', { exact: true })
    ).toBeVisible();
    await page
      .getByRole('button', {
        name: `${fa ? 'حذف پیوند سند' : 'Detach document'} Guide.pdf`,
        exact: true,
      })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page
      .getByLabel(fa ? 'انتخاب سند' : 'Choose a document', { exact: true })
      .selectOption('uploads/document/guide.pdf');
    await page
      .getByRole('button', { name: fa ? 'پیوست سند' : 'Attach document', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText('Guide.pdf', { exact: true })).toBeVisible();
    await page
      .getByRole('button', {
        name: fa ? 'گروه‌های پایگاه دانش' : 'Knowledge-base groups',
        exact: true,
      })
      .click();
    await page
      .getByRole('button', { name: `${fa ? 'باز کردن' : 'Open'} Staff knowledge`, exact: true })
      .click();
    await page
      .getByLabel(fa ? 'انتخاب پایگاه دانش' : 'Choose a knowledge base', { exact: true })
      .selectOption(kb.id);
    await page
      .getByRole('button', { name: fa ? 'افزودن به گروه' : 'Add to group', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const remove = page.getByRole('button', {
      name: `${fa ? 'حذف از گروه' : 'Remove from group'} Operations`,
      exact: true,
    });
    await expect(remove).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await page.screenshot({ path: `/tmp/kb-groups-${locale}.png`, fullPage: true });
    await remove.click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(remove).toHaveCount(0);
  });

for (const locale of ['en', 'fa']) {
  for (const failure of ['verify', 'record']) {
    test(`KB upload verifies bytes, preserves recovery and requires attachment step-up (${locale}, ${failure})`, async ({
      page,
      baseURL,
    }) => {
      const fa = locale === 'fa',
        key = 'uploads/document/new-guide.pdf';
      await page.addInitScript((value) => {
        new MutationObserver(() => (document.documentElement.lang = value)).observe(document, {
          childList: true,
        });
        if (document.documentElement) document.documentElement.lang = value;
      }, locale);
      await page
        .context()
        .addCookies([{ name: 'barghsa_csrf', value: 'kb-fixture', url: baseURL! }]);
      const kb = {
        id: '01900000-0000-7000-8000-000000000001',
        title: 'Operations',
        description: '',
        documentCount: 0,
      };
      let broken = true,
        attached = false,
        verified = false,
        puts = 0,
        attachments = 0;
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await mockOppositeNumerals(page, locale);
      await page.route('**/api/admin/knowledge-bases', (route) => route.fulfill({ json: [kb] }));
      await page.route(`**/api/admin/knowledge-bases/${kb.id}`, (route) =>
        route.fulfill({
          json: {
            ...kb,
            groups: [],
            documents: attached
              ? [
                  {
                    id: 'doc',
                    storageKey: key,
                    fileName: 'new-guide.pdf',
                    processingStatus: 'pending',
                  },
                ]
              : [],
          },
        })
      );
      await page.route('**/api/admin/knowledge-bases/documents/available**', (route) =>
        route.fulfill({ json: [] })
      );
      await page.route(`**/api/admin/knowledge-bases/${kb.id}/documents`, (route) => {
        expect(route.request().postDataJSON()).toEqual({ storageKey: key });
        attachments++;
        if (!verified)
          return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
        attached = true;
        return route.fulfill({ status: 201, json: { id: 'doc', storageKey: key } });
      });
      await page.route('**/api/auth/step-up', (route) => {
        verified = route.request().postDataJSON().password === 'correct';
        return route.fulfill({ status: verified ? 200 : 401, json: {} });
      });
      await page.route('**/api/upload/**', (route) => {
        expect(route.request().headers()['x-csrf-token']).toBe('kb-fixture');
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/presigned-url')) {
          expect(route.request().postDataJSON()).toMatchObject({
            fileName: 'new-guide.pdf',
            contentType: 'application/pdf',
            category: 'document',
            metadata: { recordType: 'document' },
          });
          return route.fulfill({
            json: { key, presignedUrl: 'https://storage.example.test/kb-document' },
          });
        }
        if (path.endsWith('/verify'))
          return route.fulfill({
            json: {
              key,
              status: broken && failure === 'verify' ? 'type_mismatch' : 'confirmed',
              exists: true,
            },
          });
        expect(path.endsWith('/record')).toBe(true);
        expect(route.request().postDataJSON()).toMatchObject({ purpose: 'knowledge_base' });
        expect(route.request().postDataJSON()).not.toHaveProperty('profileId');
        return route.fulfill({
          json: { key: broken && failure === 'record' ? 'wrong-key' : key, status: 'recorded' },
        });
      });
      await page.route('https://storage.example.test/kb-document', (route) => {
        puts++;
        expect(route.request().method()).toBe('PUT');
        expect(route.request().headers()['x-csrf-token']).toBeUndefined();
        return route.fulfill({ status: 200 });
      });
      await page.goto('/admin/knowledge-bases');
      await page
        .getByRole('button', { name: `${fa ? 'باز کردن' : 'Open'} Operations`, exact: true })
        .click();
      await page.getByLabel(fa ? 'سند جدید' : 'New document', { exact: true }).setInputFiles({
        name: 'new-guide.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-test'),
      });
      await page
        .getByRole('button', { name: fa ? 'بارگذاری سند' : 'Upload document', exact: true })
        .click();
      await expect(page.getByRole('alert')).toContainText(
        fa ? 'بارگذاری یا تأیید' : 'Upload or save'
      );
      expect(attachments).toBe(0);
      await expect(
        page.getByLabel(fa ? 'سند جدید' : 'New document', { exact: true })
      ).not.toBeEmpty();
      broken = false;
      await page
        .getByRole('button', { name: fa ? 'بارگذاری سند' : 'Upload document', exact: true })
        .click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: fa ? 'انصراف' : 'Cancel', exact: true }).click();
      await page
        .getByRole('button', {
          name: fa ? 'پیوست سند بارگذاری‌شده' : 'Attach uploaded document',
          exact: true,
        })
        .click();
      expect(puts).toBe(2);
      const confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
      await confirm.click();
      await dialog.locator('input[type="password"]').fill('correct');
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText('new-guide.pdf', { exact: true })).toBeVisible();
      expect(attachments).toBe(2);
      expect(puts).toBe(2);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    });
  }
}
