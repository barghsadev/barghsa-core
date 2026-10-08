import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { tWorkspace } from '@barghsa/i18n/workspace-admin';
import { QueryProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { OperationalCommandReview } from './OperationalCommandReview.js';
const rows = [
  { id: 'a', kind: 'job' },
  { id: 'b', kind: 'job' },
];
const validate = (v: unknown): v is (typeof rows)[number] =>
  !!v &&
  typeof v === 'object' &&
  'id' in v &&
  'kind' in v &&
  typeof v.id === 'string' &&
  typeof v.kind === 'string';
const identity = (row: (typeof rows)[number]) => JSON.stringify([row.id, row.kind]);
const word = (key: string) => tWorkspace(`admin.operationalReview.${key}`, 'en');
const response = (row: unknown, status = 200) => Response.json(row, { status });
let root: Root | undefined, host: HTMLDivElement;
const denied = vi.fn(),
  reviewed = vi.fn();
function render(account = 'a') {
  root!.render(
    <QueryProvider>
      <AccountUserProvider value={account}>
        <OperationalCommandReview
          locale="en"
          endpoint="/queue"
          rows={rows}
          validate={validate}
          identity={identity}
          onDenied={denied}
          onReviewed={reviewed}
          renderRecord={(row) => (
            <span>
              {row.id}-{row.kind}
            </span>
          )}
        />
      </AccountUserProvider>
    </QueryProvider>
  );
}
function button(key: string) {
  const found = [...document.querySelectorAll('button')].find(
    (node) => node.textContent === word(key)
  );
  expect(found).toBeTruthy();
  return found!;
}
async function mount() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  denied.mockClear();
  reviewed.mockClear();
  await act(async () => render());
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  vi.unstubAllGlobals();
});
it('requires exact target identities, supports missing records and retries only on explicit action', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response({}, 404))
    .mockResolvedValueOnce(response({ id: 'b', kind: 'other' }))
    .mockResolvedValueOnce(response({}, 404))
    .mockResolvedValueOnce(response(rows[1]));
  vi.stubGlobal('fetch', fetch);
  await mount();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(word('error'));
  expect(button('reviewed').disabled).toBe(true);
  window.dispatchEvent(new Event('focus'));
  window.dispatchEvent(new Event('online'));
  await act(async () => {});
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => button('retry').click());
  expect(document.body.textContent).toContain(word('missing'));
  expect(document.body.textContent).toContain('b-job');
  expect(button('reviewed').disabled).toBe(false);
  expect(fetch.mock.calls.map(([path]) => path)).toEqual([
    '/queue/a',
    '/queue/b',
    '/queue/a',
    '/queue/b',
  ]);
  expect(reviewed).not.toHaveBeenCalled();
  await act(async () => button('reviewed').click());
  expect(reviewed).toHaveBeenCalledTimes(1);
});
it('failed groups cancel sibling requests and ignore their delayed denial after a fresh read', async () => {
  let settle!: (value: Response) => void;
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response({}, 503))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        })
    )
    .mockResolvedValueOnce(response(rows[0]))
    .mockResolvedValueOnce(response(rows[1]));
  vi.stubGlobal('fetch', fetch);
  await mount();
  expect((fetch.mock.calls[1]![1].signal as AbortSignal).aborted).toBe(true);
  expect(button('reviewed').disabled).toBe(true);
  await act(async () => button('retry').click());
  expect(button('reviewed').disabled).toBe(false);
  await act(async () => settle(response({}, 403)));
  expect(denied).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('a-job');
  expect(button('reviewed').disabled).toBe(false);
});
it('account changes withdraw saved records and unmount aborts both pending targets', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(rows[0]))
    .mockResolvedValueOnce(response(rows[1]))
    .mockImplementation(() => new Promise<Response>(() => {}));
  vi.stubGlobal('fetch', fetch);
  await mount();
  expect(document.body.textContent).toContain('a-job');
  await act(async () => render('b'));
  expect(document.body.textContent).not.toContain('a-job');
  expect(button('reviewed').disabled).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toBe(word('loading'));
  const signals = fetch.mock.calls.slice(2).map((call) => call[1].signal as AbortSignal);
  expect(signals).toHaveLength(2);
  await act(async () => root!.unmount());
  root = undefined;
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});
