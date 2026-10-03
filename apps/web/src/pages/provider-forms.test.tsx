import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import Email from './AdminEmailProvidersPage.js';
import { t } from '@barghsa/i18n/admin-ui';
import Sms from './AdminSmsProvidersPage.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useTimezone.js', () => ({
  useTimezone: () => ({ status: 'ready', timezone: 'UTC', retry: () => {} }),
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.fail = harness.hold = false;
  harness.release = null;
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const email = {
  id: 'email',
  transport: 'resend',
  label: 'Saved provider',
  status: 'draft',
  lastTestStatus: 'passed',
  maskedConfig: { api_key: '********test', from_email: 'sender@example.test' },
};
const sms = {
  id: 'sms',
  transport: 'smsir',
  label: 'Saved provider',
  status: 'draft',
  lastTestStatus: 'passed',
  createdAt: '2026-10-01T00:00:00Z',
  maskedConfig: {
    api_key: '********test',
    sender: '3000',
    timeout: 15,
    throughput_limit: 100,
    low_credit_threshold: 0,
    template_mappings: [{ event_key: 'auth.otp', template_id: '42', variables: { code: 'CODE' } }],
  },
};
async function click(name: string, dialog = false) {
  const area = dialog ? document.querySelector('[role=dialog]')! : host;
  const button = [...area.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name
  );
  expect(button, name).toBeDefined();
  await act(async () => button!.click());
}
async function fill(selector: string, value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(dialog = false) {
  await act(async () =>
    document
      .querySelector(dialog ? '[role=dialog] form' : 'form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}

type Schema = typeof import('../lib/catalogue-form-schemas.js');
const harness = vi.hoisted(() => ({
  fail: false,
  hold: false,
  release: null as (() => void) | null,
}));
vi.mock('../lib/catalogue-form-schemas.js', async (original) => {
  const actual = await original<Schema>();
  return {
    ...actual,
    providerFormSchema: (...args: Parameters<typeof actual.providerFormSchema>) => {
      if (harness.fail) throw new Error('Module unavailable');
      if (harness.hold)
        return new Promise((resolve) => {
          harness.release = () => resolve(actual.providerFormSchema(...args));
        });
      return actual.providerFormSchema(...args);
    },
  };
});
const scenarios = [
  {
    name: 'email',
    page: <Email />,
    row: email,
    edit: 'Save',
    label: '#email-provider-label',
    key: '#email-provider-apiKey',
    reset: 'Reset provider draft',
  },
  {
    name: 'sms',
    page: <Sms />,
    row: sms,
    edit: 'Edit draft',
    label: '#sms-label',
    key: '#sms-key',
    reset: 'Reset provider draft',
  },
] as const;
for (const scenario of scenarios) {
  let receipt: unknown,
    status: number,
    list: unknown,
    attempts: unknown[],
    fetcher: Mock<(path: string, init?: RequestInit) => Promise<Response>>;
  async function mount() {
    receipt = { ...scenario.row, label: 'Local draft' };
    status = 200;
    list = [scenario.row];
    attempts = [];
    fetcher = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/template-event-keys')) return reply(['auth.otp']);
      if (init?.method && init.method !== 'GET') {
        attempts.push(JSON.parse(String(init.body)));
        return reply(receipt, status);
      }
      return reply(list);
    });
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(scenario.page));
    await click(scenario.edit);
    await fill(scenario.label, 'Local draft');
  }
  const field = (selector: string) => host.querySelector<HTMLInputElement>(selector)!;
  const invalid = async (selector: string) =>
    vi.waitFor(async () => {
      await act(async () => {});
      expect(field(selector).getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(field(selector));
    });
  it(`${scenario.name}: links required-field feedback and preserves secret draft`, async () => {
    await mount();
    await fill(scenario.key, 'synthetic-secret');
    await fill(scenario.label, '');
    await submit();
    await invalid(scenario.label);
    expect(field(scenario.key).value).toBe('synthetic-secret');
    expect(attempts).toHaveLength(0);
    expect(
      document.getElementById(field(scenario.label).getAttribute('aria-describedby')!)?.textContent
    ).toContain('120');
  });
  it(`${scenario.name}: maps only owned server identifiers to localized field feedback`, async () => {
    await mount();
    status = 400;
    receipt = { error: { fields: ['label'], message: 'untrusted submitted secret' } };
    await submit();
    await invalid(scenario.label);
    expect(field(scenario.label).value).toBe('Local draft');
    expect(host.textContent).not.toContain('untrusted submitted secret');
    receipt = { error: { fields: ['__proto__'] } };
    await fill(scenario.label, 'Valid draft');
    await submit();
    expect(host.textContent).not.toContain('__proto__');
    expect(field(scenario.label).value).toBe('Valid draft');
  });
  it(`${scenario.name}: unavailable validator blocks writes and retains the same draft for retry`, async () => {
    await mount();
    harness.fail = true;
    await submit();
    await vi.waitFor(() => expect(host.textContent).toContain('Validation could not load'));
    expect(attempts).toHaveLength(0);
    expect(field(scenario.label).value).toBe('Local draft');
    harness.fail = false;
    await submit();
    await vi.waitFor(() => expect(host.querySelector('form')).toBeNull());
    expect(attempts).toHaveLength(1);
    expect((attempts[0] as { config: Record<string, unknown> }).config.api_key).toBeUndefined();
  });
  it(`${scenario.name}: locks before deferred validation and ignores duplicate submissions`, async () => {
    await mount();
    harness.hold = true;
    await submit();
    await vi.waitFor(() => expect(harness.release).toBeTypeOf('function'));
    expect(field(scenario.label).matches(':disabled')).toBe(true);
    await submit();
    expect(attempts).toHaveLength(0);
    harness.hold = false;
    await act(async () => harness.release!());
    await vi.waitFor(() => expect(host.querySelector('form')).toBeNull());
    expect(attempts).toHaveLength(1);
  });
  it(`${scenario.name}: unverified acknowledgement requires a fresh read and explicit reset`, async () => {
    await mount();
    receipt = {};
    await submit();
    await vi.waitFor(() => expect(host.textContent).toContain('could not be verified'));
    await submit();
    expect(attempts).toHaveLength(1);
    expect(field(scenario.label).value).toBe('Local draft');
    const reset = () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === scenario.reset
      )!;
    expect(reset().disabled).toBe(true);
    await click('Refresh providers');
    await click(scenario.reset);
    expect(field(scenario.label).value).toBe(scenario.row.label);
    expect(field(scenario.key).value).toBe('');
  });

  for (const uncertain of [false, true])
    it(`${scenario.name}: protected retry ${uncertain ? 'blocks an unverified receipt' : 'returns owned field feedback'}`, async () => {
      await mount();
      status = 403;
      receipt = { requiresStepUp: true };
      const original = fetcher.getMockImplementation()!;
      fetcher.mockImplementation(async (path: string, init?: RequestInit) => {
        if (path.endsWith('/step-up/otp/send'))
          return reply({
            challengeId: '00000000-0000-4000-8000-000000000001',
            channel: 'email',
            expiresAt: new Date(Date.now() + 300000).toISOString(),
          });
        if (path.endsWith('/step-up/otp/verify')) {
          status = uncertain ? 200 : 400;
          receipt = uncertain
            ? {}
            : { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['label'] } };
          return reply({ verified: true, stepUpVerifiedAt: new Date().toISOString() });
        }
        return original(path, init);
      });
      await submit();
      await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).not.toBeNull());
      await click(t('admin.stepUp.send', 'en'), true);
      await fill('[role=dialog] input[autocomplete=one-time-code]', '123456');
      await submit(true);
      if (uncertain) {
        await vi.waitFor(() => expect(host.textContent).toContain('could not be verified'));
        expect(
          document.querySelector<HTMLButtonElement>('[role=dialog] button[type=submit]')!.disabled
        ).toBe(true);
        await submit(true);
        expect(attempts).toHaveLength(2);
      } else {
        await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
        await invalid(scenario.label);
        expect(field(scenario.label).value).toBe('Local draft');
      }
      expect(attempts[0]).toEqual(attempts[1]);
    });
  it(`${scenario.name}: changing the saved row freezes the retained draft until reset`, async () => {
    await mount();
    list = [{ ...scenario.row, label: 'Remote update' }];
    await click('Refresh providers');
    expect(field(scenario.label).value).toBe('Local draft');
    expect(field(scenario.label).matches(':disabled')).toBe(true);
    await submit();
    expect(attempts).toHaveLength(0);
    await click(scenario.reset);
    expect(field(scenario.label).value).toBe('Remote update');
  });
}
it('SMS mapping errors keep variable rows and focus the mapping control', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      reply(path.endsWith('/template-event-keys') ? ['auth.otp'] : [sms])
    )
  );
  await act(async () => root.render(<Sms />));
  await click('Edit draft');
  await fill('input[aria-label="SMS.ir template ID 1"]', '0');
  await submit();
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Internal event 1');
  });
  expect(host.querySelector('input[aria-label="Template variable 1.1"]')).not.toBeNull();
  expect(host.textContent).toContain('positive template IDs');
});
