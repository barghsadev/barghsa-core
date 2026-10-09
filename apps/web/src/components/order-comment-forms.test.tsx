import { QueryComponentProvider } from '../test/query-provider.js';
import { act, useLayoutEffect, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import type * as ActionModule from './TeamActionDialog.js';
import type * as SchemaModule from '../lib/order-comment-form-schemas.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { ElectricityOrderComments, SavingOrderComments } from './SavingOrderComments.js';

type DialogProps = ComponentProps<typeof ActionModule.TeamActionDialog>;
const dialogs = vi.hoisted(() => [] as DialogProps[]);
const schemaLoader = vi.hoisted(() => ({ hold: null as Promise<void> | null }));
vi.mock('../lib/order-comment-form-schemas.js', async (importOriginal) => {
  if (schemaLoader.hold) await schemaLoader.hold;
  return importOriginal<typeof SchemaModule>();
});
vi.mock('./TeamActionDialog.js', async (importOriginal) => {
  const original = await importOriginal<typeof ActionModule>();
  return {
    ...original,
    TeamActionDialog: (props: DialogProps) => {
      dialogs.push(props);
      return (
        <div role="dialog">
          <button onClick={props.onClose}>Close comment</button>
          <button
            onClick={async () => {
              const action = props.action!;
              props.onPendingChange?.(true);
              try {
                const response = await fetch(action.path, {
                  method: action.method,
                  body: JSON.stringify(action.body),
                });
                const value = await response.json();
                if ([401, 403].includes(response.status))
                  props.onDenied?.(response.status as 401 | 403);
                else if (!response.ok) {
                  if (response.status >= 500) props.onUnconfirmed?.();
                  if (response.status === 400 && Array.isArray(value?.error?.fields))
                    props.onValidationError?.(value.error.fields);
                  const mapped = action.errorMessages?.[value?.error?.code];
                  if (typeof mapped === 'function') mapped(value);
                } else if (response.status !== action.successStatus) props.onUnconfirmed?.();
                else {
                  await props.onSuccess(value);
                  props.onPendingChange?.(false);
                  props.onClose();
                }
              } catch {
                props.onUnconfirmed?.();
              } finally {
                props.onPendingChange?.(false);
              }
            }}
          >
            Confirm comment
          </button>
        </div>
      );
    },
  };
});
const orderId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const actor = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
const id = '55555555-5555-4555-8555-555555555555';
type Context = {
  kind: 'electricity' | 'saving';
  staff: boolean;
  actor: string;
  orderId: string;
  profileId: string;
  sourceVersion: string;
};
const defaults: Context = {
  kind: 'electricity',
  staff: false,
  actor,
  orderId,
  profileId,
  sourceVersion: 'source-1',
};
const page = (comments: unknown[] = [], nextBefore: string | null = null) => ({
  comments,
  nextBefore,
});
function receipt(context: Context = defaults, body = 'Message', visibility = 'public') {
  return {
    id,
    orderId: context.orderId,
    authorUserId: context.actor,
    authorName: 'account@example.test',
    authorRole: context.staff ? 'staff' : 'customer',
    body,
    createdAt: '2026-10-05T10:00:00.123Z',
    ...(context.kind === 'electricity' ? { visibility } : {}),
  };
}
function publicError(fields: unknown[], code: string = ErrorCodes.VALIDATION_INPUT_INVALID.code) {
  return { error: { code, message: 'Invalid request', correlationId: actor, fields } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
let root: Root | undefined;
let host: HTMLDivElement;
let context = defaults;
const commits: boolean[] = [];
function Probe({ revision }: { revision: string }) {
  useLayoutEffect(() => {
    commits.push(
      !!host.querySelector('[role="dialog"]') || host.textContent!.includes('Private old message')
    );
  }, [revision]);
  return null;
}
function tree() {
  const Widget = context.kind === 'saving' ? SavingOrderComments : ElectricityOrderComments;
  return (
    <AccountUserProvider value={context.actor}>
      <Widget
        orderId={context.orderId}
        profileId={context.profileId}
        staff={context.staff}
        sourceVersion={context.sourceVersion}
        formatTimestamp={(value) => value}
      />
      <Probe revision={JSON.stringify(context)} />
    </AccountUserProvider>
  );
}
async function render(fetchMock: ReturnType<typeof vi.fn>, patch: Partial<Context> = {}) {
  context = { ...defaults, ...patch };
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetchMock);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<QueryComponentProvider>{tree()}</QueryComponentProvider>));
}
async function change(patch: Partial<Context>) {
  context = { ...context, ...patch };
  await act(async () => root!.render(<QueryComponentProvider>{tree()}</QueryComponentProvider>));
}
async function settled(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    check();
  });
}
async function click(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function fill(body: string, visibility?: string) {
  const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      textarea,
      body
    );
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if (visibility !== undefined) {
      const select = host.querySelector<HTMLSelectElement>('select')!;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
        select,
        visibility
      );
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector<HTMLFormElement>('[data-testid="order-comment-form"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
function body(init?: RequestInit) {
  return JSON.parse(String(init?.body)) as Record<string, string>;
}
const writes = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  dialogs.length = 0;
  commits.length = 0;
  schemaLoader.hold = null;
  vi.unstubAllGlobals();
});

