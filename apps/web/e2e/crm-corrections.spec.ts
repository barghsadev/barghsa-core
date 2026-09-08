import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
const profileId = '11111111-1111-4111-8111-111111111111',
  caseId = '22222222-2222-4222-8222-222222222222';
const key = 'uploads/document/33333333-3333-4333-8333-333333333333.pdf';
const item = {
  id: caseId,
  profileId,
  fieldName: 'first_name',
  requestedValue: 'Corrected',
  reason: 'Document checked',
  status: 'Under Review',
  createdBy: 'creator',
};
async function shell(page: Page, locale = 'en') {
  await page.addInitScript((value) => {
    if (document.documentElement) document.documentElement.lang = value;
    new MutationObserver(() => {
      if (document.documentElement) document.documentElement.lang = value;
    }).observe(document, { childList: true });
  }, locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route(`**/api/crm/profiles/${profileId}`, (route) =>
    route.fulfill({
      json: {
        profile: { id: profileId, profileType: 'INDIVIDUAL', archived: false },
        viewerPermissions: { canEditIdentity: true },
      },
    })
  );
}
for (const [locale, darkMode] of [
  ['en', false],
  ['fa', false],
  ['en', true],
  ['fa', true],
] as const)
  test(`correction-only staff retain evidence and target through password confirmation (${locale}, dark=${darkMode})`, async ({
    page,
  }, testInfo) => {
    await shell(page, locale);
    await page.route('**/api/public/branding/config', (route) =>
      route.fulfill({
        json: {
          appTitle: 'Correction review',
          slogan: '',
          primaryColor: '#2563eb',
          secondaryColor: '#64748b',
          accentColor: '#f59e0b',
          logoUrl: null,
          faviconUrl: null,
          darkMode,
        },
      })
    );
    let verified = false,
      uploads = 0,
      acknowledgements = 0;
    const bodies: unknown[] = [];
    await page.route('**/api/crm/verification-cases?*', (route) =>
      route.fulfill({ status: 403, json: { error: 'AUTHZ:FORBIDDEN' } })
    );
    await page.route('**/api/upload/presigned-url', (route) =>
      route.fulfill({ json: { key, presignedUrl: '/test-evidence-upload' } })
    );
    await page.route('**/test-evidence-upload', (route) => {
      uploads++;
      return route.fulfill({ status: 200, body: '' });
    });
    await page.route('**/api/upload/*/verify', (route) =>
      route.fulfill({ json: { status: 'confirmed' } })
    );
    await page.route('**/api/upload/*/record', (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        profileId,
        purpose: 'verification_evidence',
      });
      return route.fulfill({ json: { status: 'recorded' } });
    });
    await page.route(`**/api/crm/profiles/${profileId}/verification-cases`, (route) => {
      bodies.push(route.request().postDataJSON());
      if (!verified) return route.fulfill({ status: 403, json: { requiresStepUp: true } });
      if (acknowledgements++ === 0)
        return route.fulfill({
          status: 201,
          json: { success: true, id: caseId, status: 'Open', profileId: caseId },
        });
      return route.fulfill({
        status: 201,
        json: { success: true, id: caseId, status: 'Open', profileId },
      });
    });
    await page.route('**/api/auth/step-up', (route) => {
      verified = true;
      return route.fulfill({ json: { verified: true } });
    });
    await page.goto(`/admin/crm/corrections?profileId=${profileId}`);
    await expect(page.locator('#correction-field')).toBeVisible();
    await expect
      .poll(() => page.locator('html').evaluate((node) => node.classList.contains('dark')))
      .toBe(darkMode);
    const accessibility = await new AxeBuilder({ page })
      .include('section:has(#correction-field)')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    expect(accessibility.incomplete.filter((item) => item.id === 'color-contrast')).toEqual([]);
    await page.locator('#correction-field').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#correction-value')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#correction-reason')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#correction-files')).toBeFocused();
    await page.locator('#correction-value').fill('Corrected');
    await page.locator('#correction-reason').fill('Document checked');
    await page.locator('#correction-files').setInputFiles({
      name: 'evidence.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\nEvidence'),
    });
    await page.locator('section:has(#correction-field)').screenshot({
      path:
        '/tmp/barghsa-crm-correction-' +
        locale +
        '-' +
        (darkMode ? 'dark' : 'light') +
        '-' +
        testInfo.project.name +
        '.png',
    });
    await page
      .getByRole('button', {
        name:
          locale === 'fa' ? 'بارگذاری مدارک و بررسی درخواست' : 'Upload evidence and review request',
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(profileId);
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await dialog
      .getByLabel(locale === 'fa' ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
      .fill('Test-password-123!');
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.evaluate(async (node) => {
      await Promise.all(
        node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))
      );
    });
    const confirmationAccessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(confirmationAccessibility.violations).toEqual([]);
    // Axe can see different obscured page elements behind this transparent,
    // wrapped description even though its dialog is opaque. Resolve only that
    // reported node with rendered colors and hit-testing each visible text line.
    for (const item of confirmationAccessibility.incomplete.filter(
      (item) => item.id === 'color-contrast'
    )) {
      expect(item.nodes).toHaveLength(1);
      expect(item.nodes[0]!.html).toContain('data-slot="dialog-description"');
      const measured = await dialog.locator('[data-slot="dialog-description"]').evaluate((node) => {
        const popup = node.closest('[role="dialog"]')!;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        const color = (value: string) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = value;
          ctx.fillRect(0, 0, 1, 1);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data);
        };
        const fg = color(getComputedStyle(node).color),
          bg = color(getComputedStyle(popup).backgroundColor);
        const luminance = (rgb: number[]) =>
          rgb.slice(0, 3).reduce((sum, value, index) => {
            const s = value / 255;
            return (
              sum +
              [0.2126, 0.7152, 0.0722][index]! *
                (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4)
            );
          }, 0);
        const f = luminance(fg),
          b = luminance(bg);
        const range = document.createRange();
        range.selectNodeContents(node);
        const unobscured = Array.from(range.getClientRects()).every((rect) =>
          node.contains(
            document.elementFromPoint(
              rect.x + Math.min(10, rect.width / 2),
              rect.y + rect.height / 2
            )
          )
        );
        let opaque = true;
        for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement)
          if (getComputedStyle(ancestor).opacity !== '1') opaque = false;
        return {
          ratio: (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05),
          fg,
          bg,
          unobscured,
          opaque,
        };
      });
      expect(measured.fg[3]).toBe(255);
      expect(measured.bg[3]).toBe(255);
      expect(measured.opaque).toBe(true);
      expect(measured.unobscured).toBe(true);
      expect(measured.ratio).toBeGreaterThanOrEqual(4.5);
      await testInfo.attach('resolved-description-contrast', {
        contentType: 'application/json',
        body: JSON.stringify(measured),
      });
    }
    await expect(page.locator('#correction-value')).toHaveValue('Corrected');
    await expect(page.locator('#correction-reason')).toHaveValue('Document checked');
    await dialog
      .getByLabel(locale === 'fa' ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password')
      .fill('Test-password-123!');
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(uploads).toBe(1);
    await expect(page.locator('#correction-value')).toHaveValue('');
    await expect(page.locator('#correction-field')).toBeFocused();
    await expect(
      page.getByText(
        locale === 'fa'
          ? 'اجازه مشاهده صف اصلاح هویت را ندارید.'
          : 'You do not have permission to view the correction queue.',
        { exact: true }
      )
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: locale === 'fa' ? 'بررسی درخواست' : 'Review case',
        exact: true,
      })
    ).toHaveCount(0);
    expect(bodies).toEqual(
      Array.from({ length: 3 }, () => ({
        fieldName: 'first_name',
        requestedValue: 'Corrected',
        reason: 'Document checked',
        evidenceUrls: [key],
      }))
    );
  });
