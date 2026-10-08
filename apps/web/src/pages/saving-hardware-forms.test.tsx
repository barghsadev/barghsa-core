import { QueryProvider } from '../test/query-provider.js';
import { act, useState, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type * as ActionModule from '../components/TeamActionDialog.js';
import type * as SchemaModule from '../lib/saving-hardware-form-schemas.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { tSavingHardware } from '@barghsa/i18n/saving-hardware';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import {
  staffSavingAddressReview,
  staffSavingAddressReceipt,
  savingReplacementAddress,
} from '../test/saving-address-amendment-fixtures.js';
import {
  savingHardwareOrder,
  savingHardwareReview,
  savingHardwareReceipt,
  savingPendingUpgrade,
  savingCancellationReview,
  savingCancellationReceipt,
  upgradeId,
} from '../test/saving-hardware-form-fixtures.js';
import Page from './AdminSavingOrdersPage.js';
import { useListQuery } from '../hooks/useListQuery.js';
import { savingQueueOptions, staffOrderId } from '../lib/staff-order-list-query.js';
type DialogProps = ComponentProps<typeof ActionModule.TeamActionDialog>;
const capture = vi.hoisted(() => ({
  dialogs: [] as DialogProps[],
  lazy: null as Promise<void> | null,
  started: 0,
}));
vi.mock('../lib/saving-hardware-form-schemas.js', async (importOriginal) => {
  ++capture.started;
  if (capture.lazy) await capture.lazy;
  return importOriginal<typeof SchemaModule>();
});
vi.mock('../components/TeamActionDialog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ActionModule>();
  return {
    ...actual,
    TeamActionDialog: (props: DialogProps) => {
      capture.dialogs.push(props);
      return <actual.TeamActionDialog {...props} />;
    },
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params }: { children: ReactNode; params?: { invoiceId: string } }) => (
    <a href={`/invoices/${params?.invoiceId ?? ''}`}>{children}</a>
  ),
}));
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
let host: HTMLDivElement, root: Root | undefined;
let order = savingHardwareOrder();
type Family = 'hardware' | 'cancellation';
const formId = (family: Family) =>
  family === 'hardware' ? 'saving-staff-hardware-form' : `saving-upgrade-cancel-form-${upgradeId}`;
const reasonId = (family: Family) =>
  family === 'hardware' ? 'saving-amend-hardware-reason' : `saving-upgrade-cancel-${upgradeId}`;
const commitSuffix = (family: Family) =>
  family === 'hardware' ? '/amend-hardware' : '/cancel-hardware-upgrade';
