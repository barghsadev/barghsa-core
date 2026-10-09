import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { defaultReminderOffsetToggles } from '@barghsa/shared/finance';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ReminderOffsetTogglePanel from './ReminderOffsetTogglePanel.js';
const language = vi.hoisted(() => ({ value: 'en' as 'en' | 'fa' }));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => language.value }));
const path = '/api/admin/config/invoice-reminder-offsets';
let root: Root, host: HTMLDivElement;
let signal: AbortSignal | undefined, finish: ((value: unknown) => void) | undefined;
let failed: boolean, first: boolean;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  language.value = 'en';
  signal = undefined;
  finish = undefined;
  failed = false;
  first = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(path);
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
      expect(init?.credentials).toBeUndefined();
      if (first) {
        first = false;
        signal = init!.signal as AbortSignal;
        return {
          ok: !failed,
          status: failed ? 500 : 200,
          json: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        } as Response;
      }
      return Response.json(defaultReminderOffsetToggles());
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(present = true, actor = 'staff-one') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {present ? <ReminderOffsetTogglePanel /> : null}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
for (const body of ['matrix', 'error']) {
  it.each(['unmount', 'actor', 'profile-context', 'locale'])(
    'cancels the full reminder ' + body + ' body on %s and refuses obsolete data without writes',
    async (change) => {
      failed = body === 'error';
      await render();
      await vi.waitFor(() => expect(finish).toBeDefined());
      const oldSignal = signal!,
        oldFinish = finish!;
      expect(oldSignal.aborted).toBe(false);
      const reads = vi.mocked(fetch).mock.calls.length;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(fetch).toHaveBeenCalledTimes(reads);
      if (change === 'unmount') await render(false);
      else if (change === 'actor') await render(true, 'staff-two');
      else if (change === 'profile-context') await act(async () => refreshProfileContext());
      else {
        language.value = 'fa';
        await render();
      }
      expect(oldSignal.aborted).toBe(true);
      await act(async () =>
        oldFinish(
          body === 'error'
            ? { message: 'obsolete-private-error' }
            : defaultReminderOffsetToggles().map((row) => ({ ...row, enabled: false }))
        )
      );
      expect(host.textContent).not.toContain('obsolete-private-error');
      expect(host.querySelector('[role=alert]')).toBeNull();
      if (change !== 'unmount') {
        const switches = Array.from(host.querySelectorAll<HTMLInputElement>('[role=switch]'));
        expect(switches).toHaveLength(24);
        expect(switches.every((cell) => cell.checked && !cell.disabled)).toBe(true);
      } else expect(host.children).toHaveLength(0);
      expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
        true
      );
    }
  );
}
it.each(['server message', 'malformed error body'])(
  'retains current %s handling without retry',
  async (kind) => {
    vi.mocked(fetch).mockImplementation(
      async () =>
        ({
          ok: false,
          status: 500,
          json: async () => {
            if (kind === 'malformed error body') throw new SyntaxError('broken JSON');
            return { message: 'current-server-message' };
          },
        }) as Response
    );
    await render();
    await vi.waitFor(() => expect(host.querySelector('[role=alert]')).not.toBeNull());
    expect(host.querySelector('[role=alert]')!.textContent).toBe(
      kind === 'server message'
        ? 'current-server-message'
        : t('admin.invoices.reminders.loadFailed', 'en')
    );
    expect(host.querySelectorAll('[role=switch]')).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  }
);
