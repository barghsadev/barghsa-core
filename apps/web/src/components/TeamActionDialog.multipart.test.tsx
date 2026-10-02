import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TeamActionDialog } from './TeamActionDialog.js';

vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: (value: number) => String(value) }),
}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  document.cookie = 'barghsa_csrf=test-token';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.cookie = 'barghsa_csrf=; Max-Age=0';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('submits a captured multipart action with CSRF and a browser-generated boundary', async () => {
  const body = new FormData();
  body.set('changeSummary', 'New terms');
  body.append('files', new File(['file'], 'terms.pdf', { type: 'application/pdf' }));
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: 'saved' }), { status: 201 })
  );
  vi.stubGlobal('fetch', fetcher);
  const onSuccess = vi.fn(async () => {});
  await act(async () =>
    root.render(
      <TeamActionDialog
        action={{
          title: 'Create version',
          description: 'Save selected files',
          path: '/api/admin/document-templates/example/versions',
          method: 'POST',
          body,
        }}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />
    )
  );
  const confirm = [...document.body.querySelectorAll('button')].find((item) =>
    item.textContent?.includes('Confirm')
  );
  expect(confirm).toBeDefined();
  await act(async () => confirm!.click());
  const options = fetcher.mock.calls[0]![1]!;
  expect(options.body).toBe(body);
  const headers = options.headers as Headers;
  expect(headers.get('content-type')).toBeNull();
  expect(headers.get('x-csrf-token')).toBe('test-token');
  expect(onSuccess).toHaveBeenCalled();
});

it('keeps successful step-up verification across a failed save and retries the identical captured command', async () => {
  const enteredPassword = crypto.randomUUID();
  const body = {
    operationId: 'reviewed-operation',
    expectedReviewHash: 'a'.repeat(64),
    note: 'Reviewed note',
  };
  let attempts = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/auth/step-up') {
      expect(JSON.parse(String(init?.body))).toEqual({ password: enteredPassword });
      return new Response(JSON.stringify({ verified: true }), { status: 200 });
    }
    attempts++;
    return new Response(JSON.stringify(attempts === 1 ? {} : { saved: true }), {
      status: attempts === 1 ? 503 : 200,
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const onSuccess = vi.fn(async () => {});
  await act(async () =>
    root.render(
      <TeamActionDialog
        action={{
          title: 'Record milestone',
          description: 'Customer-visible update',
          path: '/api/admin/solar/construction/example',
          method: 'POST',
          body,
          requiresPassword: true,
        }}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />
    )
  );
  const password = document.body.querySelector<HTMLInputElement>('input[type=password]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      password,
      enteredPassword
    );
    password.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const form = document.body.querySelector('form')!;
  await act(async () =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(document.body.querySelector('input[type=password]')).toBeNull();
  expect(document.body.querySelector('[role=alert]')?.textContent).toContain(
    'could not be completed'
  );
  const confirm = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent === 'Confirm'
  )!;
  expect(confirm.disabled).toBe(false);
  await act(async () => confirm.click());
  expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
    '/api/auth/step-up',
    '/api/admin/solar/construction/example',
    '/api/admin/solar/construction/example',
  ]);
  expect(fetcher.mock.calls[1]![1]?.body).toBe(JSON.stringify(body));
  expect(fetcher.mock.calls[2]![1]?.body).toBe(JSON.stringify(body));
  expect(onSuccess).toHaveBeenCalledOnce();
});
