import { QueryComponentProvider } from '../test/query-provider.js';
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useOwnedDocumentRead } from './useOwnedDocumentRead.js';
const targets = [
  '/api/profiles',
  '/api/admin/document-retention/policies',
  '/api/admin/document-retention/holds?documentId=document-1',
  '/api/admin/document-retention/destruction',
  ...['document', 'contract', 'image', 'video'].map((category) => '/api/upload/policy/' + category),
  ...['/api/documents', '/api/admin/documents'].flatMap((base) => [
    base + '?businessRecordType=contract&before=cursor-1',
    base + '/document-1',
    base + '/document-1/download',
    base + '/document-1/preview',
  ]),
];
const headers = { 'Content-Type': 'application/json', 'x-csrf-token': 'review-csrf' };
let host: HTMLDivElement, root: Root, signal: AbortSignal, finish: (value: unknown) => void;
let first: boolean;
function Probe({ target, actor, revision }: { target: string; actor: string; revision: number }) {
  const read = useOwnedDocumentRead(
    actor,
    revision,
    target.startsWith('/api/admin/'),
    'profile-1',
    target
  );
  const [shown, setShown] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setShown('');
    void read<{ text: string }>(target, { headers, signal: controller.signal })
      .then(async (packet) => {
        const value = packet;
        if (!controller.signal.aborted) setShown(value.text);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [read, target]);
  return <p>{shown}</p>;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.cookie = 'barghsa_csrf=review-csrf; path=/';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  first = true;
  signal = undefined as unknown as AbortSignal;
  finish = undefined as unknown as (value: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.credentials).toBe('include');
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get('x-csrf-token')).toBe('review-csrf');
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
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
  document.cookie = 'barghsa_csrf=; Max-Age=0; path=/';
  host.remove();
  vi.unstubAllGlobals();
});
for (const target of targets)
  it.each(['unmount', 'actor', 'revision'])(
    'owns full ' + target + ' bytes through %s replacement',
    async (change) => {
      const render = async (actor = 'staff-one', revision = 0, present = true) =>
        act(async () =>
          root.render(
            <QueryComponentProvider>
              {present && <Probe target={target} actor={actor} revision={revision} />}
            </QueryComponentProvider>
          )
        );
      await render();
      await vi.waitFor(() => expect(signal).toBeDefined());
      expect(signal.aborted).toBe(false);
      const oldSignal = signal,
        oldFinish = finish;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      if (change === 'unmount') await render('staff-one', 0, false);
      else if (change === 'actor') await render('staff-two');
      else await render('staff-one', 1);
      expect(oldSignal.aborted).toBe(true);
      await act(async () => oldFinish({ text: 'Private obsolete response' }));
      expect(host.textContent).not.toContain('Private obsolete response');
      if (change !== 'unmount') expect(host.textContent).toContain('Current response');
    }
  );
it.each([
  '/api/admin/documents/document-1/approve',
  '/api/documents/document-1/confirm-upload',
  '/api/admin/documents/document-1/hold',
  '/api/admin/document-retention/holds/hold-1/release',
  '/api/admin/document-retention/destruction/job-1/approve',
])('refuses command %s without dispatch', async (target) => {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <Probe target={target} actor="staff-one" revision={0} />
      </QueryComponentProvider>
    )
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(host.textContent).toBe('');
});
