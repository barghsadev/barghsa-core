import { QueryComponentProvider } from '../test/query-provider.js';
import { act, useLayoutEffect, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi, type Mock } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import type * as ActionModule from '../components/TeamActionDialog.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { priceContractId, priceProfileId } from '../test/electricity-price-adjustment-fixtures.js';
import {
  staffPriceState,
  staffPriceReview,
  staffPriceReceipt,
  deepSorted,
} from '../test/electricity-price-staff-fixtures.js';
import Page from './AdminElectricityPriceAdjustmentsPage.js';

type DialogProps = ComponentProps<typeof ActionModule.TeamActionDialog>;
const dialogs = vi.hoisted(() => [] as DialogProps[]);
vi.mock('../components/TeamActionDialog.js', async (importOriginal) => {
  const original = await importOriginal<typeof ActionModule>();
  return {
    ...original,
    TeamActionDialog: (props: DialogProps) => {
      dialogs.push(props);
      return (
        <div role="dialog">
          {props.summary}
          <button onClick={props.onClose}>Close action</button>
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
                  const message = action.errorMessages?.[value?.error?.code];
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
            Confirm action
          </button>
        </div>
      );
    },
  };
});
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({
    status: 'ready',
    timezone: 'Asia/Tehran',
    format: String,
    notice: null,
  }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    irrDigits: String,
    number: String,
    money: String,
    numberStyle: 'western',
  }),
}));
let root: Root | undefined;
let host: HTMLDivElement;
const walletReads = vi.fn(async () =>
  Response.json({ profileId: priceProfileId, currency: 'IRR', balance: '0' })
);
const snapshots: Array<{ actor: string; review: boolean }> = [];
function Probe({ actor }: { actor: string }) {
  useLayoutEffect(() => {
    snapshots.push({ actor, review: !!host.querySelector('[role="dialog"]') });
  }, [actor]);
  return null;
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  dialogs.length = 0;
  snapshots.length = 0;
  walletReads.mockClear();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});
