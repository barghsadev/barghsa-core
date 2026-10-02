import AxeBuilder from '@axe-core/playwright';
import { t, type Locale } from '@barghsa/i18n/app';
import { test, expect, type Page } from './coverage-fixture';
import { fulfillDashboard } from './dashboard-fixture';

const answeredAt = '2026-10-01T22:30:00Z';
const reply = 'Published guidance only; no account details.';
function answer(metadata: Record<string, unknown> = {}) {
  return {
    reply,
    sources: [
      {
        kbId: '01900000-0000-7000-8000-000000000001',
        title: 'Customer guide',
        documentTitle: 'guide.pdf',
        excerpt: 'Published customer instructions.',
      },
    ],
    attribution: 'retrieved_context',
    remainingQuota: 4,
    answeredAt,
    policyChecks: [
      { type: 'content_filter', count: 2 },
      { type: 'data_access_scope', count: 1 },
    ],
    ...metadata,
  };
}
async function setup(page: Page, locale: Locale, baseURL: string) {
  await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
  await page
    .context()
    .addCookies([{ name: 'barghsa_csrf', value: 'knowledge-metadata-fixture', url: baseURL }]);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'viewer',
        isStaff: false,
        operatingContext: 'profile',
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  let profileId = 'profile-1';
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [
          {
            id: 'profile-1',
            profileType: 'INDIVIDUAL',
            isDefault: true,
            status: 'ACTIVE',
            firstName: 'Ari',
            lastName: 'Buyer',
          },
          {
            id: 'profile-2',
            profileType: 'LEGAL',
            isDefault: false,
            status: 'ACTIVE',
            title: 'Nova Energy',
          },
        ],
        hasDefault: true,
        activeProfileId: profileId,
      },
    })
  );
  await page.route('**/api/profiles/switch/profile-2', (route) => {
    profileId = 'profile-2';
    return route.fulfill({ json: { activeProfileId: profileId } });
  });
  await page.route('**/api/ai/knowledge/availability', (route) =>
    route.fulfill({
      json: {
        available: true,
        profileId,
        profileName: profileId === 'profile-1' ? 'Ari Buyer' : 'Nova Energy',
        slotKey: profileId === 'profile-1' ? 'individual_chatbot' : 'legal_entity_chatbot',
      },
    })
  );
  await page.route('**/api/dashboard{,/**}', (route) =>
    fulfillDashboard(route, {
      json: {
        profile: { id: profileId, name: 'Ari Buyer' },
        access: { wallet: true, invoices: true },
        wallet: { balance: '1234500', currency: 'IRR' },
        pendingInvoices: 2,
      },
    })
  );
  await page.route('**/api/invoices{,?*}', (route) =>
    route.fulfill({ json: { invoices: [], nextBefore: null } })
  );
}