for (const [locale, darkMode] of [
  ['en', false],
  ['fa', false],
  ['en', true],
  ['fa', true],
] as const)
  test(`correction reviewer uses fixed evidence, keyboard and legacy rejection (${locale}, dark=${darkMode})`, async ({
    page,
  }, testInfo) => {
    await shell(page, locale);
    await page.route('**/api/public/branding/config', (route) =>
      route.fulfill({
        json: {
          appTitle: 'Correction review',
          slogan: '',
          primaryColor: '#2563eb',
          secondaryColor: '#64748b',
          accentColor: '#f59e0b',
          logoUrl: null,
          faviconUrl: null,
          darkMode,
        },
      })
    );
    let legacy = false;
    await page.route('**/api/crm/verification-cases?*', (route) =>
      route.fulfill({
        json: {
          cases:
            new URL(route.request().url()).searchParams.get('status') === 'Under Review'
              ? [item]
              : [],
          total: 1,
          viewer: { userId: 'reviewer', canCreate: false, canReview: true },
        },
      })
    );
    await page.route(`**/api/crm/verification-cases/${caseId}`, (route) =>
      route.fulfill({
        json: {
          ...item,
          currentValue: 'Original',
          evidenceUrls: ['verification-evidence/fixed'],
          evidenceDownloadUrls: legacy ? [] : ['https://storage.example.test/fixed?signature=test'],
          reviewerNotes: null,
        },
      })
    );
    const decisions: unknown[] = [];
    await page.route(`**/api/crm/verification-cases/${caseId}/status`, (route) => {
      const body = route.request().postDataJSON();
      decisions.push(body);
      expect(body).toEqual(
        legacy
          ? { decision: 'Rejected', reviewerNotes: 'Resubmit evidence' }
          : { decision: 'Approved', reviewerNotes: 'Evidence checked' }
      );
      return route.fulfill({
        json: { success: true, id: caseId, profileId, status: body.decision },
      });
    });
    await page.goto('/admin/crm/corrections');
    const open = page.getByRole('button', {
      name: locale === 'fa' ? 'بررسی درخواست' : 'Review case',
      exact: true,
    });
    const review = page.getByRole('button', {
      name: locale === 'fa' ? 'بررسی تصمیم' : 'Review decision',
      exact: true,
    });
    const evidence = page.getByRole('link', {
      name: locale === 'fa' ? 'نمایش مدرک 1' : 'Open evidence 1',
      exact: true,
    });
    await expect(page.locator('#case-status')).toBeVisible();
    await page.locator('#case-status').focus();
    await expect(page.locator('#case-status')).toBeFocused();
    await page.locator('#case-status').selectOption('Under Review');
    await expect(page.locator('#case-status')).toHaveValue('Under Review');
    await expect(open).toBeVisible();
    await expect
      .poll(() => page.locator('html').evaluate((node) => node.classList.contains('dark')))
      .toBe(darkMode);
    const checkPage = async () => {
      const result = await new AxeBuilder({ page })
        .include('section:has(#case-status)')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(result.violations).toEqual([]);
      expect(result.incomplete.filter((item) => item.id === 'color-contrast')).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        page.viewportSize()!.width + 1
      );
    };
    await checkPage();
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Original', { exact: true })).toBeVisible();
    await expect(evidence).toHaveAttribute(
      'href',
      'https://storage.example.test/fixed?signature=test'
    );
    await expect(evidence).toHaveAttribute('target', '_blank');
    await expect(evidence).toHaveAttribute('rel', 'noopener noreferrer');
    await checkPage();
    await evidence.focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#case-decision')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#case-notes')).toBeFocused();
    await page.keyboard.type('Evidence checked');
    await page.screenshot({
      path: `/tmp/barghsa-crm-correction-review-${locale}-${darkMode ? 'dark' : 'light'}-${testInfo.project.name}.png`,
    });
    await page.keyboard.press('Tab');
    await expect(review).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(caseId);
    await expect(dialog).toContainText('Evidence checked');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(review).toBeFocused();
    expect(decisions).toEqual([]);
    await page.keyboard.press('Enter');
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .press('Enter');
    await expect(dialog).toHaveCount(0);
    expect(decisions).toHaveLength(1);
    await expect(page.locator('#case-status')).toBeFocused();
    legacy = true;
    await open.click();
    await expect(review).toBeDisabled();
    await expect(
      page.getByText(
        locale === 'fa' ? 'نسخه ثابت مدارک در دسترس نیست.' : 'Fixed evidence is unavailable.',
        { exact: false }
      )
    ).toBeVisible();
    await expect(evidence).toHaveCount(0);
    await page.locator('#case-decision').selectOption('Rejected');
    await expect(review).toBeDisabled();
    await page.locator('#case-notes').fill('Resubmit evidence');
    await expect(review).toBeEnabled();
    await review.click();
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .press('Enter');
    await expect(dialog).toHaveCount(0);
    expect(decisions).toHaveLength(2);
    await expect(page.locator('#case-status')).toBeFocused();
  });

