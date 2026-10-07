import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ElectricityRawDraftQueue } from './ElectricityRawDraftQueue.js';
const state = vi.hoisted(() => ({ actor: 'reviewer', locale: 'en' }));
vi.mock('../hooks/useAccountUser.js', () => ({ useAccountUser: () => state.actor }));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => state.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (v: string) => v }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: String, money: String }),
}));
const orderId = '84000000-0000-4000-8000-000000000001',
  profileId = '85000000-0000-4000-8000-000000000001';
let container: HTMLDivElement, root: Root;
const queue = {
  drafts: [
    {
      orderId,
      profileId,
      mode: 'simple',
      createdAt: '2026-10-06T12:00:00Z',
      updatedAt: '2026-10-06T12:00:00Z',
      private: 'PRIVATE wizard progress',
    },
  ],
  nextAfter: null,
};
function preview(action = 'reject') {
  return {
    hash: 'a'.repeat(64),
    scope: { action: 'electricity.draft-terminal.' + action, profileId, resourceId: orderId },
    data: {
      action,
      reason: 'Reviewed reason',
      fromState: 'draft',
      toState: action === 'reject' ? 'rejected' : 'cancelled',
      mode: 'simple',
      stateFingerprint: 'b'.repeat(64),
      refundAmount: '0',
      createsContract: false,
      createsInvoice: false,
      collectsPayment: false,
      changesSavedWizardProgress: false,
    },
  };
}
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
it('requests the captured second approval, waits, then confirms every funded invoice and the matching receipt', async () => {
  const invoiceId = '86000000-0000-4000-8000-000000000001',
    refundId = '87000000-0000-4000-8000-000000000001',
    approvalId = '88000000-0000-4000-8000-000000000001';
  let status: string | null = null;
  const p = () => ({
    ...preview(),
    approval: status ? { id: approvalId, status } : null,
    data: {
      ...preview().data,
      refundAmount: '100',
      approvalRequired: true,
      invoices: [{ id: invoiceId, refundableAmount: '100' }],
    },
  });
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/drafts')) return json(queue);
    if (path.endsWith('/review')) return json(p());
    if (path.endsWith('/approval')) {
      status = 'pending';
      return new Response(
        JSON.stringify({
          approvalRequestId: approvalId,
          status: 'pending',
          reviewHash: 'a'.repeat(64),
        }),
        { status: 201 }
      );
    }
    return json({
      orderId,
      status: 'rejected',
      refundId,
      financiallyClosed: false,
      refunds: [{ id: refundId, invoiceId, amount: '100' }],
    });
  });
  vi.stubGlobal('fetch', fetcher);
  await open();
  await review();
  expect(document.body.querySelector('[role=dialog]')!.textContent).toContain(
    'Request second approval'
  );
  expect(document.body.querySelector('[role=dialog]')!.textContent).toContain(invoiceId);
  await act(async () => confirm().click());
  expect(container.textContent).toContain('financial approval queue');
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(document.body.querySelector('[role=dialog]')).toBeNull();
  status = 'approved';
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(document.body.querySelector('[role=dialog]')!.textContent).toContain('Full wallet return');
  await act(async () => confirm().click());
  const mutation = fetcher.mock.calls.find(([u]) => String(u).endsWith('/draft-terminal'));
  expect(mutation).toBeDefined();
});
it('keeps the captured funded decision when a receipt omits the mandatory wallet obligation', async () => {
  const invoiceId = '86000000-0000-4000-8000-000000000001';
  const p = {
    ...preview(),
    data: {
      ...preview().data,
      refundAmount: '100',
      approvalRequired: false,
      invoices: [{ id: invoiceId, refundableAmount: '100' }],
    },
  };
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith('/drafts')
      ? json(queue)
      : String(input).endsWith('/review')
        ? json(p)
        : json({
            orderId,
            status: 'rejected',
            refundId: null,
            financiallyClosed: true,
            refunds: [],
          })
  );
  vi.stubGlobal('fetch', fetcher);
  await open();
  await review();
  await act(async () => confirm().click());
  expect(document.body.querySelector('[role=dialog]')).not.toBeNull();
  expect(fetcher.mock.calls.filter(([u]) => String(u).endsWith('/draft-terminal'))).toHaveLength(1);
});
for (const [status, restoreOnCancel, outcome, copy] of [
  ['consumed', true, 'release', 'The gift-code usage slot will be restored.'],
  ['consumed', false, 'retain', 'The gift-code policy retains the usage slot.'],
  ['released', true, 'already_released', 'The gift-code usage slot was already restored.'],
] as const)
  it('discloses the exact captured gift outcome ' + outcome, async () => {
    const p = {
      ...preview(),
      data: {
        ...preview().data,
        gift: { giftCodeId: orderId, redemptionId: profileId, status, restoreOnCancel, outcome },
      },
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/drafts') ? json(queue) : json(p)
    );
    vi.stubGlobal('fetch', fetcher);
    await open();
    await review();
    const dialog = document.body.querySelector('[role=dialog]')!;
    expect(dialog.textContent).toContain(copy);
    expect(dialog.textContent).toContain(orderId);
    expect(fetcher.mock.calls.filter(([u]) => String(u).endsWith('/draft-terminal'))).toHaveLength(
      0
    );
  });
