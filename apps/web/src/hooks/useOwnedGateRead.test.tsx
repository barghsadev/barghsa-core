import { QueryComponentProvider } from '../test/query-provider.js';
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useOwnedGateRead } from './useOwnedGateRead.js';
let host: HTMLDivElement,
  root: Root,
  signal: AbortSignal,
  finish: (value: unknown) => void,
  first: boolean;
function Probe({
  path,
  actor,
  revision,
  method,
  body,
}: {
  path: string;
  actor: string;
  revision: number;
  method?: string | undefined;
  body?: string | undefined;
}) {
  const read = useOwnedGateRead(JSON.stringify([actor, revision]), actor, revision);
  const [shown, setShown] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setShown('');
    void read(path, {
      signal: controller.signal,
      ...(method === undefined ? {} : { method }),
      ...(body === undefined ? {} : { body }),
    })
      .then(async (packet) => {
        const data = (await packet.json()) as { text: string };
        if (!controller.signal.aborted) setShown(data.text);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [read, path, method, body]);
  return <p>{shown}</p>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  first = true;
  signal = undefined as unknown as AbortSignal;
  finish = undefined as unknown as (value: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBeUndefined();
      expect(init?.headers).toBeUndefined();
      expect(init?.body).toBeUndefined();
      expect(init?.method).toBeUndefined();
      if (first) {
        first = false;
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
      return Response.json({ text: 'Current response' });
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
for (const path of ['/api/auth/user', '/api/telegram/link', '/api/tos/current?locale=en'])
  it.each(['unmount', 'actor', 'revision'])(
    `owns full native ${path} JSON on %s`,
    async (change) => {
      const render = async (present = true, actor = 'account-one', revision = 0) =>
        act(async () =>
          root.render(
            <QueryComponentProvider>
              {present && <Probe path={path} actor={actor} revision={revision} />}
            </QueryComponentProvider>
          )
        );
      await render();
      await vi.waitFor(() => expect(finish).toBeDefined());
      const oldSignal = signal,
        oldFinish = finish;
      expect(oldSignal.aborted).toBe(false);
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      if (change === 'unmount') await render(false);
      else if (change === 'actor') await render(true, 'account-two');
      else await render(true, 'account-one', 1);
      expect(oldSignal.aborted).toBe(true);
      await act(async () => oldFinish({ text: 'obsolete-private-response' }));
      expect(host.textContent).not.toContain('obsolete-private');
      if (change !== 'unmount') expect(host.textContent).toContain('Current response');
    }
  );
it.each([
  ['/api/tos/accept/version-one', undefined, undefined],
  ['/api/telegram/link/confirm', undefined, undefined],
  ['/api/auth/step-up', undefined, undefined],
  ['/api/telegram/link', 'POST', undefined],
  ['/api/telegram/link', 'DELETE', undefined],
  ['/api/auth/user', undefined, ''],
])('refuses unsupported gate request %s %s %s without dispatch', async (path, method, body) => {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <Probe path={path!} actor="account-one" revision={0} method={method} body={body} />
      </QueryComponentProvider>
    )
  );
  expect(fetch).not.toHaveBeenCalled();
});
