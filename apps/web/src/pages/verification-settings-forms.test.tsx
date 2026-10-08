import { QueryProvider } from '../test/query-provider.js';
import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Page from './AdminVerificationConfig.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import type { OtpConfig, VerificationConfig } from '../lib/verification-settings-form.js';
type SchemaModule = typeof import('../lib/catalogue-form-schemas.js');
const harness = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as ((value: unknown) => Promise<void>) | null,
  close: null as (() => void) | null,
  deny: null as (() => void) | null,
  unconfirmed: null as (() => void) | null,
  fields: null as ((fields: unknown[]) => boolean) | null,
  pending: null as ((value: boolean) => void) | null,
  disabled: false,
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
      if (harness.fail) throw new Error('Unavailable validation');
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
    onPendingChange?: (pending: boolean) => void;
    confirmationDisabled: boolean;
  }) => {
    harness.action = props.action;
    harness.success = props.onSuccess;
    harness.close = props.onClose;
    harness.deny = props.onDenied ?? null;
    harness.unconfirmed = props.onUnconfirmed ?? null;
    harness.fields = props.onValidationError ?? null;
    harness.pending = props.onPendingChange ?? null;
    harness.disabled = props.confirmationDisabled;
    return <div role="dialog">{props.action.title}</div>;
  },
}));
let host: HTMLDivElement, root: Root;
let verification: VerificationConfig, otp: OtpConfig;
let readStatus: number, writeStatus: number, receipt: unknown, writes: unknown[];
let heldWrite: Promise<Response> | null;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  verification = { mode: 'DISABLED', draft: null, version: 4 };
  otp = { ttlSeconds: 300, version: 2 };
  readStatus = writeStatus = 200;
  receipt = undefined;
  heldWrite = null;
  writes = [];
  Object.assign(harness, {
    action: null,
    success: null,
    close: null,
    deny: null,
    unconfirmed: null,
    fields: null,
    pending: null,
    disabled: false,
    fail: false,
    hold: false,
    release: null,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        writes.push(body);
        if (heldWrite) return heldWrite;
        if (writeStatus === 200 && receipt === undefined)
          verification = { ...verification, draft: body.mode, version: body.expectedVersion + 1 };
        return Response.json(receipt ?? verification, { status: writeStatus });
      }
      return Response.json(path.endsWith('/otp') ? otp : verification, { status: readStatus });
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => root.render(<QueryProvider>{<Page />}</QueryProvider>));
}
const ttl = () => host.querySelector<HTMLInputElement>('#otp-lifetime')!;
const selected = () => host.querySelector<HTMLInputElement>('#verification-mode-MANUAL')!;
async function fill(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(ttl(), value);
    ttl().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function edit(domain: 'verification' | 'otp') {
  if (domain === 'otp') await fill('120');
  else await act(async () => selected().click());
}
async function submit(domain: 'verification' | 'otp') {
  await act(async () =>
    (domain === 'otp' ? ttl() : selected())
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function proposal() {
  await vi.waitFor(() => expect(harness.action).not.toBeNull());
  return harness.action!;
}
async function focus(node: () => HTMLElement) {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.activeElement).toBe(node());
  });
}
it('never displays the initial manual choice before saved disabled settings hydrate', async () => {
  const choices: boolean[] = [];
  await act(async () =>
    root.render(
      <QueryProvider>
        {
          <Profiler
            id="verification-hydration"
            onRender={() => choices.push(selected()?.checked ?? false)}
          >
            <Page />
          </Profiler>
        }
      </QueryProvider>
    )
  );
  expect(choices).not.toContain(true);
  expect(host.querySelector<HTMLInputElement>('#verification-mode-DISABLED')!.checked).toBe(true);
});
it.each(['', '59', '901', '60.5'])(
  'OTP %s links validation feedback and preserves a verification draft',
  async (value) => {
    await mount();
    await edit('verification');
    await fill(value);
    await submit('otp');
    await focus(ttl);
    expect(ttl().getAttribute('aria-invalid')).toBe('true');
    expect(selected().checked).toBe(true);
    expect(harness.action).toBeNull();
    expect(writes).toHaveLength(0);
    expect(
      document.getElementById(ttl().getAttribute('aria-describedby')!.split(' ')[0]!)?.textContent
    ).toContain('60');
  }
);
it('saves a draft before capturing password-protected activation of the saved revision', async () => {
  await mount();
  await fill('180');
  await edit('verification');
  await submit('verification');
  await vi.waitFor(() =>
    expect(host.textContent).toContain('Active verification mode is unchanged')
  );
  expect(writes).toEqual([{ mode: 'MANUAL', expectedVersion: 4, action: 'draft' }]);
  expect(ttl().value).toBe('180');
  await click('Activate draft');
  expect(await proposal()).toMatchObject({
    requiresPassword: true,
    successStatus: 200,
    body: { mode: 'MANUAL', expectedVersion: 5, action: 'activate' },
  });
  verification = { mode: 'MANUAL', draft: null, version: 6 };
  await act(async () => {
    await harness.success!(verification);
    harness.close!();
  });
  expect(host.textContent).toContain('Verification mode activated');
  expect(ttl().value).toBe('180');
});
it('maps only owned draft fields and focuses the selected radio without echoing server text', async () => {
  await mount();
  await edit('verification');
  writeStatus = 400;
  receipt = {
    error: { code: 'VALIDATION:INPUT:INVALID', fields: ['mode'], message: 'private-value' },
  };
  await submit('verification');
  await focus(selected);
  expect(selected().checked).toBe(true);
  expect(selected().closest('fieldset')!.getAttribute('aria-invalid')).toBe('true');
  expect(host.textContent).not.toContain('private-value');
  receipt = {
    error: { code: 'VALIDATION:INPUT:INVALID', fields: ['__proto__'], message: 'private-value' },
  };
  await submit('verification');
  await vi.waitFor(() => expect(host.textContent).toContain('Could not confirm the change'));
  expect(host.textContent).not.toContain('__proto__');
});
for (const domain of ['verification', 'otp'] as const) {
  const reload = domain === 'otp' ? 'Reload code settings' : 'Reload verification settings';
  it(`${domain} retains a draft across failed and changed reads until explicit reset`, async () => {
    await mount();
    await edit(domain);
    readStatus = 503;
    await click(reload);
    expect(domain === 'otp' ? ttl().value : selected().checked).toBe(
      domain === 'otp' ? '120' : true
    );
    await submit(domain);
    expect(writes).toHaveLength(0);
    expect(harness.action).toBeNull();
    readStatus = 200;
    verification = { mode: 'DISABLED', draft: null, version: 7 };
    otp = { ttlSeconds: 180, version: 6 };
    await click(reload);
    expect(host.textContent).toContain('Saved settings changed');
    expect(domain === 'otp' ? ttl().value : selected().checked).toBe(
      domain === 'otp' ? '120' : true
    );
    await click('Reset to saved settings');
    expect(domain === 'otp' ? ttl().value : selected().checked).toBe(
      domain === 'otp' ? '180' : false
    );
  });
  it(`${domain} retries unavailable validation with its original entries`, async () => {
    await mount();
    await edit(domain);
    harness.fail = true;
    await submit(domain);
    await vi.waitFor(() => expect(host.textContent).toContain('Validation is unavailable'));
    expect(writes).toHaveLength(0);
    expect(harness.action).toBeNull();
    harness.fail = false;
    await submit(domain);
    if (domain === 'otp')
      expect((await proposal()).body).toEqual({ ttlSeconds: 120, expectedVersion: 2 });
    else await vi.waitFor(() => expect(writes).toHaveLength(1));
  });
  it(`${domain} locks duplicate submissions before validation and cancels when refreshed`, async () => {
    await mount();
    await edit(domain);
    harness.hold = true;
    await submit(domain);
    await vi.waitFor(() => expect(harness.release).toBeTypeOf('function'));
    expect((domain === 'otp' ? ttl() : selected()).matches(':disabled')).toBe(true);
    await submit(domain);
    expect(writes).toHaveLength(0);
    await click(reload);
    harness.hold = false;
    await act(async () => harness.release!());
    expect(writes).toHaveLength(0);
    expect(harness.action).toBeNull();
    await submit(domain);
    if (domain === 'otp') await proposal();
    else await vi.waitFor(() => expect(writes).toHaveLength(1));
  });
}
it('unverified draft receipt freezes writes until a successful read and explicit reset', async () => {
  await mount();
  await edit('verification');
  receipt = {};
  readStatus = 503;
  await submit('verification');
  await vi.waitFor(() => expect(host.textContent).toContain('could not be confirmed'));
  expect(selected().checked).toBe(true);
  await click('Reset to saved settings');
  await submit('verification');
  expect(writes).toHaveLength(1);
  readStatus = 200;
  verification = { mode: 'DISABLED', draft: 'MANUAL', version: 5 };
  await click('Reload verification settings');
  await click('Reset to saved settings');
  await click('Activate draft');
  expect((await proposal()).body).toMatchObject({ expectedVersion: 5 });
});
it('OTP rejects mismatched receipts and freezes confirmation until fresh-read reset', async () => {
  await mount();
  await edit('otp');
  await submit('otp');
  await proposal();
  await expect(harness.success!({ ttlSeconds: 120, version: 8 })).rejects.toThrow('Unconfirmed');
  readStatus = 503;
  await act(async () => harness.unconfirmed!());
  expect(harness.disabled).toBe(true);
  expect(ttl().value).toBe('120');
  await act(async () => harness.close!());
  await click('Reset to saved settings');
  expect(ttl().value).toBe('120');
  otp = { ttlSeconds: 120, version: 3 };
  readStatus = 200;
  await click('Reload code settings');
  await click('Reset to saved settings');
  await fill('180');
  await submit('otp');
  expect((await proposal()).body).toEqual({ ttlSeconds: 180, expectedVersion: 3 });
});
it('OTP owned field feedback returns focus after confirmation and preserves the companion draft', async () => {
  await mount();
  await edit('verification');
  await edit('otp');
  await submit('otp');
  await proposal();
  await act(async () => {
    expect(harness.fields!(['ttlSeconds'])).toBe(true);
    harness.close!();
  });
  await focus(ttl);
  expect(selected().checked).toBe(true);
  expect(ttl().value).toBe('120');
  expect(harness.fields!(['__proto__'])).toBe(false);
});
it('current denial discards OTP entries and prevents late completion from restoring them', async () => {
  await mount();
  await edit('otp');
  await submit('otp');
  await proposal();
  const complete = harness.success!;
  await act(async () => harness.deny!());
  await act(async () => complete({ ttlSeconds: 120, version: 3 }));
  expect(ttl().value).toBe('');
  expect(host.textContent).not.toContain('Code expiry updated.');
  expect(selected().matches(':disabled')).toBe(false);
});
it('a protected command cannot be withdrawn by refresh while its network request is pending', async () => {
  await mount();
  await edit('otp');
  await submit('otp');
  await proposal();
  await act(async () => harness.pending!(true));
  await click('Reload code settings');
  expect(host.querySelector('[role=dialog]')).not.toBeNull();
  otp = { ttlSeconds: 120, version: 3 };
  await act(async () => {
    await harness.success!(otp);
    harness.close!();
  });
  expect(host.textContent).toContain('Code expiry updated.');
});
it('draft network locking rejects a second save and late denial never announces success', async () => {
  let complete!: (value: Response) => void;
  heldWrite = new Promise((resolve) => {
    complete = resolve;
  });
  await mount();
  await edit('verification');
  await submit('verification');
  await vi.waitFor(() => expect(writes).toHaveLength(1));
  await click('Reload verification settings');
  await submit('verification');
  expect(writes).toHaveLength(1);
  await act(async () => complete(Response.json({}, { status: 403 })));
  expect(selected().checked).toBe(false);
  expect(host.textContent).not.toContain('Draft saved');
  expect(ttl().value).toBe('300');
});
it('a draft receipt with an unexpected success status cannot announce a confirmed save', async () => {
  await mount();
  await edit('verification');
  writeStatus = 201;
  receipt = { mode: 'DISABLED', draft: 'MANUAL', version: 5 };
  await submit('verification');
  await vi.waitFor(() => expect(host.textContent).toContain('could not be confirmed'));
  expect(host.textContent).not.toContain('Draft saved');
  expect(selected().checked).toBe(true);
});
for (const domain of ['verification', 'otp'] as const)
  for (const recovery of ['changed', 'denied'] as const)
    it(`${domain} withdraws a captured command after ${recovery} reads and ignores its late receipt`, async () => {
      verification = { mode: 'DISABLED', draft: 'MANUAL', version: 4 };
      await mount();
      if (domain === 'otp') {
        await edit(domain);
        await submit(domain);
      } else await click('Activate draft');
      await proposal();
      const complete = harness.success!;
      if (recovery === 'denied') readStatus = 403;
      else {
        verification = { mode: 'DISABLED', draft: 'MANUAL', version: 8 };
        otp = { ttlSeconds: 180, version: 7 };
      }
      await click(domain === 'otp' ? 'Reload code settings' : 'Reload verification settings');
      expect(host.querySelector('[role=dialog]')).toBeNull();
      await act(async () =>
        complete(
          domain === 'otp'
            ? { ttlSeconds: 120, version: 3 }
            : { mode: 'MANUAL', draft: null, version: 5 }
        )
      );
      expect(host.textContent).not.toContain(
        domain === 'otp' ? 'Code expiry updated.' : 'Verification mode activated'
      );
      if (recovery === 'denied')
        expect(domain === 'otp' ? ttl().value : selected().checked).toBe(
          domain === 'otp' ? '' : false
        );
      else expect(host.textContent).toContain('Saved settings changed');
    });
