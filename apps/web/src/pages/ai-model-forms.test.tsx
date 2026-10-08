import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { QueryComponentProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Page from './AdminAiModelsPage.js';
import { aiModel } from '../test/ai-catalogue-fixtures.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
type SchemaModule = typeof import('../lib/catalogue-form-schemas.js');
const harness = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as ((value: unknown) => Promise<void>) | null,
  close: null as (() => void) | null,
  deny: null as (() => void) | null,
  unconfirmed: null as (() => void) | null,
  fields: null as ((fields: unknown[]) => boolean) | null,
  fail: false,
  hold: false,
  release: null as (() => void) | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (value: string) => value }),
}));
vi.mock('../lib/catalogue-form-schemas.js', async (original) => {
  const actual = await original<SchemaModule>();
  return {
    ...actual,
    contentFormSchema: async (...args: Parameters<typeof actual.contentFormSchema>) => {
      if (harness.fail) throw new Error('Private validation detail');
      if (harness.hold)
        await new Promise<void>((resolve) => {
          harness.release = resolve;
        });
      return actual.contentFormSchema(...args);
    },
  };
});
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: {
    action: TeamAction;
    onSuccess: (value: unknown) => Promise<void>;
    onClose: () => void;
    onDenied?: () => void;
    onUnconfirmed?: () => void;
    onValidationError?: (fields: unknown[]) => boolean;
  }) => {
    harness.action = props.action;
    harness.success = props.onSuccess;
    harness.close = props.onClose;
    harness.deny = props.onDenied ?? null;
    harness.unconfirmed = props.onUnconfirmed ?? null;
    harness.fields = props.onValidationError ?? null;
    return <div role="dialog">{props.action.title}</div>;
  },
}));
let host: HTMLDivElement, root: Root, readStatus: number, reads: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(harness, {
    action: null,
    success: null,
    close: null,
    deny: null,
    unconfirmed: null,
    fields: null,
    fail: false,
    hold: false,
    release: null,
  });
  readStatus = 200;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  reads = vi.fn(async () => Response.json([aiModel], { status: readStatus }));
  vi.stubGlobal('fetch', reads);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <Page />
      </QueryComponentProvider>
    )
  );
}
async function click(text: string) {
  const b = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text
  );
  expect(b, text).toBeDefined();
  await act(async () => b!.click());
}
const field = (domain: 'model' | 'budget') =>
  host.querySelector<HTMLInputElement>(
    domain === 'model' ? '#ai-model-max-tokens' : '#ai-model-monthlyCostUsd'
  )!;
