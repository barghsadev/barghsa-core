import { act, useLayoutEffect, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import type * as ActionModule from '../components/TeamActionDialog.js';
import type * as UiModule from '@barghsa/ui';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { useListQuery } from '../hooks/useListQuery.js';
import { electricityIncreaseQueryOptions } from '../lib/electricity-change-query.js';
import { increaseDecisionFixture } from '../test/electricity-increase-decision-fixtures.js';
import AdminElectricityIncreasesPage from './AdminElectricityIncreasesPage.js';

type DialogProps = ComponentProps<typeof ActionModule.TeamActionDialog>;
const dialogs = vi.hoisted(() => [] as DialogProps[]);
const retryHandlers = vi.hoisted(
  () => [] as NonNullable<ComponentProps<typeof UiModule.Button>['onClick']>[]
);
vi.mock('@barghsa/ui', async (importOriginal) => {
  const original = await importOriginal<typeof UiModule>();
  return {
    ...original,
    Button: (props: ComponentProps<typeof original.Button>) => {
      if (props.children === 'Retry captured decision' && props.onClick)
        retryHandlers.push(props.onClick);
      return <original.Button {...props} />;
    },
  };
});
vi.mock('../components/TeamActionDialog.js', async (importOriginal) => {
  const original = await importOriginal<typeof ActionModule>();
  return {
    ...original,
    TeamActionDialog: (props: DialogProps) => {
      dialogs.push(props);
      return (
        <div role="dialog">
          <button onClick={props.onClose}>Close decision</button>
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
                if (response.status === 401 || response.status === 403)
                  props.onDenied?.(response.status);
                else if (!response.ok) {
                  if (response.status >= 500) props.onUnconfirmed?.();
                  const code = value?.error?.code;
                  if (response.status === 400 && Array.isArray(value?.error?.fields))
                    props.onValidationError?.(value.error.fields);
                  const message = action.errorMessages?.[code];
                  if (typeof message === 'function') message(value);
                } else {
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
            Confirm decision
          </button>
        </div>
      );
    },
  };
});
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ irrDigits: String, number: String }),
}));