it('owns a held lazy submit synchronously and discards validation of an edited raw draft', async () => {
  const held = deferred<void>();
  schemaLoader.hold = held.promise;
  const fetchMock = vi.fn(async () => Response.json(page()));
  await render(fetchMock);
  await fill(' Original message ');
  await submit();
  await submit();
  expect(dialogs).toHaveLength(0);
  expect(writes(fetchMock)).toHaveLength(0);
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(false);
  await fill(' Edited message ');
  await act(async () => held.resolve());
  await settled(() => expect(host.querySelector('[aria-busy="true"]')).toBeNull());
  expect(dialogs).toHaveLength(0);
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(' Edited message ');
  await submit();
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  expect(dialogs.at(-1)!.action!.body).toEqual({
    body: 'Edited message',
    idempotencyKey: expect.any(String),
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('focuses touched body then visibility and retains the other raw field', async () => {
  const fetchMock = vi.fn(async () => Response.json(page()));
  await render(fetchMock, { staff: true });
  await submit();
  await settled(() => expect(document.activeElement).toBe(host.querySelector('textarea')));
  expect(host.querySelector('textarea')?.getAttribute('aria-invalid')).toBe('true');
  expect(host.querySelector('textarea')?.getAttribute('aria-describedby')).toContain(
    'electricity-comment-staff-message'
  );
  await fill(' Raw message ');
  await submit();
  await settled(() => expect(document.activeElement).toBe(host.querySelector('select')));
  expect(host.querySelector('select')?.getAttribute('aria-invalid')).toBe('true');
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(' Raw message ');
  expect(writes(fetchMock)).toHaveLength(0);
});

it.each(['body', 'visibility'] as const)(
  'projects complete owned %s errors and preserves raw companions',
  async (field) => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json(publicError([field]), { status: 400 })
        : Response.json(page())
    );
    await render(fetchMock, { staff: true });
    await fill(' Raw message ', 'internal');
    await submit();
    await settled(() => expect(dialogs.length).toBeGreaterThan(0));
    await click('Confirm comment');
    await settled(() =>
      expect(document.activeElement).toBe(
        host.querySelector(field === 'body' ? 'textarea' : 'select')
      )
    );
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(' Raw message ');
    expect(host.querySelector<HTMLSelectElement>('select')!.value).toBe('internal');
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(false);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  }
);

it.each([['body', 'idempotencyKey'], ['unknown'], ['visibility']])(
  'keeps unsupported customer feedback generic: %s',
  async (...fields) => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json(publicError(fields), { status: 400 })
        : Response.json(page())
    );
    await render(fetchMock);
    await fill(' Message ');
    await submit();
    await settled(() => expect(dialogs.length).toBeGreaterThan(0));
    await click('Confirm comment');
    expect(host.querySelector('textarea')?.getAttribute('aria-invalid')).not.toBe('true');
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await click('Close comment');
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(false);
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(' Message ');
  }
);

it.each(['malformed', 'foreign', 'wrongStatus'] as const)(
  'keeps %s success unresolved, freezes reads, and retries exact captured body/key',
  async (failure) => {
    let count = 0;
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return Response.json(page([receipt(defaults)]));
      ++count;
      return Response.json(
        count > 1
          ? receipt(defaults, 'Message')
          : failure === 'malformed'
            ? {}
            : failure === 'foreign'
              ? { ...receipt(), authorUserId: other }
              : receipt(),
        { status: failure === 'wrongStatus' && count === 1 ? 201 : 200 }
      );
    });
    await render(fetchMock);
    await fill(' Message ');
    await submit();
    await settled(() => expect(dialogs.length).toBeGreaterThan(0));
    await click('Confirm comment');
    expect(host.textContent).toContain('Retry captured comment');
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(true);
    const calls = fetchMock.mock.calls.length;
    await click('Reload comments');
    await submit();
    expect(fetchMock.mock.calls).toHaveLength(calls);
    await click('Retry captured comment');
    await click('Confirm comment');
    expect(writes(fetchMock)).toHaveLength(2);
    expect(writes(fetchMock)[0]![1]!.body).toBe(writes(fetchMock)[1]![1]!.body);
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
    expect(host.textContent).not.toContain('Retry captured comment');
  }
);

