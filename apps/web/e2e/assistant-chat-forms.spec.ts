import AxeBuilder from '@axe-core/playwright';
import { t as appText } from '@barghsa/i18n/app';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { assistantChatFormText } from '@barghsa/i18n/assistant-chat-forms';
import { test, expect, type Page } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { mockOppositeNumerals } from './number-preference-fixture';
const id = '01900000-0000-7000-8000-000000000001';
const answer = {
  reply: 'Verified guide answer',
  sources: [{ kbId: id, title: 'Guide', documentTitle: 'Guide.txt', excerpt: 'Published excerpt' }],
  attribution: 'retrieved_context',
  remainingQuota: 4,
};
const result = {
  ...answer,
  conversationId: id,
  policyResults: [
    {
      id,
      title: 'Style',
      type: 'response_style',
      result: 'applied',
      priority: -20,
      ruleChecks: [
        { rule: 'tone', outcome: 'applied' },
        { rule: 'language', outcome: 'overridden' },
      ],
    },
  ],
  tokenUsage: { input: 9, output: 5 },
  latencyMs: 12,
  remainingQuota: 9,
};
async function setup(page: Page, kind: 'customer' | 'admin', locale: 'fa' | 'en', baseURL: string) {
  await setupCatalogueForms(page, locale, locale === 'fa');
  await mockOppositeNumerals(page, locale, locale === 'fa');
  await page
    .context()
    .addCookies([{ name: 'barghsa_csrf', value: 'chat-form-fixture', url: baseURL }]);
  if (kind === 'admin') {
    await page.route('**/api/admin/agents', (route) =>
      route.fulfill({
        json: [
          { id, title: 'Agent', description: '', modelId: id, modelTitle: 'Model', enabled: true },
        ],
      })
    );
    await page.route('**/api/admin/agents/options', (route) =>
      route.fulfill({ json: { models: [], kbs: [], policies: [], kbGroups: [], policyGroups: [] } })
    );
  } else {
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
          ],
          hasDefault: true,
          activeProfileId: 'profile-1',
        },
      })
    );
    await page.route('**/api/ai/knowledge/availability', (route) =>
      route.fulfill({
        json: {
          available: true,
          profileId: 'profile-1',
          profileName: 'Ari Buyer',
          slotKey: 'individual_chatbot',
        },
      })
    );
  }
}
for (const kind of ['customer', 'admin'] as const)
  for (const locale of ['en', 'fa'] as const) {
    const copy = (key: Parameters<typeof assistantChatFormText>[0]) =>
      assistantChatFormText(key, locale);
    const label = (key: string) =>
      kind === 'admin'
        ? adminText(`admin.agents.testChat.${key}`, locale)
        : appText(`assistant.${key}`, locale);
    const digits = (value: number) =>
      new Intl.NumberFormat(locale, {
        numberingSystem: locale === 'fa' ? 'latn' : 'arabext',
      }).format(value);
    const path = kind === 'admin' ? '/admin/agents' : '/ai';
    const endpoint =
      kind === 'admin' ? '**/api/admin/ai/test-chat' : '**/api/ai/knowledge/questions';
    const inputSelector = kind === 'admin' ? '#test-chat-message' : '#knowledge-question';
    test(`${locale}: ${kind} chat validates, preserves owned feedback, and verifies a captured retry`, async ({
      page,
      baseURL,
    }, info) => {
      await setup(page, kind, locale, baseURL!);
      let mode: 'fields' | 'malformed' | 'success' = 'fields';
      const sent: Record<string, unknown>[] = [];
      await page.route(endpoint, (route) => {
        sent.push(route.request().postDataJSON());
        return route.fulfill(
          mode === 'fields'
            ? {
                status: 400,
                json: {
                  error: {
                    code: 'VALIDATION:INPUT:INVALID',
                    fields: ['message'],
                    message: 'Private server detail',
                  },
                },
              }
            : {
                json:
                  mode === 'malformed'
                    ? { ...(kind === 'admin' ? result : answer), sources: null }
                    : kind === 'admin'
                      ? result
                      : answer,
              }
        );
      });
      await page.goto(path);
      const chat = page.getByRole('region', { name: label('title'), exact: true }),
        input = chat.locator(inputSelector),
        form = chat.locator('form');
      const send = chat.getByRole('button', { name: label('send'), exact: true });
      const sendQuestion = () => (info.project.use.isMobile ? send.tap() : send.click());
      await sendQuestion();
      const first = kind === 'admin' ? chat.locator('#test-chat-agent') : input;
      await expect(first).toBeFocused();
      await expect(first).toHaveAttribute('aria-invalid', 'true');
      expect(sent).toHaveLength(0);
      if (kind === 'admin') await first.selectOption(id);
      const long = 'x'.repeat(kind === 'admin' ? 4001 : 1001);
      await input.fill(long);
      await sendQuestion();
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(long);
      expect(sent).toHaveLength(0);
      await chat.getByRole('alert').scrollIntoViewIfNeeded();
      await expect(chat.getByRole('alert')).toBeInViewport();
      await page.screenshot({ path: info.outputPath(`chat-validation-${kind}-${locale}.png`) });
      await input.fill('Preserved question');
      await sendQuestion();
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(input).toHaveValue('Preserved question');
      await expect(chat).not.toContainText('Private server detail');
      mode = 'malformed';
      await input.fill('Corrected question');
      await sendQuestion();
      const retry = chat.getByRole('button', { name: label('retry'), exact: true });
      await expect(retry).toBeVisible();
      await expect(input).toHaveValue('Corrected question');
      await expect(input).toBeDisabled();
      await expect(chat).not.toContainText('Verified guide answer');
      await form.evaluate((node) => {
        node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      expect(sent).toHaveLength(2);
      mode = 'success';
      await retry.click();
      await expect(chat).toContainText('Verified guide answer');
      await expect(input).toHaveValue('');
      expect(sent).toHaveLength(3);
      expect(sent[2]).toEqual(sent[1]);
      if (kind === 'admin') {
        await chat.getByText(label('metadata'), { exact: true }).click();
        await expect(chat).toContainText(`${digits(9)} / ${digits(5)}`);
        await expect(chat).toContainText(copy('milliseconds').replace('{count}', digits(12)));
        await expect(chat).toContainText(copy('applied'));
        await expect(
          chat.getByText(copy('tokenParts'), { exact: true }).locator('..').locator('dd')
        ).toHaveAttribute('dir', 'ltr');
        await expect(chat).toContainText(`${copy('rule.tone')} — ${copy('outcome.applied')}`);
        await expect(chat).toContainText(
          `${copy('rule.language')} — ${copy('outcome.overridden')}`
        );
        await expect(chat).toContainText(`${copy('priority')}: ${digits(-20)}`);
        const tokenTotal = chat.getByText(copy('tokenTotal'), { exact: true }).locator('..');
        await expect(tokenTotal).toContainText(digits(14));
        await tokenTotal.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`metadata-recorded-${locale}.png`) });
      } else await expect(chat).toContainText(label('remaining').replace('{count}', digits(4)));
      const violations = await new AxeBuilder({ page })
        .include(
          kind === 'admin' ? 'section[aria-label]' : `section[aria-label="${label('title')}"]`
        )
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(violations.violations).toEqual([]);
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1
      );
      expect(overflow).toBe(false);
      await input.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`chat-${kind}-${locale}.png`),
      });
    });
    test(`${locale}: ${kind} chat honors cooldown, retries the same request, and clears denied history`, async ({
      page,
      baseURL,
    }) => {
      await setup(page, kind, locale, baseURL!);
      let status = 429;
      const sent: Record<string, unknown>[] = [];
      await page.route(endpoint, (route) => {
        sent.push(route.request().postDataJSON());
        return route.fulfill({
          status,
          headers: status === 429 ? { 'Retry-After': '60' } : {},
          json: status === 200 ? (kind === 'admin' ? result : answer) : {},
        });
      });
      await page.goto(path);
      const chat = page.getByRole('region', { name: label('title'), exact: true }),
        input = chat.locator(inputSelector);
      if (kind === 'admin') await chat.locator('#test-chat-agent').selectOption(id);
      await input.fill('Preserved limited question');
      await page.clock.install();
      await chat.getByRole('button', { name: label('send'), exact: true }).click();
      const retry = chat.getByRole('button', { name: label('retry'), exact: true });
      await expect(retry).toBeDisabled();
      await expect(chat).toContainText(copy('wait').replace('{seconds}', digits(60)));
      await expect(input).toHaveValue('Preserved limited question');
      await chat
        .locator('form')
        .evaluate((node) =>
          node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        );
      expect(sent).toHaveLength(1);
      await page.clock.fastForward(61_000);
      await expect(retry).toBeEnabled();
      status = 200;
      await retry.click();
      await expect(chat).toContainText('Verified guide answer');
      expect(sent[1]).toEqual(sent[0]);
      status = 403;
      await input.fill('Private next question');
      await chat.getByRole('button', { name: label('send'), exact: true }).click();
      if (kind === 'admin') {
        await expect(chat).toHaveCount(0);
        await expect(page.getByRole('alert')).toContainText(
          locale === 'fa' ? 'اجازه مدیریت' : 'permission to manage'
        );
      } else {
        await expect(chat).toContainText(copy('denied'));
        await expect(chat).not.toContainText('Verified guide answer');
        await expect(input).toHaveValue('');
        await expect(input).toBeDisabled();
      }
      expect(sent).toHaveLength(3);
    });
  }