for (const locale of ['en', 'fa'])
  test(`correction decisions require the selected case and matching acknowledgement (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let detailAttempt = 0;
    let saves = 0;
    const bodies: unknown[] = [];
    const detail = {
      ...item,
      currentValue: 'Original',
      evidenceUrls: ['verification-evidence/fixed'],
      evidenceDownloadUrls: ['https://storage.example.test/fixed'],
      reviewerNotes: null,
    };
    await page.route('**/api/crm/verification-cases?*', (route) =>
      route.fulfill({
        json: {
          cases: [item],
          total: 1,
          viewer: { userId: 'reviewer', canCreate: false, canReview: true },
        },
      })
    );
    await page.route(`**/api/crm/verification-cases/${caseId}`, (route) => {
      const invalid = [
        { ...detail, id: profileId },
        { ...detail, profileId: caseId },
      ];
      return route.fulfill({ json: invalid[detailAttempt++] ?? detail });
    });
    const expected = { success: true, id: caseId, profileId, status: 'Approved' };
    const invalid = [
      null,
      {},
      { ...expected, success: false },
      { ...expected, id: profileId },
      { ...expected, profileId: caseId },
      { ...expected, status: 'Rejected' },
    ];
    await page.route(`**/api/crm/verification-cases/${caseId}/status`, (route) => {
      bodies.push(route.request().postDataJSON());
      const result = saves < invalid.length ? invalid[saves] : expected;
      saves++;
      return route.fulfill({
        status: 200,
        body: JSON.stringify(result),
        contentType: 'application/json',
      });
    });
    await page.goto('/admin/crm/corrections');
    const open = page.getByRole('button', {
      name: locale === 'fa' ? 'بررسی درخواست' : 'Review case',
      exact: true,
    });
    const review = page.getByRole('button', {
      name: locale === 'fa' ? 'بررسی تصمیم' : 'Review decision',
      exact: true,
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await open.click();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(review).toHaveCount(0);
    }
    await open.click();
    await expect(page.getByText('Original', { exact: true })).toBeVisible();
    await page.locator('#case-notes').fill('Evidence checked');
    await review.click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', {
      name: locale === 'fa' ? 'تأیید' : 'Confirm',
      exact: true,
    });
    for (let attempt = 0; attempt < invalid.length; attempt++) {
      await confirm.click();
      await expect.poll(() => saves).toBe(attempt + 1);
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(page.locator('#case-notes')).toHaveValue('Evidence checked');
    }
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(bodies).toEqual(
      Array.from({ length: invalid.length + 1 }, () => ({
        decision: 'Approved',
        reviewerNotes: 'Evidence checked',
      }))
    );
  });

for (const locale of ['en', 'fa'])
  test(`correction creation follows profile permission and recovers from profile errors (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale);
    let allowed = false;
    let archived = false;
    let profileStatus = 200;
    await page.route(`**/api/crm/profiles/${profileId}`, (route) =>
      route.fulfill({
        status: profileStatus,
        json: {
          profile: { id: profileId, profileType: 'INDIVIDUAL', archived },
          viewerPermissions: { canEditIdentity: allowed },
        },
      })
    );
    await page.route('**/api/crm/verification-cases?*', (route) =>
      route.fulfill({
        json: {
          cases: [],
          total: 0,
          viewer: { userId: 'viewer', canCreate: true, canReview: false },
        },
      })
    );
    await page.goto(`/admin/crm/corrections?profileId=${profileId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const refresh = page.getByRole('button', {
      name: locale === 'fa' ? 'تازه‌سازی' : 'Refresh',
      exact: true,
    });
    await expect(page.locator('#case-status')).toBeVisible();
    await expect(page.locator('#correction-value')).toHaveCount(0);
    allowed = true;
    await refresh.click();
    await expect(page.locator('#correction-value')).toBeVisible();
    profileStatus = 503;
    await refresh.click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('#correction-value')).toHaveCount(0);
    profileStatus = 200;
    await refresh.click();
    await expect(page.locator('#correction-value')).toBeVisible();
    archived = true;
    await refresh.click();
    await expect(page.locator('#correction-value')).toHaveCount(0);
    archived = false;
    allowed = false;
    await refresh.click();
    await expect(page.locator('#correction-value')).toHaveCount(0);
  });
