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

it.each([
  [400, { code: 'VALIDATION:INPUT:INVALID', fields: ['postalCode'] }, true],
  [400, { code: 'OTHER', fields: ['postalCode'] }, false],
  [400, { code: 'VALIDATION:INPUT:INVALID', fields: 'postalCode' }, false],
  [409, { code: 'VALIDATION:INPUT:INVALID', fields: ['postalCode'] }, false],
] as const)(
  'routes only structured input errors from status %s to the owning form',
  async (status, error, mapped) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error }), { status }))
    );
    const onValidationError = vi.fn(() => true),
      onClose = vi.fn(),
      onSuccess = vi.fn(async () => {});
    await act(async () =>
      root.render(
        <TeamActionDialog
          action={{
            title: 'Edit',
            description: 'Customer',
            path: '/api/crm/profiles/one',
            method: 'PUT',
          }}
          onClose={onClose}
          onSuccess={onSuccess}
          onValidationError={onValidationError}
        />
      )
    );
    await act(async () =>
      document
        .querySelector('[role=dialog] form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(onValidationError).toHaveBeenCalledTimes(mapped ? 1 : 0);
    expect(onClose).toHaveBeenCalledTimes(mapped ? 1 : 0);
    expect(onSuccess).not.toHaveBeenCalled();
    if (!mapped) expect(document.querySelector('[role=dialog] [role=alert]')).not.toBeNull();
  }
);
it('retains generic confirmation feedback when public fields are not owned by the editor', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'VALIDATION:INPUT:INVALID',
              fields: ['nationalId'],
              message: 'private detail',
            },
          }),
          { status: 400 }
        )
    )
  );
  const onClose = vi.fn(),
    onValidationError = vi.fn(() => false);
  await act(async () =>
    root.render(
      <TeamActionDialog
        action={{
          title: 'Edit',
          description: 'Customer',
          path: '/api/crm/profiles/one',
          method: 'PUT',
        }}
        onClose={onClose}
        onSuccess={vi.fn(async () => {})}
        onValidationError={onValidationError}
      />
    )
  );
  await act(async () =>
    document
      .querySelector('[role=dialog] form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(onValidationError).toHaveBeenCalledWith(['nationalId']);
  expect(onClose).not.toHaveBeenCalled();
  expect(document.querySelector('[role=dialog] [role=alert]')?.textContent).toContain(
    'could not be completed'
  );
  expect(document.body.textContent).not.toContain('private detail');
});
it('ignores an obsolete validation response after the captured action changes', async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        })
    )
  );
  const onClose = vi.fn(),
    onValidationError = vi.fn(() => true);
  const props = { onClose, onValidationError, onSuccess: vi.fn(async () => {}) };
  await act(async () =>
    root.render(
      <TeamActionDialog
        {...props}
        action={{
          title: 'Edit one',
          description: 'Customer one',
          path: '/api/crm/profiles/one',
          method: 'PUT',
        }}
      />
    )
  );
  await act(async () =>
    document
      .querySelector('[role=dialog] form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await act(async () =>
    root.render(
      <TeamActionDialog
        {...props}
        action={{
          title: 'Edit two',
          description: 'Customer two',
          path: '/api/crm/profiles/two',
          method: 'PUT',
        }}
      />
    )
  );
  await act(async () =>
    resolve(
      new Response(
        JSON.stringify({ error: { code: 'VALIDATION:INPUT:INVALID', fields: ['email'] } }),
        { status: 400 }
      )
    )
  );
  expect(onValidationError).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(document.querySelector('[role=dialog] [role=alert]')).toBeNull();
});

it('locks the pending confirmation against duplicate submits and announces its busy state', async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      })
  );
  vi.stubGlobal('fetch', fetcher);
  const onSuccess = vi.fn(async () => {}),
    onClose = vi.fn();
  await act(async () =>
    root.render(
      <TeamActionDialog
        action={{
          title: 'Edit',
          description: 'Customer',
          path: '/api/crm/profiles/one',
          method: 'PUT',
        }}
        onSuccess={onSuccess}
        onClose={onClose}
      />
    )
  );
  const form = document.querySelector('[role=dialog] form')!;
  await act(async () => {
    for (let i = 0; i < 2; i++)
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(fetcher).toHaveBeenCalledOnce();
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  expect(submit.disabled).toBe(true);
  expect(submit.getAttribute('aria-busy')).toBe('true');
  await act(async () => resolve(new Response(JSON.stringify({ updated: true }))));
  expect(onSuccess).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});
