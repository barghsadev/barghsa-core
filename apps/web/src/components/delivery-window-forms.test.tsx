import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Panel from './DeliveryWindowConfigPanel.js';
import type { TeamAction } from './TeamActionDialog.js';
interface Command {
  action: TeamAction;
  onClose: () => void;
  onSuccess: (v: unknown) => Promise<void>;
  onValidationError: (fields: unknown[]) => boolean;
  onDenied: () => void;
}
const harness = vi.hoisted(() => ({ command: null as Command | null }));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: (props: Command) => {
    harness.command = props;
    return <div data-testid="command" />;
  },
}));
const initial = { timezone: 'UTC', startHour: 9, endHour: 21 };
let host: HTMLDivElement,
  root: Root,
  config: unknown,
  readStatus: number,
  writeStatus: number,
  receipt: unknown;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.command = null;
  config = { ...initial };
  readStatus = writeStatus = 200;
  receipt = { ...initial, startHour: 10 };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_: string, init?: RequestInit) =>
      Response.json(init?.method ? receipt : config, {
        status: init?.method ? writeStatus : readStatus,
      })
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const field = (name: string) => host.querySelector<HTMLInputElement>(`#delivery-window-${name}`)!;
async function mount() {
  await act(async () => root.render(<QueryProvider>{<Panel uiLocale="en" />}</QueryProvider>));
  await vi.waitFor(() => expect(field('start')?.value).toBe('09:00'));
}
async function fill(name: string, value: string) {
  await act(async () => {
    const el = field(name);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(name: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}
async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
const writes = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method);
it('focuses linked range feedback and retains the valid start time', async () => {
  await mount();
  await fill('start', '10:00');
  await fill('end', '12:00');
  await submit();
  await vi.waitFor(() => expect(field('end').getAttribute('aria-invalid')).toBe('true'));
  expect(field('start').value).toBe('10:00');
  expect(writes()).toHaveLength(0);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.activeElement).toBe(field('end'));
  });
});
it('retains raw edits through failed reads and unchanged retry, then requires reset for a changed basis', async () => {
  await mount();
  await fill('start', '10:00');
  readStatus = 500;
  await click('Refresh delivery settings');
  expect(field('start').value).toBe('10:00');
  await submit();
  expect(writes()).toHaveLength(0);
  readStatus = 200;
  await click('Refresh delivery settings');
  expect(field('start').value).toBe('10:00');
  config = { ...initial, endHour: 22 };
  await click('Refresh delivery settings');
  expect(field('start').value).toBe('10:00');
  expect(field('start').matches(':disabled')).toBe(true);
  await click('Reset to saved values');
  expect(field('start').value).toBe('09:00');
  expect(field('end').value).toBe('22:00');
});
it('maps only owned field errors while retaining edits and refusing arbitrary server names', async () => {
  await mount();
  await fill('start', '10:00');
  writeStatus = 400;
  receipt = { error: { fields: ['endHour'] } };
  await submit();
  await vi.waitFor(() => expect(field('end').getAttribute('aria-invalid')).toBe('true'));
  expect(field('start').value).toBe('10:00');
  receipt = { error: { fields: ['secretToken'] } };
  await submit();
  await vi.waitFor(() => expect(host.textContent).toContain('Failed to save'));
  expect(host.textContent).not.toContain('secretToken');
});
it('freezes a mismatched receipt until an authoritative refresh and explicit reset', async () => {
  await mount();
  await fill('start', '10:00');
  receipt = { ...initial, startHour: 11 };
  await submit();
  await vi.waitFor(() => expect(host.textContent).toContain('could not be verified'));
  expect(field('start').value).toBe('10:00');
  const reset = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === 'Reset to saved values'
  )!;
  expect(reset.disabled).toBe(true);
  await submit();
  expect(writes()).toHaveLength(1);
  config = { ...initial, startHour: 11 };
  await click('Refresh delivery settings');
  expect(field('start').value).toBe('10:00');
  await click('Reset to saved values');
  expect(field('start').value).toBe('11:00');
});
it('captures exact step-up values and maps retry validation back to the unlocked form', async () => {
  await mount();
  await fill('start', '10:00');
  writeStatus = 403;
  receipt = { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } };
  await submit();
  await vi.waitFor(() => expect(harness.command).not.toBeNull());
  expect(harness.command!.action.body).toEqual({ timezone: 'UTC', start_hour: 10, end_hour: 21 });
  expect(field('start').matches(':disabled')).toBe(true);
  await act(async () => {
    expect(harness.command!.onValidationError(['endHour'])).toBe(true);
    harness.command!.onClose();
  });
  expect(field('start').matches(':disabled')).toBe(false);
  expect(field('start').value).toBe('10:00');
});
it('withdraws step-up work after changed saved settings, retaining the draft', async () => {
  await mount();
  await fill('start', '10:00');
  writeStatus = 403;
  receipt = { requiresStepUp: true };
  await submit();
  await vi.waitFor(() => expect(harness.command).not.toBeNull());
  config = { ...initial, endHour: 22 };
  await click('Refresh delivery settings');
  expect(host.querySelector('[data-testid=command]')).toBeNull();
  expect(field('start').value).toBe('10:00');
  expect(field('start').matches(':disabled')).toBe(true);
});
it('clears private drafts on denial and ignores a late write receipt', async () => {
  await mount();
  await fill('start', '10:00');
  let resolve!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation(async (_path, init) =>
    init?.method
      ? new Promise<Response>((done) => {
          resolve = done;
        })
      : Response.json(config, { status: readStatus })
  );
  await submit();
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  readStatus = 403;
  await click('Refresh delivery settings');
  await act(async () => resolve(Response.json({ ...initial, startHour: 10 })));
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).toContain('no longer have access');
});
it('does not treat a refresh before an outstanding write settles as authoritative recovery', async () => {
  await mount();
  await fill('start', '10:00');
  let resolve!: (r: Response) => void;
  vi.mocked(fetch).mockImplementation(async (_path, init) =>
    init?.method
      ? new Promise<Response>((done) => {
          resolve = done;
        })
      : Response.json(config)
  );
  await submit();
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  await click('Refresh delivery settings');
  expect(field('start').matches(':disabled')).toBe(true);
  config = { ...initial, startHour: 10 };
  await act(async () => resolve(Response.json(config)));
  const reset = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === 'Reset to saved values'
  )!;
  expect(reset.disabled).toBe(true);
  await submit();
  expect(writes()).toHaveLength(1);
  await click('Refresh delivery settings');
  await click('Reset to saved values');
  expect(field('start').value).toBe('10:00');
});
