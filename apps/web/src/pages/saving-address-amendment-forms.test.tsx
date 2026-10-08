import { QueryComponentProvider as QueryProvider } from '../test/query-provider.js';
import { act, useLayoutEffect, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import type * as ActionModule from '../components/TeamActionDialog.js';
import type * as SchemaModule from '../lib/saving-address-amendment-form-schemas.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import {
  staffSavingAddressOrder,
  staffSavingAddressReview,
  staffSavingAddressReceipt,
  savingReplacementAddress,
} from '../test/saving-address-amendment-fixtures.js';
import Page from './AdminSavingOrdersPage.js';

type DialogProps = ComponentProps<typeof ActionModule.TeamActionDialog>;
const dialogs = vi.hoisted(() => [] as DialogProps[]);
const lazy = vi.hoisted(() => ({ hold: null as Promise<void> | null }));
vi.mock('../lib/saving-address-amendment-form-schemas.js', async (importOriginal) => {
  if (lazy.hold) await lazy.hold;
  return importOriginal<typeof SchemaModule>();
});
vi.mock('../components/TeamActionDialog.js', async (importOriginal) => {
  const original = await importOriginal<typeof ActionModule>();
  return {
    ...original,
    TeamActionDialog: (props: DialogProps) => {
      dialogs.push(props);
      return (
        <div role="dialog">
          {props.summary}
          <button onClick={props.onClose}>Close address</button>
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
                } else if (
                  action.successStatus !== undefined &&
                  response.status !== action.successStatus
                )
                  props.onUnconfirmed?.();
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
            Confirm address
          </button>
        </div>
      );
    },
  };
});
vi.mock('../components/ContractCancellationRequestQueue.js', () => ({
  ContractCancellationRequestQueue: () => null,
}));
vi.mock('../components/SavingOrderDocuments.js', () => ({ SavingOrderDocuments: () => null }));
vi.mock('../components/SavingOrderComments.js', () => ({ SavingOrderComments: () => null }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, number: String }),
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: String, notice: null }),
}));
const order = staffSavingAddressOrder();
const otherId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
let root: Root | undefined;
let host: HTMLDivElement;
const commits: boolean[] = [];
function Probe({ actor }: { actor: string }) {
  useLayoutEffect(() => {
    commits.push(!!host.querySelector('[role="dialog"]'));
  }, [actor]);
  return null;
}
async function render(fetchMock: ReturnType<typeof vi.fn>, actor = 'staff-actor') {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetchMock);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QueryProvider>
        <AccountUserProvider value={actor}>
          <Page />
          <Probe actor={actor} />
        </AccountUserProvider>
      </QueryProvider>
    )
  );
  await click('Buyer Company');
}
async function settled(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    check();
  });
}
async function click(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) =>
      item.textContent?.trim() === label ||
      (['Buyer Company', 'Other customer'].includes(label) && item.textContent?.includes(label))
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function fill(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  expect(input, id).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, value);
    input.dispatchEvent(
      new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })
    );
  });
}
async function draft(reason = ' Address correction ') {
  await fill('saving-amend-address', savingReplacementAddress.id);
  await fill('saving-amend-reason', reason);
}
async function submit() {
  await act(async () =>
    host
      .querySelector<HTMLFormElement>('[data-testid="saving-staff-address-form"] form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
function body(init?: RequestInit) {
  return JSON.parse(String(init?.body)) as Record<string, string>;
}
function mock(
  reply?: (path: string, init?: RequestInit) => Response | undefined | Promise<Response | undefined>
) {
  return vi.fn(async (path: string, init?: RequestInit) => {
    const response = await reply?.(path, init);
    if (response) return response;
    if (path.endsWith('/amend-address-review'))
      return Response.json(staffSavingAddressReview(body(init).reason));
    if (path.endsWith('/amend-address'))
      return Response.json(staffSavingAddressReceipt(), { status: 201 });
    if (path === `/api/staff/saving/orders/${order.id}`) return Response.json(order);
    return Response.json({
      orders: [order, { ...order, id: otherId, orderId: otherId, customerName: 'Other customer' }],
      nextAfter: order.id,
    });
  });
}
function publicError(fields: unknown[], code: string = ErrorCodes.VALIDATION_INPUT_INVALID.code) {
  return { error: { code, message: 'Invalid', correlationId: order.id, fields } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  dialogs.length = 0;
  commits.length = 0;
  lazy.hold = null;
  vi.unstubAllGlobals();
});

it('synchronously owns held lazy validation and ignores an edited draft before preview', async () => {
  const held = deferred<void>();
  lazy.hold = held.promise;
  const fetchMock = mock();
  await render(fetchMock);
  await draft();
  await submit();
  await submit();
  expect(dialogs).toHaveLength(0);
  expect(
    fetchMock.mock.calls.filter(([path]) => path.endsWith('/amend-address-review'))
  ).toHaveLength(0);
  expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.disabled).toBe(false);
  await fill('saving-amend-reason', ' Edited correction ');
  await act(async () => held.resolve());
  await settled(() => expect(host.querySelector('[aria-busy="true"]')).toBeNull());
  expect(dialogs).toHaveLength(0);
  await submit();
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  expect(
    body(fetchMock.mock.calls.find(([path]) => path.endsWith('/amend-address-review'))![1]).reason
  ).toBe('Edited correction');
});
it('focuses touched unchanged address then invalid reason while preserving the selected companion', async () => {
  await render(mock());
  await fill('saving-amend-reason', ' Retained reason ');
  await submit();
  await settled(() =>
    expect(document.activeElement).toBe(host.querySelector('#saving-amend-address'))
  );
  expect(host.querySelector('#saving-amend-address')?.getAttribute('aria-describedby')).toContain(
    'saving-amend-address-message'
  );
  await draft('x'.repeat(1001));
  await submit();
  await settled(() =>
    expect(document.activeElement).toBe(host.querySelector('#saving-amend-reason'))
  );
  expect(host.querySelector<HTMLSelectElement>('#saving-amend-address')!.value).toBe(
    savingReplacementAddress.id
  );
});
it.each([
  'invoiceId',
  'contractId',
  'contractState',
  'previousAddress',
  'billIdentifier',
  'replacementAddress',
])('rejects a full financial review with a foreign displayed source: %s', async (field) => {
  const reviewed = staffSavingAddressReview();
  const data = {
    ...reviewed.data,
    ...(field === 'invoiceId' ? { invoiceId: otherId } : {}),
    ...(field === 'contractId' ? { contractId: otherId } : {}),
    ...(field === 'contractState' ? { contractState: 'AwaitingCustomerAcceptance' } : {}),
    ...(field === 'previousAddress'
      ? { previousAddress: { ...reviewed.data.previousAddress, postal_code: '1111111111' } }
      : {}),
    ...(field === 'billIdentifier' ? { billIdentifier: '9999999999999' } : {}),
    ...(field === 'replacementAddress'
      ? {
          replacementAddress: {
            ...reviewed.data.replacementAddress,
            full_address: 'Foreign address',
          },
        }
      : {}),
  };
  await render(
    mock((path) =>
      path.endsWith('/amend-address-review') ? Response.json({ ...reviewed, data }) : undefined
    )
  );
  await draft();
  await submit();
  await settled(() =>
    expect(host.textContent).toContain('The financial review could not be loaded. Try again.')
  );
  expect(dialogs).toHaveLength(0);
  expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.value).toBe(
    ' Address correction '
  );
});
it.each(['addressId', 'reason'])(
  'projects owned preview %s feedback without losing raw companions',
  async (field) => {
    await render(
      mock((path) =>
        path.endsWith('/amend-address-review')
          ? Response.json(publicError([field]), { status: 400 })
          : undefined
      )
    );
    await draft();
    await submit();
    await settled(() =>
      expect(document.activeElement).toBe(
        host.querySelector(field === 'reason' ? '#saving-amend-reason' : '#saving-amend-address')
      )
    );
    expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.value).toBe(
      ' Address correction '
    );
    expect(host.querySelector<HTMLSelectElement>('#saving-amend-address')!.value).toBe(
      savingReplacementAddress.id
    );
  }
);
it('keeps mixed protected preview metadata generic', async () => {
  const fetchMock = mock((path) =>
    path.endsWith('/amend-address-review')
      ? Response.json(publicError(['reason', 'expectedReviewHash']), { status: 400 })
      : undefined
  );
  await render(fetchMock);
  await draft();
  await submit();
  await settled(() =>
    expect(
      fetchMock.mock.calls.filter(([path]) => path.endsWith('/amend-address-review'))
    ).toHaveLength(1)
  );
  expect(host.querySelector('#saving-amend-reason')?.getAttribute('aria-invalid')).not.toBe('true');
  expect(dialogs).toHaveLength(0);
});
it.each([200, 400])(
  'discards an edited held preview %s and blocks duplicate and competing preparations',
  async (status) => {
    const held = deferred<Response>();
    const fetchMock = mock((path) =>
      path.endsWith('/amend-address-review') ? held.promise : undefined
    );
    await render(fetchMock);
    await fill('saving-amend-hardware-reason', 'Hardware retained');
    await draft();
    await submit();
    await submit();
    await click('Swap hardware');
    await settled(() =>
      expect(
        fetchMock.mock.calls.filter(([path]) => path.endsWith('/amend-address-review'))
      ).toHaveLength(1)
    );
    expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/amend-hardware-review'))).toBe(
      false
    );
    await fill('saving-amend-reason', ' Edited correction ');
    await act(async () =>
      held.resolve(
        status === 200
          ? Response.json(staffSavingAddressReview())
          : Response.json(publicError(['reason']), { status: 400 })
      )
    );
    expect(dialogs).toHaveLength(0);
    expect(host.querySelector('#saving-amend-reason')?.getAttribute('aria-invalid')).not.toBe(
      'true'
    );
    expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.value).toBe(
      ' Edited correction '
    );
  }
);
it.each(['malformed', 'foreignAddress', 'wrongStatus'])(
  'retains %s receipt uncertainty and retries exact command while preserving unrelated drafts',
  async (failure) => {
    let writes = 0;
    const fetchMock = mock((path) =>
      path.endsWith('/amend-address')
        ? Response.json(
            ++writes > 1
              ? staffSavingAddressReceipt()
              : failure === 'malformed'
                ? {}
                : failure === 'foreignAddress'
                  ? {
                      ...staffSavingAddressReceipt(),
                      address: { ...savingReplacementAddress, postal_code: '1111111111' },
                    }
                  : staffSavingAddressReceipt(),
            { status: failure === 'wrongStatus' && writes === 1 ? 200 : 201 }
          )
        : undefined
    );
    await render(fetchMock);
    await fill('saving-amend-hardware-reason', 'Hardware retained');
    await fill('saving-staff-note', 'Decision retained');
    await draft();
    await submit();
    await settled(() => expect(dialogs.length).toBeGreaterThan(0));
    await click('Confirm address');
    expect(host.textContent).toContain('Retry captured address amendment');
    expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.disabled).toBe(true);
    const count = fetchMock.mock.calls.length;
    await click('Refresh');
    expect(
      [...host.querySelectorAll('button')].find((button) => button.textContent === 'More orders')
    ).toBeUndefined();
    await click('Fulfillment');
    await click('Swap hardware');
    await submit();
    expect(fetchMock.mock.calls).toHaveLength(count);
    await click('Retry captured address amendment');
    await click('Confirm address');
    const commands = fetchMock.mock.calls.filter(([path]) => path.endsWith('/amend-address'));
    expect(commands).toHaveLength(2);
    expect(commands[0]![1]!.body).toBe(commands[1]![1]!.body);
    expect(body(commands[0]![1])).toMatchObject({
      expectedReviewHash: 'a'.repeat(64),
      expectedVersionId: order.versionId,
      expectedAddressId: order.installationAddressId,
      addressId: savingReplacementAddress.id,
      reason: 'Address correction',
    });
    expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.value).toBe('');
    expect(host.querySelector<HTMLInputElement>('#saving-amend-hardware-reason')!.value).toBe(
      'Hardware retained'
    );
    expect(host.querySelector<HTMLInputElement>('#saving-staff-note')!.value).toBe(
      'Decision retained'
    );
  }
);
it.each([true, false])(
  'requires complete owned write rejection before unlocking: %s',
  async (complete) => {
    await render(
      mock((path) =>
        path.endsWith('/amend-address')
          ? Response.json(
              complete
                ? publicError(['reason'])
                : { error: { code: ErrorCodes.VALIDATION_INPUT_INVALID.code, fields: ['reason'] } },
              { status: 400 }
            )
          : undefined
      )
    );
    await draft();
    await submit();
    await settled(() => expect(dialogs.length).toBeGreaterThan(0));
    await click('Confirm address');
    if (complete) {
      await settled(() =>
        expect(document.activeElement).toBe(host.querySelector('#saving-amend-reason'))
      );
      expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.disabled).toBe(false);
    } else {
      await click('Close address');
      expect(host.textContent).toContain('Retry captured address amendment');
    }
  }
);
it('retains unknown ownership after a rejected retry and ignores the old dialog callbacks', async () => {
  let writes = 0;
  await render(
    mock((path) =>
      path.endsWith('/amend-address')
        ? Response.json(++writes === 1 ? {} : publicError(['reason']), {
            status: writes === 1 ? 201 : 400,
          })
        : undefined
    )
  );
  await draft();
  await submit();
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  const old = dialogs.at(-1)!;
  await click('Confirm address');
  await click('Retry captured address amendment');
  await act(async () => {
    old.onDenied?.(403);
    old.onClose();
    await old.onSuccess(staffSavingAddressReceipt());
  });
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  await click('Confirm address');
  await click('Close address');
  expect(host.textContent).toContain('Retry captured address amendment');
  expect(host.querySelector('#saving-amend-reason')?.getAttribute('aria-invalid')).not.toBe('true');
});
it.each([403, 404])(
  'withdraws current private preview after %s, including an edited draft',
  async (status) => {
    const held = deferred<Response>();
    const fetchMock = mock((path) =>
      path.endsWith('/amend-address-review') ? held.promise : undefined
    );
    await render(fetchMock);
    await draft();
    await submit();
    await settled(() =>
      expect(fetchMock.mock.calls.some(([path]) => path.endsWith('/amend-address-review'))).toBe(
        true
      )
    );
    await fill('saving-amend-reason', 'Private edited reason');
    await act(async () => held.resolve(Response.json({}, { status })));
    expect(host.querySelector('#saving-amend-reason')).toBeNull();
    expect(host.textContent).not.toContain('Private edited reason');
    if (status === 404) {
      expect(host.textContent).not.toContain('Buyer Company');
      expect(host.textContent).toContain('Other customer');
      await click('Retry');
      expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.value).toBe('');
    }
  }
);
it('hides old actor review at the new actor commit and rejects all old callbacks', async () => {
  await render(mock());
  await draft();
  await submit();
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  const old = dialogs.at(-1)!;
  await act(async () =>
    root!.render(
      <QueryProvider>
        <AccountUserProvider value="new-staff">
          <Page />
          <Probe actor="new-staff" />
        </AccountUserProvider>
      </QueryProvider>
    )
  );
  expect(commits.at(-1)).toBe(false);
  await fill('saving-amend-reason', 'Current draft');
  await act(async () => {
    old.onDenied?.(403);
    old.onUnconfirmed?.();
    old.onClose();
    await old.onSuccess(staffSavingAddressReceipt());
  });
  expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.value).toBe('Current draft');
});
it('clears old private scope on confirmed profile context change and fences old callbacks', async () => {
  await render(mock());
  await draft();
  await submit();
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  const old = dialogs.at(-1)!;
  await act(async () => refreshProfileContext());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await fill('saving-amend-reason', 'Current profile draft');
  await act(async () => old.onDenied?.(403));
  expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.value).toBe(
    'Current profile draft'
  );
});
it('ignores a held queue denial from the previous confirmed profile context', async () => {
  const held = deferred<Response>();
  let queueReads = 0;
  await render(
    mock((path) => (path.includes('&after=') && ++queueReads === 1 ? held.promise : undefined))
  );
  await click('More orders');
  await act(async () => refreshProfileContext());
  await fill('saving-amend-reason', 'Current profile reason');
  await act(async () => held.resolve(Response.json({}, { status: 403 })));
  expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.value).toBe(
    'Current profile reason'
  );
  expect(host.textContent).toContain('Buyer Company');
});
it('ignores a held queue denial after switching to an authorized lane', async () => {
  const held = deferred<Response>();
  await render(mock((path) => (path.includes('&after=') ? held.promise : undefined)));
  await click('More orders');
  await click('Fulfillment');
  await click('Buyer Company');
  await fill('saving-amend-reason', 'Current lane reason');
  await act(async () => held.resolve(Response.json({}, { status: 403 })));
  expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.value).toBe(
    'Current lane reason'
  );
});
it('ignores a held preview after selecting another order', async () => {
  const held = deferred<Response>();
  const fetchMock = mock((path) =>
    path.endsWith('/amend-address-review')
      ? held.promise
      : path === `/api/staff/saving/orders/${otherId}`
        ? Response.json({ ...order, id: otherId, orderId: otherId })
        : undefined
  );
  await render(fetchMock);
  await draft();
  await submit();
  await click('Other customer');
  await act(async () => held.resolve(Response.json(staffSavingAddressReview())));
  expect(dialogs).toHaveLength(0);
  expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.value).toBe('');
});
it('fences a held queue read once the prepared address write starts', async () => {
  const heldRead = deferred<Response>();
  const heldWrite = deferred<Response>();
  let writes = 0;
  const fetchMock = mock((path) =>
    path.includes('&after=')
      ? heldRead.promise
      : path.endsWith('/amend-address')
        ? ++writes === 1
          ? heldWrite.promise
          : Response.json(staffSavingAddressReceipt(), { status: 201 })
        : undefined
  );
  await render(fetchMock);
  await draft();
  await submit();
  await settled(() => expect(dialogs.length).toBeGreaterThan(0));
  await click('More orders');
  await click('Confirm address');
  await act(async () => heldRead.resolve(Response.json({}, { status: 403 })));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => heldWrite.resolve(Response.json({}, { status: 201 })));
  expect(host.textContent).toContain('Retry captured address amendment');
  await click('Retry captured address amendment');
  await click('Confirm address');
  expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.value).toBe('');
});
it('preserves raw address choices and reason through an ordinary unchanged authorized refresh', async () => {
  await render(mock());
  await draft(' Raw retained reason ');
  await click('Refresh');
  expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.value).toBe(
    ' Raw retained reason '
  );
  expect(host.querySelector<HTMLSelectElement>('#saving-amend-address')!.value).toBe(
    savingReplacementAddress.id
  );
});
it('withdraws a currently missing detail read and clears its private draft before explicit recovery', async () => {
  let detailReads = 0;
  await render(
    mock((path) =>
      path === `/api/staff/saving/orders/${order.id}` && ++detailReads === 2
        ? Response.json({}, { status: 404 })
        : undefined
    )
  );
  await draft('Private address reason');
  await fill('saving-amend-hardware-reason', 'Private hardware reason');
  await fill('saving-staff-note', 'Private decision note');
  await click('Refresh');
  expect(host.querySelector('#saving-amend-reason')).toBeNull();
  expect(host.textContent).not.toContain('Buyer Company');
  expect(host.textContent).toContain('Other customer');
  await click('Retry');
  expect(host.querySelector<HTMLInputElement>('#saving-amend-reason')!.value).toBe('');
  expect(host.querySelector<HTMLSelectElement>('#saving-amend-address')!.value).toBe(
    order.installationAddressId
  );
  expect(host.querySelector<HTMLInputElement>('#saving-amend-hardware-reason')!.value).toBe('');
  expect(host.querySelector<HTMLInputElement>('#saving-staff-note')!.value).toBe('');
});