async function render(
  fetchMock: Mock<(path: string, init?: RequestInit) => Promise<Response>>,
  selected = true
) {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', (path: string, init?: RequestInit) => {
    if (path === `/api/staff/profiles/${priceProfileId}/wallet-balance`) {
      expect(init?.credentials).toBe('include');
      expect(init?.cache).toBe('no-store');
      expect(init?.method).toBeUndefined();
      return walletReads();
    }
    return fetchMock(path, init);
  });
  window.history.replaceState(
    {},
    '',
    selected
      ? `/admin/electricity-price-adjustments?contractId=${priceContractId}`
      : '/admin/electricity-price-adjustments'
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QueryComponentProvider>
        {
          <AccountUserProvider value="staff-1">
            <Page />
            <Probe actor="staff-1" />
          </AccountUserProvider>
        }
      </QueryComponentProvider>
    )
  );
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
async function fill(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
  expect(input, id).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
async function draft() {
  await fill('price-percent', '10');
  await fill('price-effective', '2026-10-06T12:00');
  await fill('price-reason', 'Tariff change');
  await fill('price-basis', 'Clause 7');
}
async function submitProposal() {
  await act(async () =>
    host
      .querySelector<HTMLFormElement>('[data-testid="electricity-price-proposal-form"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
function body(init?: RequestInit) {
  return JSON.parse(String(init?.body)) as Record<string, string>;
}
function publicError(fields: unknown[], code: string = ErrorCodes.VALIDATION_INPUT_INVALID.code) {
  return {
    error: {
      code,
      message: 'Invalid request',
      correlationId: '88888888-8888-4888-8888-888888888888',
      fields,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

it('focuses a touched invalid contract picker without making a private read', async () => {
  const fetchMock = vi.fn(async () => Response.json(staffPriceState()));
  await render(fetchMock, false);
  const input = await fill('electricity-price-contract', 'not a UUID');
  await click('Open contract');
  await settled(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
  await settled(() => expect(document.activeElement).toBe(input));
  expect(input.getAttribute('aria-describedby')).toContain('electricity-price-contract-message');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('normalizes a padded uppercase UUID picker before the actual workspace GET', async () => {
  const id = 'abcdefab-abcd-4abc-8abc-abcdefabcdef';
  const fetchMock = vi.fn(async () => Response.json({ ...staffPriceState(), contractId: id }));
  await render(fetchMock, false);
  await fill('electricity-price-contract', `  ${id.toUpperCase()}  `);
  await click('Open contract');
  await settled(() => expect(host.querySelector('#price-percent')).not.toBeNull());
  expect(fetchMock).toHaveBeenCalledWith(
    `/api/staff/electricity/contracts/${id}/price-adjustments`,
    expect.objectContaining({ credentials: 'include' })
  );
});

it('focuses the first invalid proposal field and keeps valid companion inputs', async () => {
  const fetchMock = vi.fn(async () => Response.json(staffPriceState()));
  await render(fetchMock);
  await fill('price-reason', 'Keep this reason');
  await fill('price-effective', '2026-10-06T12:00');
  await submitProposal();
  await settled(() =>
    expect(host.querySelector('#price-percent')?.getAttribute('aria-invalid')).toBe('true')
  );
  await settled(() => expect(document.activeElement).toBe(host.querySelector('#price-percent')));
  expect(host.querySelector<HTMLInputElement>('#price-reason')!.value).toBe('Keep this reason');
  expect(host.querySelector<HTMLInputElement>('#price-effective')!.value).toBe('2026-10-06T12:00');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('projects owned wire feedback to the raw editor and focuses it without losing companions', async () => {
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review')
      ? Response.json(publicError(['reason']), { status: 400 })
      : Response.json(staffPriceState())
  );
  await render(fetchMock);
  await draft();
  await submitProposal();
  await settled(() => expect(document.activeElement).toBe(host.querySelector('#price-reason')));
  expect(host.querySelector('#price-reason')?.getAttribute('aria-invalid')).toBe('true');
  expect(host.querySelector<HTMLInputElement>('#price-percent')!.value).toBe('10');
  expect(host.querySelector<HTMLInputElement>('#price-basis')!.value).toBe('Clause 7');
  expect(host.querySelector<HTMLInputElement>('#price-effective')!.value).toBe('2026-10-06T12:00');
});

it('keeps mixed protected metadata generic', async () => {
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review')
      ? Response.json(publicError(['reason', 'expectedReviewHash']), { status: 400 })
      : Response.json(staffPriceState())
  );
  await render(fetchMock);
  await draft();
  await submitProposal();
  await settled(() =>
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/review'))).toHaveLength(1)
  );
  expect(host.querySelector('#price-reason')?.getAttribute('aria-invalid')).not.toBe('true');
  expect(dialogs).toHaveLength(0);
});

it.each([200, 400])(
  'discards a held edited preview %s and synchronously blocks duplicate proposal submission',
  async (status) => {
    const held = deferred<Response>();
    let preview = staffPriceReview();
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/review')) {
        preview = staffPriceReview(body(init));
        return held.promise;
      }
      return Response.json(staffPriceState());
    });
    await render(fetchMock);
    await draft();
    await submitProposal();
    await submitProposal();
    await settled(() =>
      expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/review'))).toHaveLength(1)
    );
    expect(host.querySelector<HTMLInputElement>('#price-reason')!.disabled).toBe(false);
    await fill('price-reason', 'Edited reason');
    await act(async () =>
      held.resolve(
        status === 200
          ? Response.json(deepSorted(preview))
          : Response.json(publicError(['reason']), { status: 400 })
      )
    );
    expect(dialogs).toHaveLength(0);
    expect(host.querySelector('#price-reason')?.getAttribute('aria-invalid')).not.toBe('true');
    expect(host.querySelector<HTMLInputElement>('#price-reason')!.value).toBe('Edited reason');
  }
);

it('retains an exact unknown publish and accepts its progressed full-row replay without a GET shortcut', async () => {
  let preview = staffPriceReview();
  let writes = 0;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/review')) {
      preview = staffPriceReview(body(init));
      return Response.json(deepSorted(preview));
    }
    if (init?.method === 'POST')
      return Response.json(
        ++writes === 1 ? {} : deepSorted(staffPriceReceipt(preview, 'finalized')),
        { status: 201 }
      );
    return Response.json(staffPriceState());
  });
  await render(fetchMock);
  await draft();
  await submitProposal();
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  await click('Confirm action');
  expect(host.textContent).toContain('Retry captured price action');
  expect(host.querySelector<HTMLInputElement>('#price-reason')!.disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>('#electricity-price-contract')!.disabled).toBe(true);
  const count = fetchMock.mock.calls.length;
  await click('Refresh');
  await act(async () =>
    host
      .querySelector<HTMLFormElement>('[data-testid="electricity-price-contract-form"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(fetchMock.mock.calls).toHaveLength(count);
  await click('Retry captured price action');
  await click('Confirm action');
  const commands = fetchMock.mock.calls.filter(
    ([path, init]) => init?.method === 'POST' && !path.endsWith('/review')
  );
  expect(commands).toHaveLength(2);
  expect(commands[0]![1]!.body).toBe(commands[1]![1]!.body);
  expect(host.textContent).not.toContain('Retry captured price action');
  expect(host.querySelector<HTMLInputElement>('#price-reason')!.value).toBe('');
});

it.each(['denied', 'changed'] as const)(
  'fences a held refresh %s response once the captured write starts',
  async (lateRead) => {
    const heldRead = deferred<Response>();
    const heldWrite = deferred<Response>();
    let preview = staffPriceReview();
    let reads = 0;
    let writes = 0;
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/review')) {
        preview = staffPriceReview(body(init));
        return Response.json(deepSorted(preview));
      }
      if (init?.method === 'POST')
        return ++writes === 1
          ? heldWrite.promise
          : Response.json(staffPriceReceipt(preview, 'finalized'), { status: 201 });
      return ++reads === 2 ? heldRead.promise : Response.json(staffPriceState());
    });
    await render(fetchMock);
    await draft();
    await submitProposal();
    await settled(() => expect(dialogs.length).toBeGreaterThan(0));
    const capturedBody = dialogs.at(-1)!.action!.body;
    await click('Refresh');
    await settled(() => expect(reads).toBe(2));
    await click('Confirm action');
    await settled(() => expect(writes).toBe(1));
    await act(async () =>
      heldRead.resolve(
        lateRead === 'denied'
          ? Response.json({}, { status: 401 })
          : Response.json({
              ...staffPriceState(),
              profileId: '99999999-9999-4999-8999-999999999999',
              canPropose: false,
            })
      )
    );
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('#price-reason')!.value).toBe('Tariff change');
    expect(dialogs.at(-1)!.action!.body).toEqual(capturedBody);
    await act(async () => heldWrite.resolve(Response.json({}, { status: 201 })));
    await settled(() => expect(host.textContent).toContain('Retry captured price action'));
    await click('Retry captured price action');
    await click('Confirm action');
    const commands = fetchMock.mock.calls.filter(
      ([path, init]) => init?.method === 'POST' && !path.endsWith('/review')
    );
    expect(commands).toHaveLength(2);
    expect(commands[0]![1]!.body).toBe(commands[1]![1]!.body);
    expect(host.textContent).not.toContain('Retry captured price action');
    expect(host.querySelector<HTMLInputElement>('#price-reason')!.value).toBe('');
  }
);

it('keeps an unknown retry captured after a complete conflict and rejects old dialog callbacks', async () => {
  let preview = staffPriceReview();
  let writes = 0;
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/review')) {
      preview = staffPriceReview(body(init));
      return Response.json(preview);
    }
    if (init?.method === 'POST')
      return Response.json(
        ++writes === 1 ? {} : publicError([], ErrorCodes.CONFLICT_VERSION.code),
        { status: writes === 1 ? 201 : 409 }
      );
    return Response.json(staffPriceState());
  });
  await render(fetchMock);
  await draft();
  await submitProposal();
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  const old = dialogs.at(-1)!;
  await click('Confirm action');
  await click('Retry captured price action');
  const retry = dialogs.at(-1)!;
  await act(async () => {
    old.onClose();
    old.onDenied?.(403);
    old.onUnconfirmed?.();
  });
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(retry.action!.body).toEqual(old.action!.body);
  await click('Confirm action');
  await click('Close action');
  expect(host.textContent).toContain('Retry captured price action');
  expect(host.querySelector<HTMLInputElement>('#price-reason')!.disabled).toBe(true);
});