for (const locale of ['en', 'fa'] as const) {
  const copy = (key: string) => t(`assistant.${key}`, locale);
  test(`${locale}: contextual prompts draft questions and answers show policy categories and account-zone times`, async ({
    page,
    baseURL,
  }, info) => {
    await setup(page, locale, baseURL!);
    const requests: Record<string, unknown>[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/ai/knowledge/questions', async (route) => {
      requests.push(route.request().postDataJSON());
      await gate;
      await route.fulfill({ json: answer() });
    });
    try {
      await page.goto('/invoices');
      await page.getByRole('button', { name: copy('open'), exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText(copy('suggestions'), { exact: true }).click();
      const prompts = dialog.getByRole('group', { name: copy('suggestions') });
      await expect(prompts.getByRole('button')).toHaveCount(4);
      await prompts.getByRole('button', { name: copy('suggestion.invoiceStatus') }).click();
      const input = dialog.getByLabel(copy('input'));
      await expect(input).toHaveValue(copy('suggestion.invoiceStatus'));
      await expect(input).toBeFocused();
      expect(requests).toHaveLength(0);
      await input.press('Shift+Enter');
      await expect(input).toHaveValue(copy('suggestion.invoiceStatus') + '\n');
      await input.press('Enter');
      await expect.poll(() => requests.length).toBe(1);
      await expect(input).toBeDisabled();
      await dialog.getByText(copy('suggestions'), { exact: true }).click();
      await expect(
        prompts.getByRole('button', { name: copy('suggestion.payment') })
      ).toBeDisabled();
      await dialog.getByText(copy('suggestions'), { exact: true }).click();
      release();
      await expect(dialog.getByText(reply)).toBeVisible();
      const checks = dialog.getByRole('list', { name: copy('policies.checked') });
      await expect(checks).toContainText(
        copy('policies.content_filter') + ' · ' + (locale === 'fa' ? '۲' : '2')
      );
      await expect(checks).toContainText(copy('policies.data_access_scope'));
      const recorded = dialog.locator(`time[datetime="${answeredAt}"]`);
      await expect(recorded).toHaveText(locale === 'fa' ? '۱۴۰۵/۷/۱۰, ۲:۰۰' : '10/2/26, 2:00 AM');
      await expect(dialog.getByLabel(copy('sentAt'))).toHaveAttribute('datetime', /T.*Z$/);
      await dialog.getByText(copy('suggestions'), { exact: true }).click();
      await expect(prompts.getByRole('button', { name: copy('suggestion.payment') })).toBeEnabled();
      await prompts.getByRole('button', { name: copy('suggestion.payment') }).click();
      await expect(input).toHaveValue(copy('suggestion.payment'));
      await dialog.getByText(copy('suggestions'), { exact: true }).click();
      expect(requests).toEqual([
        { message: copy('suggestion.invoiceStatus'), requestId: expect.any(String) },
      ]);
      await expect(dialog).not.toContainText('1234500');
      const violations = (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations;
      expect(violations).toEqual([]);
      const box = await dialog.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await dialog.screenshot({ path: info.outputPath(`knowledge-${locale}.png`) });
    } finally {
      release();
    }
  });

  test(`${locale}: older answers and answers without assigned policies remain distinguishable`, async ({
    page,
    baseURL,
  }) => {
    await setup(page, locale, baseURL!);
    let questions = 0;
    await page.route('**/api/ai/knowledge/questions', (route) => {
      questions++;
      const result =
        questions === 1
          ? answer({
              reply: '<script>private markup</script>',
              policyChecks: null,
              answeredAt: null,
            })
          : answer({ policyChecks: [] });
      return route.fulfill({ json: result });
    });
    await page.goto('/ai');
    const guide = page.getByRole('region', { name: copy('title') });
    await guide.getByLabel(copy('input')).fill('Published guidance?');
    await guide.getByRole('button', { name: copy('send'), exact: true }).click();
    await expect(guide.getByText(copy('policies.unrecorded'))).toBeVisible();
    await expect(guide.getByText(copy('timeUnrecorded'))).toBeVisible();
    await expect(guide.getByText('<script>private markup</script>', { exact: true })).toBeVisible();
    await expect(guide.locator('script')).toHaveCount(0);
    await guide.getByLabel(copy('input')).fill('Another published question?');
    await guide.getByRole('button', { name: copy('send'), exact: true }).click();
    await expect(guide.getByText(copy('policies.none'))).toBeVisible();
    await expect(guide.locator(`time[datetime="${answeredAt}"]`)).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

test('retry keeps one request and policy denials provide a recoverable explanation', async ({
  page,
  baseURL,
}) => {
  await setup(page, 'en', baseURL!);
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/ai/knowledge/questions', (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1)
      return route.fulfill({ status: 503, json: { error: { code: 'AI_KNOWLEDGE_BUSY' } } });
    if (requests.length === 2) return route.fulfill({ json: answer() });
    return route.fulfill({ status: 422, json: { error: { code: 'AI_KNOWLEDGE_POLICY_BLOCKED' } } });
  });
  await page.goto('/ai');
  const input = page.getByLabel('Write your question');
  await input.fill('Explain payment policies');
  await input.press('Enter');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText(reply)).toBeVisible();
  expect(requests[1]).toEqual(requests[0]);
  await expect(page.getByText('Explain payment policies', { exact: true })).toHaveCount(1);
  await input.fill('Restricted question');
  await input.press('Enter');
  await expect(
    page.getByRole('region', { name: 'Barghsa knowledge guide' }).getByRole('alert')
  ).toContainText(t('assistant.policyBlocked', 'en'));
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  await expect(input).toBeEnabled();
  await expect(page.getByRole('list', { name: 'Policies checked for this answer' })).toHaveCount(1);
});

test('a profile switch clears old policy metadata and ignores a late answer', async ({
  page,
  baseURL,
}) => {
  await setup(page, 'en', baseURL!);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/ai/knowledge/questions', async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      await gate;
      await route
        .fulfill({ json: answer({ reply: 'Old profile late answer' }) })
        .catch(() => undefined);
    } else
      await route.fulfill({
        json: answer({ reply: 'Current profile guidance', policyChecks: [] }),
      });
  });
  try {
    await page.goto('/ai');
    await page.getByLabel('Write your question').fill('Old profile question');
    await page.getByLabel('Write your question').press('Enter');
    await expect.poll(() => requests.length).toBe(1);
    const profilePicker = page.getByLabel('Switch active profile');
    const navigationToggle = page.locator('[aria-controls="dashboard-navigation"]');
    const openedNavigation = !(await profilePicker.isVisible());
    if (openedNavigation) await navigationToggle.click();
    await profilePicker.selectOption('profile-2');
    if (openedNavigation) await navigationToggle.click();
    await expect(page.getByText("You're asking as Nova Energy.")).toBeVisible();
    await page.getByText(t('assistant.suggestions', 'en'), { exact: true }).click();
    await expect(
      page.getByRole('button', { name: t('assistant.suggestion.legalDocuments', 'en') })
    ).toBeVisible();
    release();
    await page.getByLabel('Write your question').fill('New profile question');
    await page.getByLabel('Write your question').press('Enter');
    await expect(page.getByText('Current profile guidance')).toBeVisible();
    await expect(page.getByText('Old profile late answer')).toHaveCount(0);
    await expect(page.getByText('Old profile question', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Policies checked for this answer' })).toHaveCount(
      0
    );
    expect(requests[1]).toEqual({ message: 'New profile question', requestId: expect.any(String) });
  } finally {
    release();
  }
});
