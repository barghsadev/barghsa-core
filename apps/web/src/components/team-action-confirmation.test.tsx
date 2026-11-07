import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { connectToast, toast } from '../lib/toast-api.js';
import { refreshProfileContext } from '../lib/profile-context.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: String }),
}));
vi.mock('./StepUpAuthGate.js', () => ({
  StepUpAuthGate: ({
    disabled,
    onVerified,
  }: {
    disabled: boolean;
    onVerified: () => Promise<void>;
  }) => (
    <button disabled={disabled} onClick={() => void onVerified()}>
      Verify OTP
    </button>
  ),
}));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const command: TeamAction = {
  title: 'Cancel contract',
  description: 'Reviewed refund',
  path: '/api/test-command',
  method: 'POST',
  risk: 'both',
};
function button(label: string) {
  return [...document.querySelectorAll('button')].find((v) => v.textContent === label)!;
}
async function fill(selector: string, value: string) {
  await act(async () => {
    const input = document.querySelector(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function approve() {
  await fill('[data-slot=destructive-confirmation] input', 'CONFIRM');
  await act(async () => document.querySelector<HTMLElement>('[role=checkbox]')!.click());
}

it('refuses forged submit events and releases one captured command only after both approvals', async () => {
  const fetch = vi.fn(async (_url: string) => Response.json({ id: 'verified' }));
  vi.stubGlobal('fetch', fetch);
  const done = vi.fn(async () => {});
  await act(async () =>
    root.render(<TeamActionDialog action={command} onClose={() => {}} onSuccess={done} />)
  );
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(button('Confirm').disabled).toBe(true);
  await approve();
  await act(async () => {
    button('Confirm').click();
    button('Confirm').click();
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toBe(command.path);
  expect(done).toHaveBeenCalledWith({ id: 'verified' });
});

it('withdraws approval on an intent change while password verification is pending', async () => {
  let resolve!: (value: Response) => void;
  const fetch = vi.fn((url: string) =>
    url === '/api/auth/step-up'
      ? new Promise<Response>((done) => {
          resolve = done;
        })
      : Promise.resolve(Response.json({}))
  );
  vi.stubGlobal('fetch', fetch);
  const action = { ...command, requiresPassword: true };
  const render = (current: TeamAction) =>
    act(async () =>
      root.render(
        <TeamActionDialog action={current} onClose={() => {}} onSuccess={async () => {}} />
      )
    );
  await render(action);
  await approve();
  await fill('input[type=password]', 'password');
  await act(async () => button('Confirm').click());
  expect(fetch).toHaveBeenCalledTimes(1);
  await render({ ...action, path: '/api/different-command' });
  await act(async () => resolve(Response.json({ verified: true })));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(button('Confirm').disabled).toBe(true);
});

it('gates OTP continuation and resets approval on a changed review', async () => {
  const fetch = vi.fn(async (_url: string) => Response.json({}));
  vi.stubGlobal('fetch', fetch);
  const render = (action: TeamAction) =>
    act(async () =>
      root.render(
        <TeamActionDialog action={action} onClose={() => {}} onSuccess={async () => {}} />
      )
    );
  const action = { ...command, requiresOtp: true };
  await render(action);
  expect(button('Verify OTP').disabled).toBe(true);
  await approve();
  expect(button('Verify OTP').disabled).toBe(false);
  await render({ ...action, body: { expectedReviewHash: 'new-review' } });
  expect(button('Verify OTP').disabled).toBe(true);
  await act(async () => button('Verify OTP').click());
  expect(fetch).not.toHaveBeenCalled();
  await approve();
  await act(async () => button('Verify OTP').click());
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['matched', 'unconfirmed', 'retired'] as const)(
  'reports only a current verified command result (%s)',
  async (outcome) => {
    toast.dismiss();
    const success = vi.fn(),
      warning = vi.fn();
    const disconnect = connectToast({
      success,
      warning,
      error: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(),
      dismiss: vi.fn(),
    });
    try {
      let finish!: (value: Response) => void;
      const fetch = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          })
      );
      vi.stubGlobal('fetch', fetch);
      const accepted = vi.fn(async (receipt: unknown) => {
        if ((receipt as { id?: string }).id !== 'expected') throw new Error('private mismatch');
        return 'Update recorded';
      });
      const uncertain = vi.fn();
      await act(async () =>
        root.render(
          <TeamActionDialog
            action={command}
            onClose={() => {}}
            onSuccess={accepted}
            onUnconfirmed={uncertain}
          />
        )
      );
      await approve();
      await act(async () => button('Confirm').click());
      if (outcome === 'retired') await act(async () => refreshProfileContext());
      await act(async () =>
        finish(Response.json({ id: outcome === 'unconfirmed' ? 'other' : 'expected' }))
      );
      expect(fetch).toHaveBeenCalledOnce();
      if (outcome === 'retired') expect(accepted).not.toHaveBeenCalled();
      if (outcome === 'matched') expect(success).toHaveBeenCalledWith('Update recorded', undefined);
      else expect(success).not.toHaveBeenCalled();
      if (outcome === 'unconfirmed') {
        expect(uncertain).toHaveBeenCalledOnce();
        expect(warning).toHaveBeenCalledWith(
          'The outcome is unconfirmed. Check the current status before trying again.',
          undefined
        );
      } else expect(warning).not.toHaveBeenCalled();
    } finally {
      disconnect();
      toast.dismiss();
    }
  }
);
