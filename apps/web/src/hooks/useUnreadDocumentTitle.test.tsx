import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useUnreadDocumentTitle } from './useUnreadDocumentTitle.js';

let root: Root, host: HTMLDivElement;
let hidden = true;
function Consumer({ count, formatted }: { count: number; formatted: string }) {
  useUnreadDocumentTitle(count, formatted);
  return null;
}
async function render(count: number, formatted = String(count)) {
  await act(async () =>
    root.render(
      <StrictMode>
        <Consumer count={count} formatted={formatted} />
      </StrictMode>
    )
  );
}
beforeEach(() => {
  hidden = true;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  document.title = 'Barghsa';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it('uses formatted counts and restores the title on visibility changes and zero counts', async () => {
  await render(12, '۱۲');
  expect(document.title).toBe('(۱۲) Barghsa');
  hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  expect(document.title).toBe('Barghsa');
  hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  expect(document.title).toBe('(۱۲) Barghsa');
  await render(3, '۳');
  expect(document.title).toBe('(۳) Barghsa');
  await render(0, '۰');
  expect(document.title).toBe('Barghsa');
});

it('preserves a legitimate numeric prefix in the application title', async () => {
  document.title = '(2026) Barghsa';
  await render(2);
  expect(document.title).toBe('(2) (2026) Barghsa');
  await render(0);
  expect(document.title).toBe('(2026) Barghsa');
});

it('reapplies the unread count after a late branding or route title change', async () => {
  await render(2);
  await act(async () => {
    document.title = 'New brand';
  });
  expect(document.title).toBe('(2) New brand');
  await render(0);
  expect(document.title).toBe('New brand');
});

it('cleans up its own prefix without overwriting an external title awaiting observation', async () => {
  await render(2);
  await act(async () => root.render(null));
  expect(document.title).toBe('Barghsa');
  await render(4);
  await act(async () => {
    document.title = 'External title';
    root.unmount();
  });
  expect(document.title).toBe('External title');
  root = createRoot(host);
});