it('retains a lost response through rejected retry and ignores callbacks from the old dialog', async () => {
  let count = 0;
  const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return Response.json(page());
    if (++count === 1) throw new Error('Lost response');
    return Response.json(publicError(['body']), { status: 400 });
  });
  await render(fetchMock);
  await fill(' Message ');
  await submit();
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  const old = dialogs.at(-1)!;
  await click('Confirm comment');
  await click('Retry captured comment');
  await act(async () => {
    old.onDenied?.(403);
    old.onClose();
    old.onUnconfirmed?.();
    await old.onSuccess(receipt());
  });
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  await click('Confirm comment');
  await click('Close comment');
  expect(host.textContent).toContain('Retry captured comment');
  expect(host.querySelector('textarea')?.getAttribute('aria-invalid')).not.toBe('true');
  expect(writes(fetchMock)[0]![1]!.body).toBe(writes(fetchMock)[1]![1]!.body);
});

it.each([ErrorCodes.VALIDATION_INPUT_INVALID.code, ErrorCodes.NOT_FOUND_RESOURCE.code])(
  'does not unlock a partial %s rejection envelope',
  async (code) => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json(
            { error: { code, fields: ['body'] } },
            { status: code === ErrorCodes.NOT_FOUND_RESOURCE.code ? 404 : 400 }
          )
        : Response.json(page())
    );
    await render(fetchMock);
    await fill(' Message ');
    await submit();
    await settled(() => expect(dialogs.length).toBeGreaterThan(0));
    await click('Confirm comment');
    await click('Close comment');
    expect(host.textContent).toContain('Retry captured comment');
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(' Message ');
  }
);

it.each([
  { kind: 'electricity' as const, role: 'staff' },
  { kind: 'saving' as const, role: 'customer' },
])(
  'accepts actual customer $kind receipt role $role without adding unsupported visibility',
  async ({ kind, role }) => {
    const current = { ...defaults, kind, actor: 'buyer' };
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json({ ...receipt(current), authorRole: role })
        : Response.json(page())
    );
    await render(fetchMock, { kind, actor: 'buyer' });
    await fill(' Message ');
    await submit();
    await settled(() => expect(dialogs.length).toBeGreaterThan(0));
    await click('Confirm comment');
    expect(host.querySelector('select')).toBeNull();
    expect(body(writes(fetchMock)[0]![1])).toEqual({
      body: 'Message',
      idempotencyKey: expect.any(String),
    });
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
  }
);

it('prepends exact-cursor older pages and preserves reversed UUIDs sharing a public timestamp', async () => {
  const first = {
    ...receipt(),
    id: '99999999-9999-4999-8999-999999999999',
    body: 'Older same millisecond',
  };
  const newest = { ...receipt(), body: 'Newer same millisecond' };
  const fetchMock = vi.fn(async (path: string) =>
    Response.json(path.includes('?before=') ? page([first]) : page([newest], newest.id))
  );
  await render(fetchMock);
  await click('Older comments');
  expect([...host.querySelectorAll('ol li p')].map((item) => item.textContent)).toEqual([
    first.body,
    newest.body,
  ]);
  expect(fetchMock).toHaveBeenLastCalledWith(
    `/api/electricity/orders/${orderId}/comments?before=${newest.id}`,
    expect.objectContaining({ credentials: 'include' })
  );
});

it('retries a failed older page with the same cursor and retains its raw draft and existing thread', async () => {
  const newest = receipt();
  const older = {
    ...receipt(),
    id: other,
    body: 'Recovered older message',
    createdAt: '2026-10-04T10:00:00.000Z',
  };
  let attempt = 0;
  const fetchMock = vi.fn(async (path: string) =>
    path.includes('?before=')
      ? ++attempt === 1
        ? Response.json({}, { status: 503 })
        : Response.json(page([older]))
      : Response.json(page([newest], newest.id))
  );
  await render(fetchMock);
  await fill(' Retained raw draft ');
  await click('Older comments');
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).toContain(newest.body);
  await click('Reload comments');
  const olderReads = fetchMock.mock.calls.filter(([path]) => path.includes('?before='));
  expect(olderReads).toHaveLength(2);
  expect(olderReads[1]![0]).toBe(olderReads[0]![0]);
  expect([...host.querySelectorAll('ol li p')].map((item) => item.textContent)).toEqual([
    older.body,
    newest.body,
  ]);
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(' Retained raw draft ');
});

