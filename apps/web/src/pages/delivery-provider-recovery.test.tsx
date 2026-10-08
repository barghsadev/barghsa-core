import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Email from './AdminEmailProvidersPage.js';
import Sms from './AdminSmsProvidersPage.js';
vi.mock('../hooks/useTimezone.js', () => ({
  useTimezone: () => ({ status: 'ready', timezone: 'UTC', retry: () => {} }),
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
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
const scenarios = [
  {
    name: 'email',
    page: <Email />,
    row: email,
    edit: 'Save',
    label: '#email-provider-label',
    key: 'input[type=password]',
    retry: 'Retry',
  },
  {
    name: 'sms',
    page: <Sms />,
    row: sms,
    edit: 'Edit draft',
    label: '#sms-label',
    key: '#sms-key',
    retry: 'Try again',
  },
] as const;
for (const scenario of scenarios) {
  function reads(
    options: {
      list?: () => Response | Promise<Response>;
      events?: () => Response | Promise<Response>;
      write?: () => Response | Promise<Response>;
      stepUp?: () => Response | Promise<Response>;
    } = {}
  ) {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/step-up/otp/send'))
        return reply({
          challengeId: '00000000-0000-4000-8000-000000000001',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
          channel: 'email',
        });
      if (String(input).endsWith('/step-up/otp/verify'))
        return (
          options.stepUp?.() ??
          reply({ verified: true, stepUpVerifiedAt: new Date().toISOString() })
        );
      if (String(input).endsWith('/template-variable-choices'))
        return reply([{ eventKey: 'auth.otp', locale: 'en', variables: ['code'] }]);
      if (String(input).endsWith('/template-event-keys'))
        return options.events?.() ?? reply(['auth.otp']);
      if (init?.method && init.method !== 'GET') return options.write?.() ?? reply({});
      return options.list?.() ?? reply([scenario.row]);
    });
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
  }
  const render = async () => {
    await act(async () => root.render(<QueryProvider>{scenario.page}</QueryProvider>));
  };
  it(`${scenario.name}: draft credentials survive read failure and key-order/health refresh`, async () => {
    let failed = false;
    reads({
      list: () =>
        reply(
          [
            {
              ...scenario.row,
              degraded: true,
              maskedConfig: Object.fromEntries(Object.entries(scenario.row.maskedConfig).reverse()),
            },
          ],
          failed ? 503 : 200
        ),
    });
    await render();
    await click(scenario.edit);
    await fill(scenario.label, 'Local draft');
    await fill(scenario.key, 'synthetic-secret');
    failed = true;
    await click('Refresh providers');
    expect(host.querySelector<HTMLInputElement>(scenario.key)!.value).toBe('synthetic-secret');
    expect(host.querySelector<HTMLInputElement>(scenario.label)!.value).toBe('Local draft');
    expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled).toBe(true);
    failed = false;
    await click(scenario.retry);
    expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled).toBe(false);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(scenario.name === 'sms' ? 2 : 1);
  });
  it(`${scenario.name}: changed saved version retains draft but blocks saving`, async () => {
    let changed = false;
    const fetcher = reads({
      list: () =>
        reply([{ ...scenario.row, label: changed ? 'Changed remotely' : scenario.row.label }]),
    });
    await render();
    await click(scenario.edit);
    await fill(scenario.label, 'Local draft');
    changed = true;
    await click('Refresh providers');
    expect(host.textContent).toContain('The saved version changed');
    expect(host.querySelector<HTMLInputElement>(scenario.label)!.value).toBe('Local draft');
    await submit();
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });
  it.each([401, 403])(
    `${scenario.name}: denied read %s removes credentials and accepted rows`,
    async (status) => {
      let denied = false;
      reads({ list: () => reply([scenario.row], denied ? status : 200) });
      await render();
      await click(scenario.edit);
      await fill(scenario.key, 'synthetic-secret');
      denied = true;
      await click('Refresh providers');
      expect(host.querySelector('form')).toBeNull();
      expect(host.querySelector('tbody tr')).toBeNull();
      expect(host.textContent).toContain('access was denied');
      denied = false;
      await click(scenario.retry);
      expect(host.textContent).toContain('Saved provider');
      expect(host.querySelector('form')).toBeNull();
    }
  );
  it(`${scenario.name}: denied direct write clears private editor work`, async () => {
    reads({ write: () => reply({}, 403) });
    await render();
    await click(scenario.edit);
    await fill(scenario.key, 'synthetic-secret');
    await submit();
    await vi.waitFor(() => expect(host.querySelector('form')).toBeNull());
    expect(host.querySelector('tbody tr')).toBeNull();
  });
  it(`${scenario.name}: read recovery retains OTP and pauses its captured command`, async () => {
    let failed = false;
    reads({
      list: () => reply([scenario.row], failed ? 503 : 200),
      write: () => reply({ requiresStepUp: true }, 403),
    });
    await render();
    await click(scenario.edit);
    await submit();
    await click('Send verification code', true);
    await fill('[role=dialog] input[autocomplete=one-time-code]', '123456');
    failed = true;
    await click('Refresh providers', true);
    expect(
      document.querySelector<HTMLInputElement>('[role=dialog] input[autocomplete=one-time-code]')!
        .value
    ).toBe('123456');
    expect(
      document.querySelector<HTMLButtonElement>('[role=dialog] button[type=submit]')!.disabled
    ).toBe(true);
    failed = false;
    await click(scenario.retry, true);
    expect(
      document.querySelector<HTMLButtonElement>('[role=dialog] button[type=submit]')!.disabled
    ).toBe(false);
  });
  it(`${scenario.name}: a changed provider invalidates pending OTP verification`, async () => {
    let changed = false,
      resolve!: (response: Response) => void;
    const fetcher = reads({
      list: () => reply([{ ...scenario.row, status: changed ? 'disabled' : 'draft' }]),
      write: () => reply({ requiresStepUp: true }, 403),
      stepUp: () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    });
    await render();
    await click(scenario.edit);
    await submit();
    await click('Send verification code', true);
    await fill('[role=dialog] input[autocomplete=one-time-code]', '123456');
    await submit(true);
    changed = true;
    await click('Refresh providers', true);
    await act(async () =>
      resolve(reply({ verified: true, stepUpVerifiedAt: new Date().toISOString() }))
    );
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  });
  it(`${scenario.name}: denial during a confirmation clears private work and ignores late responses`, async () => {
    let denied = false,
      resolve!: (response: Response) => void,
      writes = 0;
    reads({
      list: () => reply([scenario.row], denied ? 403 : 200),
      write: () =>
        ++writes === 1
          ? reply({ requiresStepUp: true }, 403)
          : new Promise<Response>((r) => {
              resolve = r;
            }),
    });
    await render();
    await click(scenario.edit);
    await submit();
    await click('Send verification code', true);
    await fill('[role=dialog] input[autocomplete=one-time-code]', '123456');
    await submit(true);
    denied = true;
    await click('Refresh providers', true);
    await act(async () => resolve(reply(scenario.row)));
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('[role=status]')).toBeNull();
  });
}
it('email recipient survives a failed retry and is reset for a changed configuration', async () => {
  let fail = false,
    changed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      reply([{ ...email, label: changed ? 'Changed provider' : email.label }], fail ? 503 : 200)
    )
  );
  await act(async () => root.render(<QueryProvider>{<Email />}</QueryProvider>));
  await fill('tbody input[type=email]', 'staff@example.test');
  fail = true;
  await click('Refresh providers');
  expect(host.querySelector<HTMLInputElement>('tbody input[type=email]')!.value).toBe(
    'staff@example.test'
  );
  fail = false;
  await click('Retry');
  expect(host.querySelector<HTMLInputElement>('tbody input[type=email]')!.value).toBe(
    'staff@example.test'
  );
  changed = true;
  await click('Refresh providers');
  expect(host.querySelector<HTMLInputElement>('tbody input[type=email]')!.value).toBe('');
});
it('SMS event-key retry is independent and preserves mappings through withdrawal', async () => {
  let failed = false,
    withdrawn = false;
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith('/template-variable-choices')
      ? reply([{ eventKey: 'auth.otp', locale: 'en', variables: ['code'] }])
      : String(input).endsWith('/template-event-keys')
        ? reply(withdrawn ? ['invoice.created'] : ['auth.otp'], failed ? 503 : 200)
        : reply([sms])
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<QueryProvider>{<Sms />}</QueryProvider>));
  await click('Edit draft');
  await fill('#sms-key', 'synthetic-secret');
  failed = true;
  await click('Retry event keys');
  expect(host.querySelector<HTMLInputElement>('#sms-key')!.value).toBe('synthetic-secret');
  expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>('input[list=sms-events]')!.value).toBe('auth.otp');
  failed = false;
  withdrawn = true;
  await click('Retry event keys');
  expect(host.textContent).toContain('Some mapped events are no longer available');
  expect(host.querySelector<HTMLInputElement>('input[list=sms-events]')!.value).toBe('auth.otp');
  expect(
    fetcher.mock.calls.filter(
      ([u]) =>
        !String(u).endsWith('/template-event-keys') &&
        !String(u).endsWith('/template-variable-choices')
    )
  ).toHaveLength(1);
  await fill('input[list=sms-events]', 'invoice.created');
  expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled).toBe(false);
});
it('SMS event permission denial hides catalogue and cancels a pending provider read', async () => {
  let deny = false,
    resolve!: (response: Response) => void,
    reads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/template-variable-choices')
        ? reply([{ eventKey: 'auth.otp', locale: 'en', variables: ['code'] }])
        : String(input).endsWith('/template-event-keys')
          ? reply(['auth.otp'], deny ? 403 : 200)
          : ++reads === 1
            ? reply([sms])
            : new Promise<Response>((r) => {
                resolve = r;
              })
    )
  );
  await act(async () => root.render(<QueryProvider>{<Sms />}</QueryProvider>));
  await click('Edit draft');
  await click('Refresh providers');
  deny = true;
  await click('Retry event keys');
  await act(async () => resolve(reply([sms])));
  expect(host.querySelector('form')).toBeNull();
  expect(host.querySelector('tbody tr')).toBeNull();
});
it('SMS event-key failure does not hide the catalogue or prevent opening a local draft', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/template-variable-choices')
        ? reply([{ eventKey: 'auth.otp', locale: 'en', variables: ['code'] }])
        : String(input).endsWith('/template-event-keys')
          ? reply({}, 503)
          : reply([sms])
    )
  );
  await act(async () => root.render(<QueryProvider>{<Sms />}</QueryProvider>));
  expect(host.textContent).toContain('Saved provider');
  await click('Edit draft');
  expect(host.querySelector<HTMLInputElement>('input[list=sms-events]')!.value).toBe('auth.otp');
  expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled).toBe(true);
  await fill('#sms-key', 'synthetic-secret');
  expect(host.querySelector<HTMLInputElement>('#sms-key')!.value).toBe('synthetic-secret');
});
it('SMS preview keeps the selected test event during catalogue recovery', async () => {
  let fail = false;
  const config = {
    ...sms.maskedConfig,
    template_mappings: [
      ...sms.maskedConfig.template_mappings,
      { event_key: 'invoice.created', template_id: '43', variables: { code: 'CODE' } },
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/template-variable-choices')
        ? reply([{ eventKey: 'auth.otp', locale: 'en', variables: ['code'] }])
        : String(input).endsWith('/template-event-keys')
          ? reply(['auth.otp', 'invoice.created'])
          : reply([{ ...sms, maskedConfig: config }], fail ? 503 : 200)
    )
  );
  await act(async () => root.render(<QueryProvider>{<Sms />}</QueryProvider>));
  await click('Test preview');
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('#sms-test-event')!;
    select.value = 'invoice.created';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  fail = true;
  await click('Refresh providers');
  expect(host.querySelector<HTMLSelectElement>('#sms-test-event')!.value).toBe('invoice.created');
  fail = false;
  await click('Try again');
  expect(host.querySelector<HTMLSelectElement>('#sms-test-event')!.value).toBe('invoice.created');
});
it('SMS masked credential rotation invalidates a saved draft without copying it into the editor', async () => {
  let changed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/template-variable-choices')
        ? reply([{ eventKey: 'auth.otp', locale: 'en', variables: ['code'] }])
        : String(input).endsWith('/template-event-keys')
          ? reply(['auth.otp'])
          : reply([
              {
                ...sms,
                maskedConfig: {
                  ...sms.maskedConfig,
                  api_key: changed ? '********next' : '********test',
                },
              },
            ])
    )
  );
  await act(async () => root.render(<QueryProvider>{<Sms />}</QueryProvider>));
  await click('Edit draft');
  expect(host.querySelector<HTMLInputElement>('#sms-key')!.value).toBe('');
  await fill('#sms-key', 'synthetic-secret');
  changed = true;
  await click('Refresh providers');
  expect(host.textContent).toContain('The saved version changed');
  expect(host.querySelector<HTMLInputElement>('#sms-key')!.value).toBe('synthetic-secret');
  expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled).toBe(true);
});
it('email malformed saved configuration shows one recoverable alert without opening defaults', async () => {
  let valid = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply([{ ...email, maskedConfig: valid ? email.maskedConfig : null }]))
  );
  await act(async () => root.render(<QueryProvider>{<Email />}</QueryProvider>));
  await click('Save');
  expect(host.querySelectorAll('[role=alert]')).toHaveLength(1);
  expect(host.querySelector('form')).toBeNull();
  expect(host.querySelector('[role=alert] button')!.textContent).toBe('Retry');
  valid = true;
  await click('Retry');
  await click('Save');
  expect(host.querySelector<HTMLInputElement>('#email-provider-label')!.value).toBe(
    'Saved provider'
  );
});