it('refuses a gift outcome that contradicts its captured policy', async () => {
  const p = {
    ...preview(),
    data: {
      ...preview().data,
      gift: {
        giftCodeId: orderId,
        redemptionId: profileId,
        status: 'consumed',
        restoreOnCancel: false,
        outcome: 'release',
      },
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/drafts') ? json(queue) : json(p)
    )
  );
  await open();
  await review();
  expect(document.body.querySelector('[role=dialog]')).toBeNull();
  expect(container.querySelector('[role=alert]')?.textContent).toContain(
    'Could not load or review'
  );
});
beforeEach(() => {
  state.actor = 'reviewer';
  state.locale = 'en';
  document.cookie = 'barghsa_csrf=raw-token';
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
async function open() {
  await act(async () => root.render(<ElectricityRawDraftQueue />));
  await act(async () => {
    const details = container.querySelector('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
}
async function review() {
  await act(async () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Reject draft')!.click()
  );
  await act(async () => {
    const textarea = container.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      textarea,
      ' Reviewed reason '
    );
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
const confirm = () =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes('Confirm'))!;
it('projects safe queue metadata and confirms captured reason, identity and exact retry command', async () => {
  let attempts = 0;
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/drafts')) return json(queue);
    if (path.endsWith('/review')) return json(preview());
    if (++attempts === 1) throw new Error('Unknown delivery');
    return json({ orderId, status: 'rejected', refundId: null });
  });
  vi.stubGlobal('fetch', fetcher);
  await open();
  expect(container.textContent).not.toContain('PRIVATE');
  await review();
  const dialog = document.body.querySelector('[role=dialog]')!;
  expect(dialog.textContent).toContain(orderId);
  expect(dialog.textContent).toContain(profileId);
  expect(dialog.textContent).toContain('Reviewed reason');
  await act(async () => confirm().click());
  expect(confirm()).toBeDefined();
  await act(async () => confirm().click());
  const mutations = fetcher.mock.calls.filter(([u]) => String(u).endsWith('/draft-terminal'));
  expect(mutations).toHaveLength(2);
  expect(mutations[0]![1]!.body).toBe(mutations[1]![1]!.body);
  expect(JSON.parse(String(mutations[0]![1]!.body))).toMatchObject({
    action: 'reject',
    reason: 'Reviewed reason',
    expectedReviewHash: 'a'.repeat(64),
    idempotencyKey: expect.any(String),
  });
  expect(new Headers(mutations[0]![1]!.headers).get('x-csrf-token')).toBe('raw-token');
});
it.each(['profile', 'target', 'mode', 'fingerprint', 'payment', 'wizard'] as const)(
  'refuses an unbound %s preview without a mutation',
  async (kind) => {
    const p = preview();
    if (kind === 'profile') p.scope.profileId = orderId;
    if (kind === 'target') p.data.toState = 'approved';
    if (kind === 'mode') p.data.mode = 'advanced';
    if (kind === 'fingerprint') p.data.stateFingerprint = 'bad';
    if (kind === 'payment') p.data.collectsPayment = true;
    if (kind === 'wizard') p.data.changesSavedWizardProgress = true;
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/drafts') ? json(queue) : json(p)
    );
    vi.stubGlobal('fetch', fetcher);
    await open();
    await review();
    expect(container.querySelector('[role=alert]')).not.toBeNull();
    expect(document.body.querySelector('[role=dialog]')).toBeNull();
    expect(fetcher.mock.calls.some(([u]) => String(u).endsWith('/draft-terminal'))).toBe(false);
  }
);
it('withdraws a pending preview when the current actor changes', async () => {
  let resolve!: (r: Response) => void;
  const delayed = new Promise<Response>((r) => {
    resolve = r;
  });
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith('/drafts') ? json(queue) : delayed
  );
  vi.stubGlobal('fetch', fetcher);
  await open();
  await review();
  state.actor = 'different-reviewer';
  await act(async () => root.render(<ElectricityRawDraftQueue />));
  await act(async () => resolve(json(preview())));
  expect(document.body.querySelector('[role=dialog]')).toBeNull();
  expect(container.querySelector('textarea')).toBeNull();
  expect(fetcher.mock.calls.some(([u]) => String(u).endsWith('/draft-terminal'))).toBe(false);
});
it('uses Persian RTL copy, labelled reason controls and a native keyboard disclosure', async () => {
  state.locale = 'fa';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(queue))
  );
  await open();
  expect(container.querySelector('details')!.dir).toBe('rtl');
  expect(container.querySelector('summary')!.textContent).toMatch(/[\u0600-\u06ff]/);
  const buttons = [...container.querySelectorAll('button')];
  await act(async () => buttons[1]!.click());
  const textarea = container.querySelector('textarea')!;
  expect(container.querySelector('label')!.htmlFor).toBe(textarea.id);
  expect(textarea.required).toBe(true);
  expect(container.querySelector('[role=region]')).not.toBeNull();
});