const publicError = (
  fields: unknown[],
  code: string = ErrorCodes.VALIDATION_INPUT_INVALID.code
) => ({
  error: {
    code,
    message: 'Invalid input',
    correlationId: '88888888-8888-7888-8888-888888888888',
    fields,
  },
});
let root: Root | undefined;
let container: HTMLDivElement;
const actorSnapshots: Array<{ actor: string; privateReview: boolean; privateRow: boolean }> = [];
function ActorRenderProbe({ actor }: { actor: string }) {
  useLayoutEffect(() => {
    actorSnapshots.push({
      actor,
      privateReview: !!container.querySelector('[role="dialog"]'),
      privateRow: !!container.textContent?.includes(increaseDecisionFixture().request.contractId),
    });
  }, [actor]);
  return null;
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  container?.remove();
  dialogs.length = 0;
  retryHandlers.length = 0;
  actorSnapshots.length = 0;
  vi.unstubAllGlobals();
});
async function render(fetchMock: ReturnType<typeof vi.fn>, actor = 'staff-1') {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <AccountUserProvider value={actor}>
        <AdminElectricityIncreasesPage />
        <ActorRenderProbe actor={actor} />
      </AccountUserProvider>
    )
  );
}
async function click(label: string) {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function change(name: 'effective' | 'reason', value: string) {
  const input = container.querySelector<HTMLInputElement>(`[id^="increase-${name}-"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
async function settled(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    assertion();
  });
}
function queue(request = increaseDecisionFixture().request) {
  return Response.json({ requests: [request], nextBefore: 'next-request' });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let navigate: (raw: Record<string, unknown>) => void;
function Bound() {
  const [raw, setRaw] = useState<Record<string, unknown>>({});
  navigate = setRaw;
  const queries = useListQuery(electricityIncreaseQueryOptions, raw, setRaw);
  return <AdminElectricityIncreasesPage queries={queries} />;
}

it('links local rejection feedback, focuses it, and preserves the independent approval date', async () => {
  const fetchMock = vi.fn(async () => queue());
  await render(fetchMock);
  const date = await change('effective', '2026-10-01T12:00');
  await click('Decline request');
  await settled(() =>
    expect(container.querySelector('[id^="increase-reason-"]')?.getAttribute('aria-invalid')).toBe(
      'true'
    )
  );
  const reason = container.querySelector<HTMLInputElement>('[id^="increase-reason-"]')!;
  expect(reason.getAttribute('aria-describedby')).toContain(`${reason.id}-message`);
  expect(document.activeElement).toBe(reason);
  expect(date.value).toBe('2026-10-01T12:00');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('approves with an optional date without validating or submitting the rejection reason', async () => {
  const { decisionReview, receipt } = increaseDecisionFixture();
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review')
      ? Response.json(decisionReview('approve'))
      : path.endsWith('/approve')
        ? Response.json(await receipt('approve'), { status: 201 })
        : queue()
  );
  await render(fetchMock);
  await click('Approve and issue amendment');
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  expect(
    JSON.parse(
      (fetchMock.mock.calls.find(([path]) => path.endsWith('/review'))![1] as RequestInit)
        .body as string
    )
  ).toEqual({});
  await click('Confirm decision');
  expect(container.textContent).not.toContain('Retry captured decision');
  const action = dialogs[0]!.action!;
  expect(action.body).toEqual({
    idempotencyKey: expect.any(String),
    expectedReviewHash: 'a'.repeat(64),
    effectiveFrom: increaseDecisionFixture().request.effectiveFrom,
  });
  expect(action.body).not.toHaveProperty('expectedVersionId');
});

it('projects only owned preview date feedback and focuses the editable native input', async () => {
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review')
      ? Response.json(publicError(['effectiveFrom']), { status: 400 })
      : queue()
  );
  await render(fetchMock);
  await change('reason', 'Keep this companion');
  await click('Approve and issue amendment');
  await settled(() =>
    expect(
      container.querySelector('[id^="increase-effective-"]')?.getAttribute('aria-invalid')
    ).toBe('true')
  );
  await settled(() =>
    expect(document.activeElement).toBe(container.querySelector('[id^="increase-effective-"]'))
  );
  expect(container.querySelector<HTMLInputElement>('[id^="increase-reason-"]')!.value).toBe(
    'Keep this companion'
  );
});

it('keeps protected or mixed preview fields generic', async () => {
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review')
      ? Response.json(publicError(['effectiveFrom', 'expectedReviewHash']), { status: 400 })
      : queue()
  );
  await render(fetchMock);
  await click('Approve and issue amendment');
  await settled(() => expect(container.textContent).toContain('review'));
  expect(
    container.querySelector('[id^="increase-effective-"]')?.getAttribute('aria-invalid')
  ).not.toBe('true');
  expect(dialogs).toHaveLength(0);
});

it.each([200, 400])(
  'discards a held edited date preview %s while blocking duplicate decisions',
  async (status) => {
    const held = deferred<Response>();
    const { decisionReview } = increaseDecisionFixture();
    const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
      path.endsWith('/review') ? held.promise : queue()
    );
    await render(fetchMock);
    const date = await change('effective', '2026-10-01T12:00');
    await click('Approve and issue amendment');
    await settled(() =>
      expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/review'))).toHaveLength(1)
    );
    expect(date.disabled).toBe(false);
    await change('effective', '2026-10-02T12:00');
    const form = container.querySelector<HTMLFormElement>(
      '[data-testid="electricity-increase-reject-form"]'
    )!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () =>
      held.resolve(
        status === 200
          ? Response.json(decisionReview('approve', '', new Date('2026-10-01T12:00').toISOString()))
          : Response.json(publicError(['effectiveFrom']), { status: 400 })
      )
    );
    expect(dialogs).toHaveLength(0);
    expect(date.getAttribute('aria-invalid')).not.toBe('true');
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/review'))).toHaveLength(1);
  }
);

it('retains an exact captured rejection after a malformed success and prevents lane/read/paging escape', async () => {
  const { decisionReview, receipt } = increaseDecisionFixture();
  let writes = 0;
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review')
      ? Response.json(decisionReview('reject'))
      : path.endsWith('/reject')
        ? Response.json(++writes === 1 ? { status: 'done' } : await receipt('reject'), {
            status: 201,
          })
        : queue()
  );
  await render(fetchMock);
  await change('reason', 'Outside capacity plan');
  await click('Decline request');
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  await click('Confirm decision');
  expect(container.textContent).toContain('Retry captured decision');
  expect(container.querySelector<HTMLInputElement>('[id^="increase-reason-"]')!.disabled).toBe(
    true
  );
  const before = fetchMock.mock.calls.length;
  await click('Expired');
  await click('Refresh');
  expect(fetchMock.mock.calls).toHaveLength(before);
  await click('Retry captured decision');
  await click('Confirm decision');
  const commands = fetchMock.mock.calls.filter(([path]) => path.endsWith('/reject'));
  expect(commands).toHaveLength(2);
  expect((commands[0]![1] as RequestInit).body).toBe((commands[1]![1] as RequestInit).body);
  expect(container.textContent).not.toContain('Retry captured decision');
});

it('retains the original unknown command after a later complete rejection and fences old dialog callbacks', async () => {
  const { decisionReview } = increaseDecisionFixture();
  let writes = 0;
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review')
      ? Response.json(decisionReview('reject'))
      : path.endsWith('/reject')
        ? Response.json(
            ++writes === 1 ? { status: 'done' } : publicError([], ErrorCodes.CONFLICT_VERSION.code),
            {
              status: writes === 1 ? 201 : 409,
            }
          )
        : queue()
  );
  await render(fetchMock);
  await change('reason', 'Outside capacity plan');
  await click('Decline request');
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  const original = dialogs.at(-1)!;
  await click('Confirm decision');
  await click('Retry captured decision');
  const retry = dialogs.at(-1)!;
  await act(async () => {
    original.onClose();
    original.onDenied?.(403);
    original.onUnconfirmed?.();
  });
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(retry.action!.body).toEqual(original.action!.body);
  await click('Confirm decision');
  await click('Close decision');
  expect(container.textContent).toContain('Retry captured decision');
  expect(container.querySelector<HTMLInputElement>('[id^="increase-reason-"]')!.disabled).toBe(
    true
  );
});

it('requires a complete owned write error before unlocking and focusing the reason', async () => {
  const { decisionReview } = increaseDecisionFixture();
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review')
      ? Response.json(decisionReview('reject'))
      : path.endsWith('/reject')
        ? Response.json(publicError(['reason']), { status: 400 })
        : queue()
  );
  await render(fetchMock);
  await change('reason', 'Outside capacity plan');
  await click('Decline request');
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  await click('Confirm decision');
  await settled(() =>
    expect(container.querySelector('[id^="increase-reason-"]')?.getAttribute('aria-invalid')).toBe(
      'true'
    )
  );
  expect(container.querySelector<HTMLInputElement>('[id^="increase-reason-"]')!.disabled).toBe(
    false
  );
  await settled(() =>
    expect(document.activeElement).toBe(container.querySelector('[id^="increase-reason-"]'))
  );
});

it('keeps a malformed owned write error uncertain instead of granting a fresh command', async () => {
  const { decisionReview } = increaseDecisionFixture();
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review')
      ? Response.json(decisionReview('reject'))
      : path.endsWith('/reject')
        ? Response.json(
            { error: { code: ErrorCodes.VALIDATION_INPUT_INVALID.code, fields: ['reason'] } },
            { status: 400 }
          )
        : queue()
  );
  await render(fetchMock);
  await change('reason', 'Outside capacity plan');
  await click('Decline request');
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  await click('Confirm decision');
  await click('Close decision');
  expect(container.textContent).toContain('Retry captured decision');
  expect(
    container.querySelector('[id^="increase-reason-"]')?.getAttribute('aria-invalid')
  ).not.toBe('true');
});

it.each([{ complete: false }, { complete: true }])(
  'requires a complete missing-write response before withdrawing the row: $complete',
  async ({ complete }) => {
    const { decisionReview } = increaseDecisionFixture();
    const body = complete
      ? publicError([], ErrorCodes.NOT_FOUND_RESOURCE.code)
      : { error: { code: ErrorCodes.NOT_FOUND_RESOURCE.code } };
    const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
      path.endsWith('/review')
        ? Response.json(decisionReview('reject'))
        : path.endsWith('/reject')
          ? Response.json(body, { status: 404 })
          : queue()
    );
    await render(fetchMock);
    await change('reason', 'Outside capacity plan');
    await click('Decline request');
    await settled(() => expect(dialogs.length).toBeGreaterThan(0));
    await click('Confirm decision');
    if (complete) {
      expect(container.querySelector('[id^="increase-reason-"]')).toBeNull();
      await click('Refresh');
      expect(container.querySelector<HTMLInputElement>('[id^="increase-reason-"]')!.value).toBe('');
    } else {
      await click('Close decision');
      expect(container.textContent).toContain('Retry captured decision');
      expect(container.querySelector<HTMLInputElement>('[id^="increase-reason-"]')!.disabled).toBe(
        true
      );
    }
  }
);

it('withdraws a missing row and its drafts while retaining authorized queue refresh', async () => {
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review')
      ? Response.json(publicError([], ErrorCodes.NOT_FOUND_RESOURCE.code), { status: 404 })
      : queue()
  );
  await render(fetchMock);
  await change('reason', 'Private draft');
  await click('Decline request');
  await settled(() => expect(container.querySelector('[id^="increase-reason-"]')).toBeNull());
  expect(container.textContent).not.toContain('Private draft');
  await click('Refresh');
  expect(container.querySelector<HTMLInputElement>('[id^="increase-reason-"]')!.value).toBe('');
});

it('withdraws private queue and draft data after denied preview even if the draft changed', async () => {
  const held = deferred<Response>();
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review') ? held.promise : queue()
  );
  await render(fetchMock);
  await change('reason', 'Private draft');
  await click('Decline request');
  await settled(() =>
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/review'))).toHaveLength(1)
  );
  await change('reason', 'Edited private draft');
  await act(async () => held.resolve(Response.json({}, { status: 403 })));
  expect(container.querySelector('[id^="increase-reason-"]')).toBeNull();
  expect(container.textContent).not.toContain(increaseDecisionFixture().request.contractId);
});

it('fences a previous actor preview and immediately hides their queue and drafts', async () => {
  const held = deferred<Response>();
  const { decisionReview } = increaseDecisionFixture();
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review') ? held.promise : queue()
  );
  await render(fetchMock);
  await change('reason', 'Private draft');
  await click('Decline request');
  await settled(() =>
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/review'))).toHaveLength(1)
  );
  await act(async () =>
    root!.render(
      <AccountUserProvider value="staff-2">
        <AdminElectricityIncreasesPage />
        <ActorRenderProbe actor="staff-2" />
      </AccountUserProvider>
    )
  );
  await act(async () => held.resolve(Response.json(decisionReview('reject', 'Private draft'))));
  expect(dialogs).toHaveLength(0);
  expect(container.querySelector<HTMLInputElement>('[id^="increase-reason-"]')!.value).toBe('');
});

it('hides captured private review at the new actor commit and rejects a stale retry callback', async () => {
  const { decisionReview } = increaseDecisionFixture();
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review')
      ? Response.json(decisionReview('reject'))
      : path.endsWith('/reject')
        ? Response.json({ status: 'done' }, { status: 201 })
        : queue()
  );
  await render(fetchMock);
  await change('reason', 'Outside capacity plan');
  await click('Decline request');
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  await click('Confirm decision');
  const staleRetry = retryHandlers.at(-1)!;
  await act(async () =>
    root!.render(
      <AccountUserProvider value="staff-2">
        <AdminElectricityIncreasesPage />
        <ActorRenderProbe actor="staff-2" />
      </AccountUserProvider>
    )
  );
  expect(actorSnapshots.find((snapshot) => snapshot.actor === 'staff-2')).toMatchObject({
    privateReview: false,
    privateRow: false,
  });
  await change('reason', 'Outside capacity plan');
  await click('Decline request');
  await settled(() => expect(container.querySelector('[role="dialog"]')).not.toBeNull());
  await click('Confirm decision');
  const count = dialogs.length;
  const event = { type: 'click' } as Parameters<typeof staleRetry>[0];
  await act(async () => staleRetry(event));
  expect(dialogs).toHaveLength(count);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toContain('Retry captured decision');
});

it('preserves an in-flight captured write across an external cursor change', async () => {
  const held = deferred<Response>();
  const { decisionReview, receipt } = increaseDecisionFixture();
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review')
      ? Response.json(decisionReview('reject'))
      : path.endsWith('/reject')
        ? held.promise
        : queue()
  );
  await render(fetchMock);
  await act(async () =>
    root!.render(
      <AccountUserProvider value="staff-1">
        <Bound />
      </AccountUserProvider>
    )
  );
  await change('reason', 'Outside capacity plan');
  await click('Decline request');
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  const captured = dialogs.at(-1)!.action;
  await click('Confirm decision');
  await act(async () => navigate({ cursor: '99999999-9999-7999-8999-999999999999' }));
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(dialogs.at(-1)!.action).toBe(captured);
  await act(async () => held.resolve(Response.json(await receipt('reject'), { status: 201 })));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).not.toContain('Retry captured decision');
  expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/reject'))).toHaveLength(1);
});

it('rejects a stale retry entry from the previous cursor without rebinding its command', async () => {
  const { decisionReview } = increaseDecisionFixture();
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review')
      ? Response.json(decisionReview('reject'))
      : path.endsWith('/reject')
        ? Response.json({ status: 'done' }, { status: 201 })
        : queue()
  );
  await render(fetchMock);
  await act(async () =>
    root!.render(
      <AccountUserProvider value="staff-1">
        <Bound />
      </AccountUserProvider>
    )
  );
  await change('reason', 'Outside capacity plan');
  await click('Decline request');
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  await click('Confirm decision');
  const staleRetry = retryHandlers.at(-1)!;
  await act(async () => navigate({ cursor: '99999999-9999-7999-8999-999999999999' }));
  const count = dialogs.length;
  await act(async () => staleRetry({ type: 'click' } as Parameters<typeof staleRetry>[0]));
  expect(dialogs).toHaveLength(count);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await click('Retry captured decision');
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
});
