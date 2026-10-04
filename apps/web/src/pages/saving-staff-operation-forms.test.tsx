import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type * as ActionModule from '../components/TeamActionDialog.js';
import type * as SchemaModule from '../lib/saving-staff-operation-form-schemas.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { tSavingOperations } from '@barghsa/i18n/saving-operations';
import type {
  SavingOperationIntent,
  SavingOperationStage,
} from '../lib/saving-staff-operation-form.js';
import {
  savingDecisionReview,
  savingOperationOrder,
  savingStageReview,
  savingOperationReceipt,
} from '../test/saving-staff-operation-fixtures.js';
import {
  savingReplacementAddress,
  staffSavingAddressReview,
  staffSavingAddressReceipt,
} from '../test/saving-address-amendment-fixtures.js';
import {
  savingHardwareReview,
  savingHardwareReceipt,
} from '../test/saving-hardware-form-fixtures.js';
import Page from './AdminSavingOrdersPage.js';

type DialogProps = ComponentProps<typeof ActionModule.TeamActionDialog>;
const capture = vi.hoisted(() => ({
  dialogs: [] as DialogProps[],
  lazy: null as Promise<void> | null,
  started: 0,
}));
vi.mock('../lib/saving-staff-operation-form-schemas.js', async (importOriginal) => {
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
let order = savingOperationOrder();
let host: HTMLDivElement, root: Root | undefined;
function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value: T) => resolve(value),
  };
}
function payload(init?: RequestInit) {
  return JSON.parse(String(init?.body)) as Record<string, string>;
}
function publicError(fields: unknown[], code: string = ErrorCodes.VALIDATION_INPUT_INVALID.code) {
  return { error: { code, message: 'PRIVATE_SERVER_TEXT', correlationId: order.id, fields } };
}
function mock(
  reply?: (path: string, init?: RequestInit) => Response | undefined | Promise<Response | undefined>
) {
  return vi.fn(async (path: string, init?: RequestInit) => {
    const answer = await reply?.(path, init);
    if (answer) return answer;
    if (path.endsWith('/financial-review')) {
      const body = payload(init);
      return Response.json(
        savingDecisionReview(order, body.action as 'approve' | 'reject', body.reason)
      );
    }
    if (path.endsWith('/approve') || path.endsWith('/reject'))
      return Response.json(
        savingOperationReceipt(order, {
          kind: 'decision',
          action: path.endsWith('/approve') ? 'approve' : 'reject',
        })
      );
    const stage = /\/stages\/([^/]+)\/(complete|skip)(\/review)?$/.exec(path);
    if (stage) {
      const intent: SavingOperationIntent = {
        kind: 'stage',
        stage: stage[1] as SavingOperationStage,
        action: stage[2] as 'complete' | 'skip',
      };
      const body = payload(init);
      return Response.json(
        stage[3]
          ? savingStageReview(
              order,
              intent.stage,
              intent.action,
              body.explanation!,
              body.handoverDescription
            )
          : savingOperationReceipt(order, intent)
      );
    }
    if (path.endsWith('/amend-address-review'))
      return Response.json(staffSavingAddressReview(payload(init).reason));
    if (path.endsWith('/amend-address'))
      return Response.json(staffSavingAddressReceipt(), { status: 201 });
    if (path.endsWith('/amend-hardware-review'))
      return Response.json(savingHardwareReview(payload(init).reason));
    if (path.endsWith('/amend-hardware'))
      return Response.json(savingHardwareReceipt(), { status: 201 });
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
async function render(
  fetcher: ReturnType<typeof mock>,
  locale: 'en' | 'fa' = 'en',
  actor = 'staff-opaque'
) {
  document.documentElement.lang = locale;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetcher);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <AccountUserProvider value={actor}>
        <Page />
      </AccountUserProvider>
    )
  );
  const row = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Buyer Company')
  )!;
  await act(async () => row.click());
}
async function fill(id: string, value: string) {
  const field = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
  expect(field, id).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
      'value'
    )!.set!.call(field, value);
    field.dispatchEvent(
      new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })
    );
  });
}
async function click(label: string) {
  const button = [...document.body.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function submit() {
  await act(async () =>
    host
      .querySelector('[data-testid="saving-staff-operation-form"] form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function prepared(label = 'Reject request', note = ' Exact raw reason ') {
  await fill('saving-staff-note', note);
  await click(label);
  await settled(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
}
const writes = (fetcher: ReturnType<typeof mock>) =>
  fetcher.mock.calls.filter(([path]) =>
    /\/(approve|reject)$|\/stages\/[^/]+\/(complete|skip)$/.test(path)
  );
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
  capture.dialogs.length = 0;
  capture.lazy = null;
  order = savingOperationOrder();
});

it('guards held lazy duplicate submit and discards old invalid feedback after raw editing', async () => {
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
  await fill('saving-staff-note', ' New valid reason ');
  await act(async () => {
    capture.lazy = null;
    gate.resolve();
  });
  await settled(() =>
    expect(
      host.querySelector('[data-testid="saving-staff-operation-form"] [role="status"]')
    ).toBeNull()
  );
  expect(host.querySelector('[aria-invalid="true"]')).toBeNull();
  expect(fetcher.mock.calls.some(([path]) => path.endsWith('/financial-review'))).toBe(false);
});
it.each(['en', 'fa'] as const)(
  'links touched %s feedback and focuses the first invalid rejection field',
  async (locale) => {
    const fetcher = mock();
    await render(fetcher, locale);
    const field = document.getElementById('saving-staff-note') as HTMLInputElement;
    await act(async () => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await settled(() => expect(field.getAttribute('aria-invalid')).toBe('true'));
    await submit();
    await settled(() => {
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(field);
    });
    expect(host.textContent).toContain(tSavingOperations('reasonInvalid', locale));
    expect(
      field
        .getAttribute('aria-describedby')
        ?.split(' ')
        .every((id) => !!document.getElementById(id))
    ).toBe(true);
    expect(fetcher.mock.calls.some(([path]) => path.endsWith('/financial-review'))).toBe(false);
  }
);
it('approves while preserving an unused invalid rejection draft', async () => {
  const fetcher = mock();
  await render(fetcher);
  await fill('saving-staff-note', 'x'.repeat(1001));
  await click('Approve request');
  await settled(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  expect(host.querySelector('[aria-invalid="true"]')).toBeNull();
  await click('Confirm');
  await settled(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect((document.getElementById('saving-staff-note') as HTMLInputElement).value).toBe(
    'x'.repeat(1001)
  );
  expect(payload(writes(fetcher)[0]![1])).not.toHaveProperty('reason');
});
it('focuses required handover then permits optional skip without a descriptor', async () => {
  order = savingOperationOrder('stage');
  const fetcher = mock();
  await render(fetcher);
  await fill('saving-staff-note', ' Stage explanation ');
  await click('Complete stage');
  const field = document.getElementById('saving-handover') as HTMLInputElement;
  await settled(() => {
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);
  });
  await click('Skip optional handover');
  await settled(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  await click('Confirm');
  await settled(() => expect(writes(fetcher)).toHaveLength(1));
  expect(payload(writes(fetcher)[0]![1])).not.toHaveProperty('handoverDescription');
  expect(writes(fetcher)[0]![0]).toContain('/equipment_handover/skip');
});
it('rejects a raw 1001-character handover and preserves its explanation', async () => {
  order = savingOperationOrder('stage');
  const fetcher = mock();
  await render(fetcher);
  await fill('saving-staff-note', ' Keep explanation ');
  await fill('saving-handover', 'x'.repeat(1001));
  await click('Complete stage');
  await settled(() =>
    expect(document.activeElement).toBe(document.getElementById('saving-handover'))
  );
  expect((document.getElementById('saving-staff-note') as HTMLInputElement).value).toBe(
    ' Keep explanation '
  );
  expect(fetcher.mock.calls.some(([path]) => path.endsWith('/review'))).toBe(false);
});
it.each(['decision', 'stage'] as const)(
  'maps owned %s preview metadata without showing server text',
  async (kind) => {
    if (kind === 'stage') order = savingOperationOrder('stage');
    const fetcher = mock((path) =>
      path.endsWith(kind === 'decision' ? '/financial-review' : '/review')
        ? Response.json(publicError([kind === 'decision' ? 'reason' : 'explanation']), {
            status: 400,
          })
        : undefined
    );
    await render(fetcher);
    await fill('saving-staff-note', ' Raw retained ');
    await click(kind === 'decision' ? 'Reject request' : 'Skip optional handover');
    await settled(() =>
      expect(document.getElementById('saving-staff-note')!.getAttribute('aria-invalid')).toBe(
        'true'
      )
    );
    expect((document.getElementById('saving-staff-note') as HTMLInputElement).value).toBe(
      ' Raw retained '
    );
    expect(document.body.textContent).not.toContain('PRIVATE_SERVER_TEXT');
  }
);
it.each([{ fields: ['expectedVersionId'] }, { fields: ['reason', 'expectedReviewHash'] }])(
  'keeps protected or mixed metadata generic: $fields',
  async ({ fields }) => {
    const fetcher = mock((path) =>
      path.endsWith('/financial-review')
        ? Response.json(publicError(fields), { status: 400 })
        : undefined
    );
    await render(fetcher);
    await fill('saving-staff-note', ' Raw retained ');
    await click('Reject request');
    await settled(() =>
      expect(
        host.querySelector('[data-testid="saving-staff-operation-form"] [role="alert"]')
      ).not.toBeNull()
    );
    expect(host.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(document.body.textContent).not.toContain('PRIVATE_SERVER_TEXT');
  }
);
it('discards held preview errors after the raw note is corrected', async () => {
  const held = deferred<Response>();
  const fetcher = mock((path) => (path.endsWith('/financial-review') ? held.promise : undefined));
  await render(fetcher);
  await fill('saving-staff-note', ' Old reason ');
  await click('Reject request');
  await fill('saving-staff-note', ' Corrected reason ');
  await act(async () => held.resolve(Response.json(publicError(['reason']), { status: 400 })));
  await settled(() => expect(host.querySelector('[role="status"]')).toBeNull());
  expect(host.querySelector('[aria-invalid="true"]')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it.each(['0', '300000'])(
  'accepts the actual rejection refund %s branch and clears only its note',
  async (paid) => {
    order = savingOperationOrder('decision', 'equipment_handover', paid);
    const fetcher = mock();
    await render(fetcher);
    await prepared();
    await click('Confirm');
    await settled(() =>
      expect((document.getElementById('saving-staff-note') as HTMLInputElement)?.value).toBe('')
    );
    expect(payload(writes(fetcher)[0]![1]).reason).toBe('Exact raw reason');
  }
);
it('completes handover with the exact descriptor and clears both consumed fields', async () => {
  order = savingOperationOrder('stage');
  const fetcher = mock();
  await render(fetcher);
  await fill('saving-handover', ' Raw handover ');
  await prepared('Complete stage');
  await click('Confirm');
  await settled(() =>
    expect((document.getElementById('saving-handover') as HTMLInputElement)?.value).toBe('')
  );
  expect((document.getElementById('saving-staff-note') as HTMLInputElement).value).toBe('');
  expect(payload(writes(fetcher)[0]![1]).handoverDescription).toBe('Raw handover');
});
it.each(['decision', 'stage'] as const)(
  'retains exact uncertain %s command across malformed receipts, reads and rejected retry',
  async (kind) => {
    if (kind === 'stage') order = savingOperationOrder('stage', 'product_delivery');
    const held = deferred<Response>();
    let count = 0;
    const fetcher = mock((path) => {
      if (!/\/reject$|\/stages\/[^/]+\/complete$/.test(path)) return undefined;
      if (++count === 1) return held.promise;
      if (count === 2)
        return Response.json(publicError([kind === 'decision' ? 'reason' : 'explanation']), {
          status: 400,
        });
      return undefined;
    });
    await render(fetcher);
    if (kind === 'stage') {
      await fill('saving-amend-address', savingReplacementAddress.id);
      await fill('saving-amend-reason', 'Preserve address reason');
      await fill('saving-amend-hardware-reason', 'Preserve hardware reason');
    }
    await prepared(kind === 'decision' ? 'Reject request' : 'Complete stage');
    await click('Confirm');
    await settled(() => expect(writes(fetcher)).toHaveLength(1));
    if (kind === 'stage')
      expect(
        host.querySelector<HTMLButtonElement>(
          '[data-testid="saving-staff-address-form"] button[type="submit"]'
        )!.disabled
      ).toBe(true);
    if (kind === 'stage')
      expect(
        host.querySelector<HTMLButtonElement>(
          '[data-testid="saving-staff-hardware-form"] button[type="submit"]'
        )!.disabled
      ).toBe(true);
    await act(async () => held.resolve(Response.json({ savingOrderId: order.profileId })));
    await settled(() => expect(document.body.textContent).toContain('Retry captured staff action'));
    if (kind === 'stage')
      expect(
        host.querySelector<HTMLButtonElement>(
          '[data-testid="saving-staff-hardware-form"] button[type="submit"]'
        )!.disabled
      ).toBe(true);
    const reads = fetcher.mock.calls.filter(([, init]) => !init?.method).length;
    await click('Refresh');
    await click('Fulfillment');
    expect(fetcher.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(reads);
    await submit();
    if (kind === 'stage')
      await act(async () =>
        host
          .querySelector('[data-testid="saving-staff-address-form"] form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      );
    expect(fetcher.mock.calls.some(([path]) => path.endsWith('/amend-address-review'))).toBe(false);
    if (kind === 'stage')
      await act(async () =>
        host
          .querySelector('[data-testid="saving-staff-hardware-form"] form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      );
    expect(fetcher.mock.calls.some(([path]) => path.endsWith('/amend-hardware-review'))).toBe(
      false
    );
    await click('Retry captured staff action');
    await click('Confirm');
    await click('Cancel');
    expect(document.body.textContent).toContain('Retry captured staff action');
    await click('Retry captured staff action');
    await click('Confirm');
    await settled(() => expect(writes(fetcher)).toHaveLength(3));
    expect(writes(fetcher).map(([, init]) => init?.body)).toEqual(
      Array(3).fill(writes(fetcher)[0]![1]!.body)
    );
    if (kind === 'stage') {
      expect((document.getElementById('saving-amend-reason') as HTMLInputElement).value).toBe(
        'Preserve address reason'
      );
      expect(
        (document.getElementById('saving-amend-hardware-reason') as HTMLInputElement).value
      ).toBe('Preserve hardware reason');
    }
  }
);
it('keeps a valid-looking receipt with the wrong success status uncertain until exact retry', async () => {
  let count = 0;
  const fetcher = mock((path) =>
    path.endsWith('/reject') && ++count === 1
      ? Response.json(savingOperationReceipt(order, { kind: 'decision', action: 'reject' }), {
          status: 201,
        })
      : undefined
  );
  await render(fetcher);
  await prepared();
  await click('Confirm');
  await settled(() => expect(document.body.textContent).toContain('Retry captured staff action'));
  expect((document.getElementById('saving-staff-note') as HTMLInputElement).value).toBe(
    ' Exact raw reason '
  );
  await click('Retry captured staff action');
  await click('Confirm');
  await settled(() =>
    expect((document.getElementById('saving-staff-note') as HTMLInputElement)?.value).toBe('')
  );
  expect(writes(fetcher)[0]![1]!.body).toBe(writes(fetcher)[1]![1]!.body);
});
it('uses actual password step-up and retries the captured decision without a new key', async () => {
  let count = 0;
  const fetcher = mock((path) =>
    path === '/api/auth/step-up'
      ? Response.json({ verified: true })
      : path.endsWith('/reject') && ++count === 1
        ? Response.json(
            { error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code }, requiresStepUp: true },
            { status: 403 }
          )
        : undefined
  );
  await render(fetcher);
  await prepared();
  await click('Confirm');
  await settled(() =>
    expect(
      document.querySelector<HTMLInputElement>('[role="dialog"] input[type="password"]')
    ).not.toBeNull()
  );
  const password = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input[type="password"]'
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      password,
      'proof-password'
    );
    password.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('Confirm');
  await settled(() => expect(writes(fetcher)).toHaveLength(2));
  expect(writes(fetcher)[0]![1]!.body).toBe(writes(fetcher)[1]![1]!.body);
  expect(fetcher.mock.calls.find(([path]) => path === '/api/auth/step-up')?.[1]?.body).toBe(
    JSON.stringify({ password: 'proof-password' })
  );
});
it('reopens focused draft after a known first write rejection but retains an unknown complete rejection', async () => {
  let code: string = ErrorCodes.VALIDATION_INPUT_INVALID.code;
  const fetcher = mock((path) =>
    path.endsWith('/reject')
      ? Response.json(publicError(['reason'], code), { status: 400 })
      : undefined
  );
  await render(fetcher);
  await prepared();
  await click('Confirm');
  await settled(() => {
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(document.getElementById('saving-staff-note'));
  });
  expect((document.getElementById('saving-staff-note') as HTMLInputElement).value).toBe(
    ' Exact raw reason '
  );
  code = 'UNKNOWN:UNCLASSIFIED';
  await click('Reject request');
  await settled(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
  await click('Confirm');
  await click('Cancel');
  expect(document.body.textContent).toContain('Retry captured staff action');
  expect((document.getElementById('saving-staff-note') as HTMLInputElement).disabled).toBe(true);
});
it.each([401, 403, 404])(
  'withdraws the whole private order for a current preview %s',
  async (status) => {
    const fetcher = mock((path) =>
      path.endsWith('/financial-review') ? Response.json({}, { status }) : undefined
    );
    await render(fetcher);
    await fill('saving-staff-note', 'Private reason');
    await click('Reject request');
    await settled(() => expect(document.getElementById('saving-staff-note')).toBeNull());
    expect(host.textContent).not.toContain('Accepted agreement');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  }
);
it('fences old actor/profile callbacks before displaying a new private draft', async () => {
  const fetcher = mock();
  await render(fetcher);
  await prepared();
  const old = capture.dialogs.at(-1)!;
  const actorRead = deferred<Response>();
  vi.stubGlobal(
    'fetch',
    mock((path) =>
      path === `/api/staff/saving/orders/${order.id}` ? actorRead.promise : undefined
    )
  );
  await act(async () =>
    root!.render(
      <AccountUserProvider value="another-opaque-staff">
        <Page />
      </AccountUserProvider>
    )
  );
  await settled(() => expect(document.getElementById('saving-staff-note')).toBeNull());
  await act(async () => actorRead.resolve(Response.json(order)));
  await settled(() => expect(document.getElementById('saving-staff-note')).not.toBeNull());
  await fill('saving-staff-note', 'New actor draft');
  await act(async () => {
    old.onDenied?.();
    await old.onSuccess?.(savingOperationReceipt(order, { kind: 'decision', action: 'reject' }));
    old.onClose();
  });
  expect((document.getElementById('saving-staff-note') as HTMLInputElement).value).toBe(
    'New actor draft'
  );
  const held = deferred<Response>();
  vi.stubGlobal(
    'fetch',
    mock((path) => (path === `/api/staff/saving/orders/${order.id}` ? held.promise : undefined))
  );
  await act(async () => refreshProfileContext());
  await act(async () => {
    old.onDenied?.();
    await old.onSuccess?.(savingOperationReceipt(order, { kind: 'decision', action: 'reject' }));
    old.onClose();
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => held.resolve(Response.json(order)));
  await settled(() =>
    expect((document.getElementById('saving-staff-note') as HTMLInputElement)?.value).toBe('')
  );
});
it('fences a held old queue denial as soon as a staff operation owns the workspace', async () => {
  const held = deferred<Response>();
  const fetcher = mock((path) => (path.includes('after=') ? held.promise : undefined));
  await render(fetcher);
  await click('More orders');
  await prepared();
  await act(async () => held.resolve(Response.json({}, { status: 403 })));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await click('Confirm');
  await settled(() => expect(writes(fetcher)).toHaveLength(1));
});