async function fill(domain: 'model' | 'budget', value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      field(domain),
      value
    );
    field(domain).dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(domain: 'model' | 'budget') {
  await act(async () =>
    field(domain)
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function proposal() {
  await vi.waitFor(() => expect(harness.action).not.toBeNull());
  return harness.action!;
}
for (const domain of ['model', 'budget'] as const) {
  const open = domain === 'model' ? 'Edit' : 'Configure budget';
  it(`${domain} links invalid feedback and focuses the owning control`, async () => {
    await mount();
    await click(open);
    await fill(domain, domain === 'model' ? '1.5' : '0.0000001');
    await submit(domain);
    await vi.waitFor(() => expect(document.activeElement).toBe(field(domain)));
    expect(field(domain).getAttribute('aria-invalid')).toBe('true');
    expect(harness.action).toBeNull();
    expect(
      document.getElementById(field(domain).getAttribute('aria-describedby')!)?.textContent
    ).toBeTruthy();
  });
  it(`${domain} retries unavailable validation without losing input`, async () => {
    await mount();
    await click(open);
    await fill(domain, domain === 'model' ? '512' : '1.123456');
    harness.fail = true;
    await submit(domain);
    await vi.waitFor(() => expect(host.textContent).toContain('Validation could not load'));
    expect(field(domain).value).toBe(domain === 'model' ? '512' : '1.123456');
    expect(harness.action).toBeNull();
    expect(host.textContent).not.toContain('Private validation detail');
    harness.fail = false;
    await submit(domain);
    expect((await proposal()).successStatus).toBe(200);
  });
  it(`${domain} locks duplicate validation and withdraws it on refresh`, async () => {
    await mount();
    await click(open);
    harness.hold = true;
    await submit(domain);
    await vi.waitFor(() => expect(harness.release).toBeTypeOf('function'));
    expect(field(domain).matches(':disabled')).toBe(true);
    await submit(domain);
    await click('Refresh');
    harness.hold = false;
    await act(async () => harness.release!());
    expect(harness.action).toBeNull();
    await submit(domain);
    await proposal();
  });
  it(`${domain} maps only owned server feedback after confirmation closes`, async () => {
    await mount();
    await click(open);
    await submit(domain);
    await proposal();
    await act(async () => {
      expect(harness.fields!(['__proto__', 'private-server-value'])).toBe(false);
      expect(harness.fields!([domain === 'model' ? 'maxTokens' : 'monthlyCostUsd'])).toBe(true);
      harness.close!();
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(field(domain)));
    expect(field(domain).getAttribute('aria-invalid')).toBe('true');
    expect(host.textContent).not.toContain('private-server-value');
  });
  it(`${domain} freezes mismatched receipts until fresh recovery and reset`, async () => {
    await mount();
    await click(open);
    await fill(domain, domain === 'model' ? '512' : '1.123456');
    await submit(domain);
    await proposal();
    readStatus = 503;
    await act(async () => {
      await expect(harness.success!({})).rejects.toThrow('Unconfirmed');
      harness.unconfirmed!();
    });
    expect(field(domain).value).toBe(domain === 'model' ? '512' : '1.123456');
    await submit(domain);
    expect(host.querySelector('[role=dialog]')).toBeNull();
    await click('Reset model draft');
    expect(field(domain).value).toBe(domain === 'model' ? '512' : '1.123456');
    readStatus = 200;
    await click('Refresh');
    await click('Reset model draft');
    expect(field(domain).value).toBe(domain === 'model' ? '256' : '5');
  });
  it(`${domain} clears private work on denial and ignores a late receipt`, async () => {
    await mount();
    await click(open);
    await submit(domain);
    await proposal();
    const late = harness.success!;
    await act(async () => {
      harness.deny!();
      await late(aiModel);
    });
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('table')).toBeNull();
    expect(host.textContent).not.toContain('Settings saved');
  });
}

async function mountScoped(actor: string, visible = true) {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>{visible ? <Page /> : null}</AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
it('model catalogue reads stay manual and cancel when only the page unmounts', async () => {
  let signal!: AbortSignal;
  const fetcher = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) !== '/api/admin/ai-models') return Promise.resolve(Response.json({}));
    signal = init!.signal as AbortSignal;
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal('fetch', fetcher);
  await mountScoped('staff-a');
  expect(signal.aborted).toBe(false);
  const count = fetcher.mock.calls.filter(([url]) => String(url) === '/api/admin/ai-models').length;
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
  });
  expect(fetcher.mock.calls.filter(([url]) => String(url) === '/api/admin/ai-models')).toHaveLength(
    count
  );
  await mountScoped('staff-a', false);
  expect(signal.aborted).toBe(true);
});
it('model account replacement cancels body consumption and refuses private late data', async () => {
  let pending = true;
  let signal!: AbortSignal, finish!: (value: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) !== '/api/admin/ai-models') return Response.json({});
      if (!pending) return Response.json([{ ...aiModel, title: 'New staff model' }]);
      signal = init!.signal as AbortSignal;
      const response = Response.json([aiModel]);
      response.json = () =>
        new Promise((done) => {
          finish = done;
        });
      return response;
    })
  );
  await mountScoped('staff-a');
  pending = false;
  await mountScoped('staff-b');
  expect(signal.aborted).toBe(true);
  expect(host.textContent).toContain('New staff model');
  await act(async () => finish([{ ...aiModel, title: 'Old private model' }]));
  expect(host.textContent).not.toContain('Old private model');
  expect(host.textContent).toContain('New staff model');
});
it('model context replacement withdraws private token, budget draft and frozen command', async () => {
  await mountScoped('staff-a');
  await click('Add model');
  const token = host.querySelector<HTMLInputElement>('#ai-model-token')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      token,
      'private-draft-token'
    );
    token.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Configure budget');
  await fill('budget', '99');
  await click('Test connection');
  await vi.waitFor(() => expect(harness.action).not.toBeNull());
  const oldSuccess = harness.success!;
  await act(async () => refreshProfileContext());
  expect(host.querySelector('#ai-model-token')).toBeNull();
  expect(host.querySelector('#ai-model-monthlyCostUsd')).toBeNull();
  expect(host.querySelector('[role=dialog]')).toBeNull();
  await act(async () =>
    oldSuccess({ test: { ok: true, responsePreview: 'Old private completion' } })
  );
  expect(host.textContent).not.toContain('Old private completion');
});