function publicError(fields: unknown[], code: string = ErrorCodes.VALIDATION_INPUT_INVALID.code) {
  return { error: { code, message: 'PRIVATE_SERVER_TEXT', correlationId: order.id, fields } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
function payload(init?: RequestInit) {
  return JSON.parse(String(init?.body)) as Record<string, string>;
}
function mock(
  reply?: (path: string, init?: RequestInit) => Response | undefined | Promise<Response | undefined>
) {
  return vi.fn(async (path: string, init?: RequestInit) => {
    const response = await reply?.(path, init);
    if (response) return response;
    if (path.endsWith('/amend-hardware-review'))
      return Response.json(
        savingHardwareReview(payload(init).reason, order.hardwareOptions[0]!.priceDeltaIrR)
      );
    if (path.endsWith('/amend-hardware'))
      return Response.json(savingHardwareReceipt(order.hardwareOptions[0]!.priceDeltaIrR), {
        status: 201,
      });
    if (path.endsWith('/cancel-hardware-upgrade-review'))
      return Response.json(
        savingCancellationReview(payload(init).reason, order.hardwareUpgrades[0])
      );
    if (path.endsWith('/cancel-hardware-upgrade'))
      return Response.json(savingCancellationReceipt());
    if (path.endsWith('/amend-address-review'))
      return Response.json(staffSavingAddressReview(payload(init).reason));
    if (path.endsWith('/amend-address'))
      return Response.json(staffSavingAddressReceipt(), { status: 201 });
    if (path === `/api/staff/saving/orders/${order.id}`) return Response.json(order);
    return Response.json({
      orders: [order, { ...order, id: order.profileId, customerName: 'Other customer' }],
      nextAfter: order.id,
    });
  });
}
async function settled(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    check();
  });
}
function QueryPage() {
  const [raw, setRaw] = useState<Record<string, unknown>>({ lane: 'review' });
  const queue = useListQuery(savingQueueOptions, raw, (update) => setRaw(update));
  return (
    <Page
      queries={{
        queue,
        selected: staffOrderId(raw.orderId) || null,
        select: (id) => setRaw((current) => ({ ...current, orderId: id ?? undefined })),
        changeLane: (lane) =>
          setRaw((current) => ({ ...current, lane, cursor: undefined, orderId: undefined })),
      }}
    />
  );
}
async function render(
  fetcher: ReturnType<typeof mock>,
  locale: 'en' | 'fa' = 'en',
  queryBound = false
) {
  document.documentElement.lang = locale;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetcher);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <QueryProvider>
        <AccountUserProvider value="staff-opaque">
          {queryBound ? <QueryPage /> : <Page />}
        </AccountUserProvider>
      </QueryProvider>
    )
  );
  const item = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Buyer Company')
  )!;
  await act(async () => item.click());
}
async function fill(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
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
async function click(label: string) {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) =>
      button.textContent?.trim() === label ||
      (['Buyer Company', 'Other customer'].includes(label) && button.textContent?.includes(label))
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function submit(family: Family = 'hardware') {
  await act(async () =>
    host
      .querySelector<HTMLFormElement>(`[data-testid="${formId(family)}"] form`)!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function prepared(family: Family = 'hardware', reason = ' Hardware change ') {
  await fill(reasonId(family), reason);
  await submit(family);
  await settled(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
}
const commands = (fetcher: ReturnType<typeof mock>, family: Family) =>
  fetcher.mock.calls.filter(([path]) => String(path).endsWith(commitSuffix(family)));
function cancellationSource() {
  order = {
    ...savingHardwareOrder(),
    hardwareUpgrades: [savingPendingUpgrade()],
    canAmendHardware: false,
  };
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
  capture.dialogs.length = 0;
  capture.lazy = null;
  order = savingHardwareOrder();
});

it('guards duplicate lazy validation and discards old invalid results after editing the raw draft', async () => {
  const gate = deferred<void>();
  capture.lazy = gate.promise;
  const fetcher = mock();
  await render(fetcher);
  await submit();
  await submit();
  expect(capture.started).toBe(1);
  expect(
    [...host.querySelectorAll('button')].find((button) => button.textContent === 'Refresh')!
      .disabled
  ).toBe(true);
  await fill(reasonId('hardware'), ' Newly valid reason ');
  await act(async () => {
    capture.lazy = null;
    gate.resolve();
  });
  await settled(() =>
    expect(
      host.querySelector('[data-testid="saving-staff-hardware-form"] [role="status"]')
    ).toBeNull()
  );
  expect(host.querySelector('[aria-invalid="true"]')).toBeNull();
  expect(fetcher.mock.calls.some(([path]) => String(path).endsWith('-review'))).toBe(false);
  expect((document.getElementById(reasonId('hardware')) as HTMLInputElement).value).toBe(
    ' Newly valid reason '
  );
});
it.each(['en', 'fa'] as const)(
  'links touched reason feedback and focuses invalid hardware/1001 reason in %s',
  async (locale) => {
    const fetcher = mock();
    await render(fetcher, locale);
    const field = document.getElementById(reasonId('hardware'))!;
    expect(field.getAttribute('aria-invalid')).not.toBe('true');
    await act(async () => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await settled(() => {
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(
        field
          .getAttribute('aria-describedby')!
          .split(' ')
          .map((id) => document.getElementById(id)?.textContent)
          .join(' ')
      ).toContain(tSavingHardware('reasonInvalid', locale));
    });
    await fill('saving-amend-hardware', '');
    await submit();
    await settled(() =>
      expect(document.activeElement).toBe(document.getElementById('saving-amend-hardware'))
    );
    await fill('saving-amend-hardware', order.hardwareOptions[0]!.id);
    await fill(reasonId('hardware'), 'x'.repeat(1001));
    await submit();
    await settled(() => expect(document.activeElement).toBe(field));
    expect(fetcher.mock.calls.some(([path]) => String(path).endsWith('-review'))).toBe(false);
  }
);
it.each(['hardware', 'cancellation'] as const)(
  'projects owned reason feedback and preserves raw %s draft',
  async (family) => {
    if (family === 'cancellation') cancellationSource();
    const fetcher = mock((path) =>
      path.endsWith('-review') ? Response.json(publicError(['reason']), { status: 400 }) : undefined
    );
    await render(fetcher);
    await fill(reasonId(family), ' Original raw reason ');
    await submit(family);
    await settled(() =>
      expect(document.getElementById(reasonId(family))?.getAttribute('aria-invalid')).toBe('true')
    );
    await settled(() =>
      expect(document.activeElement).toBe(document.getElementById(reasonId(family)))
    );
    expect(document.body.textContent).not.toContain('PRIVATE_SERVER_TEXT');
    expect((document.getElementById(reasonId(family)) as HTMLInputElement).value).toBe(
      ' Original raw reason '
    );
  }
);
it.each([{ fields: ['hardwareProductId', 'expectedReviewHash'] }, { fields: ['upgradeId'] }])(
  'keeps protected/mixed preview metadata generic: $fields',
  async ({ fields }) => {
    const fetcher = mock((path) =>
      path.endsWith('-review') ? Response.json(publicError(fields), { status: 400 }) : undefined
    );
    await render(fetcher);
    await fill(reasonId('hardware'), ' Hardware change ');
    await submit();
    await settled(() =>
      expect(
        host.querySelector('[data-testid="saving-staff-hardware-form"] [role="alert"]')
      ).not.toBeNull()
    );
    expect(host.querySelector('[aria-invalid="true"]')).toBeNull();
    expect((document.getElementById(reasonId('hardware')) as HTMLInputElement).value).toBe(
      ' Hardware change '
    );
  }
);
it('ignores stale owned feedback when a held preview draft has been corrected', async () => {
  const held = deferred<Response>();
  const fetcher = mock((path) =>
    path.endsWith('/amend-hardware-review') ? held.promise : undefined
  );
  await render(fetcher);
  await fill(reasonId('hardware'), ' First raw reason ');
  await submit();
  await fill(reasonId('hardware'), ' Corrected raw reason ');
  await act(async () => held.resolve(Response.json(publicError(['reason']), { status: 400 })));
  await settled(() =>
    expect(
      host.querySelector('[data-testid="saving-staff-hardware-form"] [role="status"]')
    ).toBeNull()
  );
  expect(host.querySelector('[aria-invalid="true"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it.each(['50000', '0', '-50000'])(
  'clears only the owning hardware draft after exact %s receipt',
  async (delta) => {
    order = savingHardwareOrder(delta);
    const fetcher = mock();
    await render(fetcher);
    await fill('saving-staff-note', 'Keep fulfillment draft');
    await fill('saving-amend-address', savingReplacementAddress.id);
    await fill('saving-amend-reason', 'Keep address draft');
    await prepared();
    expect(document.body.textContent).toContain('Accepted agreement');
    await click('Confirm');
    await settled(() =>
      expect((document.getElementById(reasonId('hardware')) as HTMLInputElement)?.value).toBe('')
    );
    expect((document.getElementById('saving-staff-note') as HTMLInputElement).value).toBe(
      'Keep fulfillment draft'
    );
    expect((document.getElementById('saving-amend-reason') as HTMLInputElement).value).toBe(
      'Keep address draft'
    );
    const captured = payload(commands(fetcher, 'hardware')[0]![1]);
    expect(captured).toMatchObject({
      expectedVersionId: order.versionId,
      expectedHardwareId: order.hardwareProductId,
      expectedReviewHash: 'b'.repeat(64),
    });
  }
);
it.each(['hardware', 'cancellation'] as const)(
  'retains exact %s command through malformed receipt, stale GET and rejected uncertain retry',
  async (family) => {
    if (family === 'cancellation') cancellationSource();
    const held = deferred<Response>();
    let writes = 0;
    const fetcher = mock((path) => {
      if (!path.endsWith(commitSuffix(family))) return undefined;
      ++writes;
      if (writes === 1) return held.promise;
      if (writes === 2) return Response.json(publicError(['reason']), { status: 400 });
      return Response.json(
        family === 'hardware' ? savingHardwareReceipt() : savingCancellationReceipt(),
        { status: family === 'hardware' ? 201 : 200 }
      );
    });
    await render(fetcher);
    await fill('saving-staff-note', 'Companion draft');
    await fill('saving-amend-address', savingReplacementAddress.id);
    await fill('saving-amend-reason', 'Keep sibling address draft');
    await prepared(family, ' Exact raw reason ');
    await click('Confirm');
    const addressForm = host.querySelector<HTMLFormElement>(
      '[data-testid="saving-staff-address-form"] form'
    )!;
    const addressButton = addressForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    await settled(() => {
      expect(commands(fetcher, family)).toHaveLength(1);
      expect(addressButton.disabled).toBe(true);
    });
    await act(async () =>
      held.resolve(
        Response.json(
          { savingOrderId: order.profileId },
          { status: family === 'hardware' ? 201 : 200 }
        )
      )
    );
    const retry =
      family === 'hardware'
        ? 'Retry captured hardware change'
        : 'Retry captured upgrade cancellation';
    await settled(() => expect(document.body.textContent).toContain(retry));
    expect(addressButton.disabled).toBe(true);
    await act(async () =>
      addressForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(fetcher.mock.calls.some(([path]) => path.endsWith('/amend-address-review'))).toBe(false);
    expect((document.getElementById('saving-amend-reason') as HTMLInputElement).value).toBe(
      'Keep sibling address draft'
    );
    const reads = fetcher.mock.calls.filter(([, init]) => !init?.method).length;
    await click('Refresh');
    await click('Fulfillment');
    expect(fetcher.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(reads);
    expect((document.getElementById(reasonId(family)) as HTMLInputElement).disabled).toBe(true);
    await click(retry);
    await click('Confirm');
    await click('Cancel');
    expect(document.body.textContent).toContain(retry);
    await click(retry);
    await click('Confirm');
    await settled(() => expect(commands(fetcher, family)).toHaveLength(3));
    expect(commands(fetcher, family).map(([, init]) => init?.body)).toEqual(
      Array(3).fill(commands(fetcher, family)[0]![1]!.body)
    );
    expect((document.getElementById('saving-staff-note') as HTMLInputElement).value).toBe(
      'Companion draft'
    );
    await settled(() => expect(addressButton.disabled).toBe(false));
    expect((document.getElementById('saving-amend-reason') as HTMLInputElement).value).toBe(
      'Keep sibling address draft'
    );
  }
);
it('uses actual password step-up then retries the exact immutable hardware command', async () => {
  let writes = 0;
  const fetcher = mock((path) => {
    if (path === '/api/auth/step-up') return Response.json({ verified: true });
    if (path.endsWith('/amend-hardware') && ++writes === 1)
      return Response.json(
        { error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code }, requiresStepUp: true },
        { status: 403 }
      );
    return undefined;
  });
  await render(fetcher);
  await prepared();
  await click('Confirm');
  await settled(() => expect(document.getElementById('team-step-up-password')).not.toBeNull());
  await fill('team-step-up-password', 'proof-password');
  await click('Confirm');
  await settled(() => expect(commands(fetcher, 'hardware')).toHaveLength(2));
  expect(commands(fetcher, 'hardware')[1]![1]!.body).toBe(
    commands(fetcher, 'hardware')[0]![1]!.body
  );
  expect(fetcher.mock.calls.find(([path]) => path === '/api/auth/step-up')?.[1]?.body).toBe(
    JSON.stringify({ password: 'proof-password' })
  );
});
it('retains an attempted command after a complete unknown 4xx rejection', async () => {
  let writes = 0;
  const fetcher = mock((path) => {
    if (!path.endsWith('/amend-hardware')) return undefined;
    ++writes;
    return writes === 1
      ? Response.json(publicError(['reason'], 'UNCLASSIFIED:FUTURE_RULE'), { status: 400 })
      : Response.json(savingHardwareReceipt(), { status: 201 });
  });
  await render(fetcher);
  await prepared();
  await click('Confirm');
  await click('Cancel');
  expect((document.getElementById(reasonId('hardware')) as HTMLInputElement).disabled).toBe(true);
  expect(document.body.textContent).toContain('Retry captured hardware change');
  await click('Retry captured hardware change');
  await click('Confirm');
  await settled(() => expect(commands(fetcher, 'hardware')).toHaveLength(2));
  expect(commands(fetcher, 'hardware')[1]![1]!.body).toBe(
    commands(fetcher, 'hardware')[0]![1]!.body
  );
});
it('releases a known original rejection into focused owned feedback but preserves the raw draft', async () => {
  const fetcher = mock((path) =>
    path.endsWith('/amend-hardware')
      ? Response.json(publicError(['reason']), { status: 400 })
      : undefined
  );
  await render(fetcher);
  await prepared();
  await click('Confirm');
  await settled(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  await settled(() =>
    expect(document.activeElement).toBe(document.getElementById(reasonId('hardware')))
  );
  expect((document.getElementById(reasonId('hardware')) as HTMLInputElement).value).toBe(
    ' Hardware change '
  );
  expect((document.getElementById(reasonId('hardware')) as HTMLInputElement).disabled).toBe(false);
});
it('keeps upgrade reasons separate across current history generations and readonly historical rows', async () => {
  cancellationSource();
  const fetcher = mock();
  await render(fetcher);
  await fill(reasonId('cancellation'), 'First upgrade reason');
  order = { ...order, hardwareUpgrades: [{ ...savingPendingUpgrade(), id: order.profileId }] };
  await click('Refresh');
  await settled(() =>
    expect(document.getElementById(`saving-upgrade-cancel-${order.profileId}`)).not.toBeNull()
  );
  expect(
    (document.getElementById(`saving-upgrade-cancel-${order.profileId}`) as HTMLInputElement).value
  ).toBe('');
  order = { ...order, hardwareUpgrades: [{ ...savingPendingUpgrade(), status: 'cancelled' }] };
  await click('Refresh');
  await settled(() => expect(document.getElementById(reasonId('cancellation'))).toBeNull());
});
it.each([401, 403, 404])(
  'withdraws the current whole private resource on hardware preview %s',
  async (status) => {
    const fetcher = mock((path) =>
      path.endsWith('/amend-hardware-review') ? Response.json({}, { status }) : undefined
    );
    await render(fetcher);
    await fill('saving-staff-note', 'Private note');
    await fill(reasonId('hardware'), 'Hardware change');
    await submit();
    await settled(() => expect(document.getElementById('saving-staff-note')).toBeNull());
    expect(host.querySelector('[data-testid="saving-staff-hardware-form"]')).toBeNull();
  }
);
it('clears companion address cache after current hardware404 and authorized detail retry', async () => {
  const fetcher = mock((path) =>
    path.endsWith('/amend-hardware-review') ? Response.json({}, { status: 404 }) : undefined
  );
  await render(fetcher);
  await fill('saving-amend-address', savingReplacementAddress.id);
  await fill('saving-amend-reason', 'Private address draft');
  await fill(reasonId('hardware'), 'Private hardware reason');
  await submit();
  await settled(() => expect(document.getElementById('saving-amend-reason')).toBeNull());
  await click('Retry');
  await settled(() => expect(document.getElementById('saving-amend-reason')).not.toBeNull());
  expect((document.getElementById('saving-amend-reason') as HTMLInputElement).value).toBe('');
  expect((document.getElementById('saving-amend-address') as HTMLSelectElement).value).toBe(
    order.installationAddressId
  );
  expect((document.getElementById(reasonId('hardware')) as HTMLInputElement).value).toBe('');
});
it('fences old actor/profile dialog callbacks from clearing the new private workspace', async () => {
  let holdDetail = false;
  const fetcher = mock((path) =>
    holdDetail && path === `/api/staff/saving/orders/${order.id}`
      ? new Promise<Response>(() => {})
      : undefined
  );
  await render(fetcher);
  await prepared();
  const old = capture.dialogs.at(-1)!;
  await act(async () =>
    root!.render(
      <QueryProvider>
        <AccountUserProvider value="new-staff">
          <Page />
        </AccountUserProvider>
      </QueryProvider>
    )
  );
  await settled(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  await click('Buyer Company');
  await fill(reasonId('hardware'), 'New actor draft');
  await act(async () => {
    await old.onSuccess(savingHardwareReceipt());
    old.onDenied?.(403);
    old.onClose();
    old.onUnconfirmed?.();
  });
  expect((document.getElementById(reasonId('hardware')) as HTMLInputElement).value).toBe(
    'New actor draft'
  );
  holdDetail = true;
  await act(async () => {
    await refreshProfileContext();
  });
  expect(document.getElementById(reasonId('hardware'))).toBeNull();
});
it('fences a held queue denial as soon as hardware preparation owns the workspace', async () => {
  const held = deferred<Response>();
  const fetcher = mock((path) => (path.includes('after=') ? held.promise : undefined));
  await render(fetcher);
  await click('More orders');
  await prepared();
  await act(async () => held.resolve(Response.json({}, { status: 403 })));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await click('Confirm');
  await settled(() => expect(commands(fetcher, 'hardware')).toHaveLength(1));
});

it.each([false, true])(
  'retries the same older cursor after hardware preparation, with route binding %s',
  async (queryBound) => {
    const held = deferred<Response>();
    let reads = 0;
    const fetcher = mock((path) =>
      path.includes('after=') && ++reads === 1 ? held.promise : undefined
    );
    await render(fetcher, 'en', queryBound);
    await click('More orders');
    await prepared();
    await click('Cancel');
    await act(async () => held.resolve(Response.json({}, { status: 403 })));
    await click('More orders');
    await settled(() => {
      expect(reads).toBe(2);
      const more = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'More orders'
      );
      expect(more?.disabled ?? true).toBe(true);
    });
    expect((document.getElementById(reasonId('hardware')) as HTMLInputElement).value).toBe(
      ' Hardware change '
    );
  }
);
