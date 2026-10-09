import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AdminSolarPostalPage } from './AdminSolarPostalPage.js';
import { solarPostal, solarGuidance } from '../test/solar-staff-fixtures.js';
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ status: 'ready', timezone: 'UTC', format: String, notice: null }),
}));
let root: Root,
  host: HTMLDivElement,
  held: boolean,
  endpoint: string,
  signal: AbortSignal,
  finish: (value: unknown) => void;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  held = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      expect(init?.credentials).toBe('include');
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
      if (path.startsWith(endpoint) && !held) {
        held = true;
        signal = init!.signal as AbortSignal;
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        } as Response;
      }
      if (path.startsWith('/api/admin/solar/postal-queue?'))
        return Response.json({ requests: [], nextBefore: null });
      if (path === '/api/admin/solar/postal-guidance') return Response.json(solarGuidance);
      throw Error('Unexpected read ' + path);
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
          {present && <AdminSolarPostalPage />}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
for (const path of ['/api/admin/solar/postal-queue?', '/api/admin/solar/postal-guidance'])
  it.each(['unmount', 'actor', 'profile-context'])(
    'withdraws full postal ' + path + ' bytes on %s without private work or commands',
    async (change) => {
      endpoint = path;
      await render();
      expect(held).toBe(true);
      expect(signal.aborted).toBe(false);
      const oldSignal = signal,
        oldFinish = finish;
      const reads = vi.mocked(fetch).mock.calls.length;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(fetch).toHaveBeenCalledTimes(reads);
      if (change === 'unmount') await render(false);
      else if (change === 'actor') await render(true, 'staff-two');
      else await act(async () => refreshProfileContext());
      expect(oldSignal.aborted).toBe(true);
      await act(async () =>
        oldFinish(
          path.includes('queue')
            ? {
                requests: [{ ...solarPostal(), profile_name: 'Private obsolete' }],
                nextBefore: null,
              }
            : { ...solarGuidance, en: 'Private obsolete', destinationAddress: 'Private obsolete' }
        )
      );
      expect(host.textContent).not.toContain('Private obsolete');
      expect(host.querySelector<HTMLTextAreaElement>('#solar-postal-guidance-en')?.value).not.toBe(
        'Private obsolete'
      );
      if (change !== 'unmount')
        expect(
          vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith(path))
        ).toHaveLength(2);
      expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
        true
      );
    }
  );