it('rejects an internal customer page before rendering any of its content and offers explicit read retry', async () => {
  let safe = false;
  const fetchMock = vi.fn(async () =>
    Response.json(page([receipt(defaults, 'Private internal', safe ? 'public' : 'internal')]))
  );
  await render(fetchMock);
  expect(host.textContent).not.toContain('Private internal');
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  safe = true;
  await click('Reload comments');
  expect(host.textContent).toContain('Private internal');
});

it.each([403, 404])(
  'withdraws current private thread/draft after read %s and keeps only authorized missing recovery',
  async (status) => {
    let current = 200;
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json(
            publicError(
              [],
              status === 404 ? ErrorCodes.NOT_FOUND_RESOURCE.code : 'AUTHZ:FORBIDDEN'
            ),
            { status }
          )
        : current === 200
          ? Response.json(page([receipt(defaults, 'Private old message')]))
          : Response.json({}, { status: current })
    );
    await render(fetchMock);
    await fill(' Private draft ');
    current = status;
    await click('Reload comments');
    expect(host.textContent).not.toContain('Private old message');
    expect(host.querySelector('textarea')).toBeNull();
    if (status === 404) {
      current = 200;
      await click('Reload comments');
      expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
    } else expect(host.querySelector('[data-testid="order-comment-reload"]')).toBeNull();
  }
);

it('fences a held read after confirmed profile-context revision even when detail props stay unchanged', async () => {
  const held = deferred<Response>();
  let read = 0;
  const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json(receipt(defaults, 'Fresh message'));
    if (++read === 1) return Response.json(page([receipt(defaults, 'Private old message')]));
    return read === 2 ? held.promise : Response.json(page());
  });
  await render(fetchMock);
  await fill(' Private draft ');
  await click('Reload comments');
  await settled(() => expect(read).toBe(2));
  await act(async () => refreshProfileContext());
  expect(host.textContent).not.toContain('Private old message');
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
  await fill(' Fresh message ');
  await submit();
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  await act(async () => held.resolve(Response.json({}, { status: 403 })));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  await click('Confirm comment');
  expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
});

it.each([403, 404])(
  'withdraws private data and the captured command after current write %s',
  async (status) => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json(
            publicError(
              [],
              status === 404 ? ErrorCodes.NOT_FOUND_RESOURCE.code : 'AUTHZ:FORBIDDEN'
            ),
            { status }
          )
        : Response.json(page([receipt(defaults, 'Private old message')]))
    );
    await render(fetchMock);
    await fill(' Private draft ');
    await submit();
    await settled(() => expect(dialogs.length).toBeGreaterThan(0));
    const old = dialogs.at(-1)!;
    await click('Confirm comment');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.textContent).not.toContain('Private old message');
    expect(host.textContent).not.toContain('Retry captured comment');
    if (status === 404) {
      await click('Reload comments');
      await fill(' Current draft ');
      await act(async () => old.onSuccess(receipt()));
      expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(' Current draft ');
    }
  }
);

it.each(['actor', 'profileId', 'orderId', 'kind', 'staff', 'sourceVersion'] as const)(
  'withdraws private data at the changed %s commit and fences old read/dialog callbacks',
  async (field) => {
    const held = deferred<Response>();
    let read = 0;
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json(receipt());
      return ++read === 1
        ? Response.json(page([receipt(defaults, 'Private old message')]))
        : held.promise;
    });
    await render(fetchMock);
    await fill(' Private draft ');
    await submit();
    await settled(() => expect(dialogs.length).toBeGreaterThan(0));
    const old = dialogs.at(-1)!;
    const patch =
      field === 'kind'
        ? { kind: 'saving' as const }
        : field === 'staff'
          ? { staff: true }
          : { [field]: other };
    await change(patch);
    expect(commits.at(-1)).toBe(false);
    await act(async () => {
      old.onDenied?.(403);
      old.onUnconfirmed?.();
      old.onClose();
      await old.onSuccess(receipt());
      held.resolve(Response.json(page()));
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
  }
);