for (const locale of ['en', 'fa'] as const) {
  const label = (key: string) => adminText(`admin.agents.testChat.${key}`, locale);
  const copy = (key: Parameters<typeof assistantChatFormText>[0]) =>
    assistantChatFormText(key, locale);
  test(`${locale}: admin metadata preserves unknown legacy details, safe totals, and literal source text`, async ({
    page,
    baseURL,
  }, info) => {
    await setup(page, 'admin', locale, baseURL!);
    let mode: 'legacy' | 'overflow' = 'legacy';
    await page.route('**/api/admin/ai/test-chat', (route) =>
      route.fulfill({
        json:
          mode === 'legacy'
            ? {
                ...result,
                sources: [],
                attribution: 'general_guidance',
                tokenUsage: null,
                policyResults: [
                  { id, title: 'Legacy style', type: 'response_style', result: 'applied' },
                ],
              }
            : {
                ...result,
                tokenUsage: { input: Number.MAX_SAFE_INTEGER, output: 1 },
                sources: [
                  {
                    ...answer.sources[0],
                    title: '<img src=x onerror=alert(1)>',
                    excerpt: '<script>private()</script>',
                  },
                ],
              },
      })
    );
    await page.goto('/admin/agents');
    const chat = page.getByRole('region', { name: label('title'), exact: true });
    await chat.locator('#test-chat-agent').selectOption(id);
    const send = async () => {
      await chat.locator('#test-chat-message').fill('Metadata question');
      await chat.getByRole('button', { name: label('send'), exact: true }).click();
      await expect(chat).toContainText('Verified guide answer');
      await chat.getByText(label('metadata'), { exact: true }).click();
    };
    await send();
    await expect(chat.getByText(copy('noSources'), { exact: true })).toBeVisible();
    await expect(chat.getByText(copy('rulesUnrecorded'), { exact: true })).toBeVisible();
    const total = chat.getByText(copy('tokenTotal'), { exact: true }).locator('..');
    await expect(total).toContainText(copy('unrecorded'));
    const tokens = chat.locator('summary').filter({ hasText: label('tokens') });
    await tokens.focus();
    await tokens.press('Enter');
    await expect(total).toBeHidden();
    await tokens.press('Enter');
    await expect(total).toBeVisible();
    await chat.getByRole('button', { name: label('newConversation'), exact: true }).click();
    mode = 'overflow';
    await send();
    await expect(total).toContainText(copy('unrecorded'));
    const source = chat.locator('summary').filter({ hasText: '<img src=x onerror=alert(1)>' });
    await source.click();
    await expect(chat.getByText('<script>private()</script>', { exact: true })).toBeVisible();
    await expect(chat.locator('img,script')).toHaveCount(0);
    await total.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`metadata-legacy-overflow-${locale}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
      false
    );
  });
}

for (const kind of ['customer', 'admin'] as const)
  for (const locale of ['en', 'fa'] as const) {
    test(`${locale}: ${kind} shared input handles resizing, composition, newlines and timestamped retries`, async ({
      page,
      baseURL,
    }, info) => {
      await setup(page, kind, locale, baseURL!);
      const start = '2026-10-04T15:00:00.000Z';
      const received = '2026-10-04T15:01:00.000Z';
      const answered = '2026-10-01T22:30:00Z';
      await page.clock.setFixedTime(new Date(start));
      const label = (key: string) =>
        kind === 'admin'
          ? adminText(`admin.agents.testChat.${key}`, locale)
          : appText(`assistant.${key}`, locale);
      let fail = true;
      const sent: Record<string, unknown>[] = [];
      await page.route(
        kind === 'admin' ? '**/api/admin/ai/test-chat' : '**/api/ai/knowledge/questions',
        (route) => {
          sent.push(route.request().postDataJSON());
          return route.fulfill(
            fail
              ? { status: 503, json: { error: { code: 'AI_TEST_CHAT_UNAVAILABLE' } } }
              : {
                  json:
                    kind === 'admin'
                      ? result
                      : {
                          ...answer,
                          answeredAt: answered,
                          policyChecks: [{ type: 'content_filter', count: 1 }],
                        },
                }
          );
        }
      );
      await page.goto(kind === 'admin' ? '/admin/agents' : '/ai');
      const chat = page.getByRole('region', { name: label('title'), exact: true });
      if (kind === 'admin') await chat.locator('#test-chat-agent').selectOption(id);
      else {
        const prompts = chat.getByText(appText('assistant.suggestions', locale), { exact: true });
        await prompts.click();
        await expect(
          chat
            .getByRole('group', { name: appText('assistant.suggestions', locale) })
            .getByRole('button')
        ).toHaveCount(4);
        await expect(
          chat.getByText(appText('assistant.welcomeNamed', locale).replace('{name}', 'Ari Buyer'), {
            exact: true,
          })
        ).toBeVisible();
      }
      const input = chat.locator('textarea');
      const long = Array.from({ length: 12 }, () => 'Detailed question about electricity.').join(
        '\n'
      );
      await input.fill(long);
      await expect(input).toHaveCSS('height', '240px');
      await input.evaluate((node) => {
        node.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
            isComposing: true,
          })
        );
        const event = new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, 'keyCode', { value: 229 });
        node.dispatchEvent(event);
      });
      await input.press('Shift+Enter');
      await input.pressSequentially('Final line');
      await expect(input).toHaveValue(long + '\nFinal line');
      expect(sent).toHaveLength(0);
      await input.press('Enter');
      const retry = chat.getByRole('button', { name: label('retry'), exact: true });
      await expect(retry).toBeVisible();
      await expect(input).toBeDisabled();
      expect(sent).toHaveLength(1);
      expect(sent[0]?.message).toBe(long + '\nFinal line');
      expect(sent[0]).not.toHaveProperty('sentAt');
      expect(sent[0]).not.toHaveProperty('receivedAt');
      fail = false;
      await page.clock.setFixedTime(new Date(received));
      await retry.click();
      await expect(chat).toContainText('Verified guide answer');
      await expect(input).toHaveValue('');
      await expect(input).toHaveCSS('height', '80px');
      expect(sent).toHaveLength(2);
      expect(sent[1]).toEqual(sent[0]);
      const user = chat.locator('article[data-message-role="user"]'),
        assistant = chat.locator('article[data-message-role="assistant"]');
      await expect(user).toHaveCount(1);
      await expect(assistant).toHaveCount(1);
      await expect(user.locator('time')).toHaveAttribute('datetime', start);
      await expect(assistant.locator('time')).toHaveAttribute(
        'datetime',
        kind === 'admin' ? received : answered
      );
      await assistant.getByText('Verified guide answer', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`shared-chat-${kind}-${locale}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
        false
      );
    });
  }