it.each([{ complete: true }, { complete: false }])(
  'requires complete owned write rejection before unlocking: $complete',
  async ({ complete }) => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) =>
      path.endsWith('/review')
        ? Response.json(staffPriceReview(body(init)))
        : init?.method === 'POST'
          ? Response.json(
              complete
                ? publicError(['reason'])
                : { error: { code: ErrorCodes.VALIDATION_INPUT_INVALID.code, fields: ['reason'] } },
              { status: 400 }
            )
          : Response.json(staffPriceState())
    );
    await render(fetchMock);
    await draft();
    await submitProposal();
    await settled(() => expect(dialogs.length).toBeGreaterThan(0));
    await click('Confirm action');
    if (complete) {
      await settled(() => expect(document.activeElement).toBe(host.querySelector('#price-reason')));
      expect(host.querySelector<HTMLInputElement>('#price-reason')!.disabled).toBe(false);
    } else {
      await click('Close action');
      expect(host.textContent).toContain('Retry captured price action');
      expect(host.querySelector('#price-reason')?.getAttribute('aria-invalid')).not.toBe('true');
    }
  }
);

it.each(['finalize', 'cancel'] as const)(
  'retains the exact %s command until a complete matching receipt',
  async (operation) => {
    const review = staffPriceReview();
    const proposal = staffPriceReceipt(review);
    let writes = 0;
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json(
            ++writes === 1
              ? {}
              : staffPriceReceipt(review, operation === 'finalize' ? 'finalized' : 'cancelled'),
            { status: 201 }
          )
        : Response.json(staffPriceState([proposal]))
    );
    await render(fetchMock);
    await click(operation === 'finalize' ? 'Finalize and issue adjustment' : 'Cancel proposal');
    await click('Confirm action');
    expect(host.textContent).toContain('Retry captured price action');
    await click('Retry captured price action');
    await click('Confirm action');
    const commands = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(commands).toHaveLength(2);
    expect(commands[0]![1]!.body).toBe(commands[1]![1]!.body);
    expect(body(commands[0]![1])).toEqual(
      operation === 'finalize'
        ? {
            idempotencyKey: expect.any(String),
            expectedCalculationSha256: proposal.calculationSha256,
          }
        : { idempotencyKey: expect.any(String) }
    );
    expect(host.textContent).not.toContain('Retry captured price action');
  }
);

it('withdraws drafts and private state after a denied held preview even when its draft changed', async () => {
  const held = deferred<Response>();
  const fetchMock = vi.fn(async (path: string, _init?: RequestInit) =>
    path.endsWith('/review') ? held.promise : Response.json(staffPriceState())
  );
  await render(fetchMock);
  await draft();
  await submitProposal();
  await settled(() =>
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/review'))).toHaveLength(1)
  );
  await fill('price-reason', 'Private edited reason');
  await act(async () => held.resolve(Response.json({}, { status: 403 })));
  expect(host.querySelector('#price-reason')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#electricity-price-contract')!.value).toBe('');
  expect(host.textContent).not.toContain('Private edited reason');
});

it('withdraws missing private history and recovers with an explicit authorized read', async () => {
  let status = 200;
  const row = staffPriceReceipt(staffPriceReview(), 'finalized');
  const fetchMock = vi.fn(async () =>
    status === 200 ? Response.json(staffPriceState([row])) : Response.json({}, { status })
  );
  await render(fetchMock);
  expect(host.textContent).toContain(row.reason);
  await fill('price-reason', 'Private draft');
  status = 404;
  await click('Refresh');
  expect(host.textContent).not.toContain(row.reason);
  expect(host.querySelector('#price-reason')).toBeNull();
  status = 200;
  await click('Try again');
  expect(host.querySelector<HTMLInputElement>('#price-reason')!.value).toBe('');
});

it('hides a private captured review at the new actor commit and fences all old callbacks', async () => {
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) =>
    path.endsWith('/review')
      ? Response.json(staffPriceReview(body(init)))
      : Response.json(staffPriceState())
  );
  await render(fetchMock);
  await draft();
  await submitProposal();
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  const old = dialogs.at(-1)!;
  await act(async () =>
    root!.render(
      <QueryComponentProvider>
        {
          <AccountUserProvider value="staff-2">
            <Page />
            <Probe actor="staff-2" />
          </AccountUserProvider>
        }
      </QueryComponentProvider>
    )
  );
  expect(snapshots.find((snapshot) => snapshot.actor === 'staff-2')?.review).toBe(false);
  const count = fetchMock.mock.calls.length;
  await act(async () => {
    old.onClose();
    old.onDenied?.(403);
    old.onUnconfirmed?.();
    await old.onSuccess(staffPriceReceipt());
  });
  expect(fetchMock.mock.calls).toHaveLength(count);
  expect(host.querySelector<HTMLInputElement>('#price-reason')!.value).toBe('');
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it.each(['10', '-10'])(
  'shows funding only for a captured charge proposal, percentage=%s',
  async (percentage) => {
    const fetchMock = vi.fn(async (path: string, init?: RequestInit) =>
      Response.json(path.endsWith('/review') ? staffPriceReview(body(init)) : staffPriceState())
    );
    await render(fetchMock);
    await draft();
    await fill('price-percent', percentage);
    await submitProposal();
    await settled(() =>
      expect(host.querySelector('[data-testid=order-wallet-balance]')?.textContent).toContain(
        'Available wallet balance: 0'
      )
    );
    const panel = host.querySelector('[data-testid=order-wallet-balance]')!;
    if (percentage === '10') expect(panel.textContent).toContain('Wallet top-up needed: 50000');
    else expect(panel.textContent).not.toContain('Wallet top-up needed:');
    expect(panel.querySelector('a')).toBeNull();
    expect(walletReads).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/review'))).toHaveLength(1);
  }
);
