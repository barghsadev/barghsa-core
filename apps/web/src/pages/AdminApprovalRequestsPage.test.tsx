import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { t } from '@barghsa/i18n/admin-ui';
import { contractText } from '@barghsa/i18n/contracts';
import { t as appText } from '@barghsa/i18n/app';
import { AdminApprovalRequestsView } from './AdminApprovalRequestsPage.js';
import type { TeamAction } from '../components/TeamActionDialog.js';

interface Confirmation {
  action: TeamAction;
  summary?: ReactNode;
  onClose: () => void;
  onSuccess: (result: unknown) => Promise<void>;
  onValidationError: (fields: unknown[]) => boolean;
  onDenied: () => void;
}
const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  confirmation: null as Confirmation | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => state.locale }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, number: String }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => (
    <a href="/admin/approval-requests">{children}</a>
  ),
}));
vi.mock('../components/DualApprovalThresholdPanel.js', () => ({ default: () => null }));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: Confirmation) => {
    state.confirmation = props;
    return (
      <div role="dialog">
        {props.action.path}
        {props.summary}
      </div>
    );
  },
}));
const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function row(id = first) {
  return {
    id,
    actionType: 'refund',
    amountIrR: '250000',
    initiatorId: 'initiator',
    initiatorUsername: 'Finance',
    reason: 'Bank evidence',
    status: 'pending',
    reviewerId: null,
    reviewerUsername: null,
    reviewReason: null,
    details: null,
  };
}
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.locale = 'en';
  state.confirmation = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json([row(), row(second)]))
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function field(id = first) {
  return container.querySelector<HTMLTextAreaElement>(`#reason-${id}`)!;
}
function button(label: string, id = first) {
  return [...field(id).closest('form')!.querySelectorAll('button')].find(
    (node) => node.textContent === label
  )!;
}
async function render(requestId?: string) {
  await act(async () =>
    root.render(<AdminApprovalRequestsView {...(requestId ? { requestId } : {})} />)
  );
  await vi.waitFor(() => expect(field()).toBeTruthy());
}
async function edit(value: string, id = first) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      field(id),
      value
    );
    field(id).dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function reject(id = first) {
  await act(async () =>
    field(id)
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function click(label: string) {
  const node = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === label
  )!;
  await act(async () => node.click());
}
function feedback(id = first) {
  const errorId = field(id).getAttribute('aria-describedby');
  return errorId ? document.getElementById(errorId) : null;
}
for (const locale of ['en', 'fa'] as const) {
  it.each(['', '  ', 'x'.repeat(2001)])(
    `validates only the submitted rejection and focuses its retained reason (${locale}): %j`,
    async (raw) => {
      state.locale = locale;
      await render();
      await edit('Keep companion draft', second);
      await edit(raw);
      expect(field().getAttribute('aria-invalid')).toBeNull();
      expect(button(t('admin.approvals.reject', locale)).disabled).toBe(false);
      await reject();
      await vi.waitFor(() => expect(document.activeElement).toBe(field()));
      expect(feedback()?.textContent).toBe(t('admin.approvals.invalidReason', locale));
      expect(field().value).toBe(raw);
      expect(field(second).value).toBe('Keep companion draft');
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    }
  );
  it(`corrects touched reasons and captures the exact trimmed command (${locale})`, async () => {
    state.locale = locale;
    await render();
    await act(async () => {
      field().focus();
      field().blur();
    });
    await vi.waitFor(() =>
      expect(feedback()?.textContent).toBe(t('admin.approvals.invalidReason', locale))
    );
    await edit('  Evidence mismatch  ');
    await vi.waitFor(() => expect(feedback()).toBeNull());
    await reject();
    await vi.waitFor(() =>
      expect(state.confirmation?.action.body).toEqual({ reason: 'Evidence mismatch' })
    );
    expect(field().value).toBe('  Evidence mismatch  ');
    expect(field().disabled).toBe(true);
    expect(field(second).disabled).toBe(true);
    expect(button(t('admin.approvals.reject', locale)).getAttribute('aria-busy')).toBe('true');
  });
}
it('approval remains available without a rejection reason and captures no reason body', async () => {
  await render();
  await act(async () => button('Approve').click());
  expect(state.confirmation?.action.path).toBe(`/api/admin/approval-requests/${first}/approve`);
  expect(state.confirmation?.action.body).toBeUndefined();
  expect(button('Approve').getAttribute('aria-busy')).toBe('true');
});
it.each([
  { fields: ['reason'], owned: true },
  { fields: ['reason', 'actorUserId'], owned: false },
  { fields: ['expectedReviewHash'], owned: false },
])('maps only owned rejection metadata %#', async ({ fields, owned }) => {
  await render();
  await edit('  Keep first draft  ');
  await edit('Keep second draft', second);
  await reject();
  const confirmation = state.confirmation!;
  await act(async () => {
    const mapped = confirmation.onValidationError(fields);
    expect(mapped).toBe(owned);
    if (mapped) confirmation.onClose();
  });
  if (owned) {
    await vi.waitFor(() => expect(document.activeElement).toBe(field()));
    expect(feedback()?.textContent).toBe(t('admin.approvals.invalidReason', 'en'));
    expect(field().disabled).toBe(false);
  } else {
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(feedback()).toBeNull();
  }
  expect(field().value).toBe('  Keep first draft  ');
  expect(field(second).value).toBe('Keep second draft');
});
it('locks duplicate rejection and competing approval before validation settles', async () => {
  await render();
  await edit('Reject first');
  await act(async () => {
    const form = field().closest('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    button('Approve', second).click();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(state.confirmation?.action.path).toBe(`/api/admin/approval-requests/${first}/reject`);
  expect(state.confirmation?.action.body).toEqual({ reason: 'Reject first' });
});
it('restores independent cached drafts after leaving and returning to a successful queue page', async () => {
  vi.mocked(fetch).mockImplementation(async (url) =>
    Response.json(
      String(url).includes('offset=25')
        ? [row('cccccccc-cccc-4ccc-8ccc-cccccccccccc')]
        : Array.from({ length: 26 }, (_, index) =>
            row(index === 0 ? first : index === 1 ? second : `other-${index}`)
          )
    )
  );
  await render();
  await edit('First page draft');
  await edit('Companion page draft', second);
  await click('Next');
  await vi.waitFor(() => expect(field()).toBeNull());
  await click('Previous');
  await vi.waitFor(() => expect(field()?.value).toBe('First page draft'));
  expect(field(second).value).toBe('Companion page draft');
});
it.each([{ id: second, status: 'rejected' }, { id: first, status: 'approved' }, {}])(
  'rejects a mismatched acknowledgement without clearing drafts: %j',
  async (result) => {
    await render();
    await edit('Keep first');
    await reject();
    await expect(state.confirmation!.onSuccess(result)).rejects.toThrow(
      'Invalid approval acknowledgement'
    );
    expect(field().value).toBe('Keep first');
    expect(container.textContent).not.toContain('Decision saved.');
  }
);
it('clears only the acknowledged draft after matching rejection success', async () => {
  await render();
  await edit('First reason');
  await edit('Second reason', second);
  await reject();
  await act(async () => state.confirmation!.onSuccess({ id: first, status: 'rejected' }));
  expect(field().value).toBe('');
  expect(field(second).value).toBe('Second reason');
  expect(container.textContent).toContain(t('admin.approvals.saved', 'en'));
});
it('denial clears all private work and obsolete field/success callbacks cannot affect recovered drafts', async () => {
  await render();
  await edit('Private reason');
  await edit('Private companion', second);
  await reject();
  const previous = state.confirmation!;
  await act(async () => previous.onDenied());
  expect(field()).toBeNull();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await click('Refresh');
  await vi.waitFor(() => expect(field()?.value).toBe(''));
  await edit('New private work');
  const reads = vi.mocked(fetch).mock.calls.length;
  await act(async () => {
    expect(previous.onValidationError(['reason'])).toBe(false);
    await previous.onSuccess({ id: first, status: 'rejected' });
  });
  expect(field().value).toBe('New private work');
  expect(feedback()).toBeNull();
  expect(vi.mocked(fetch).mock.calls).toHaveLength(reads);
});

for (const locale of ['en', 'fa'] as const)
  it(
    locale + ': identifies rejection and every promised wallet return for the second reviewer',
    async () => {
      state.locale = locale;
      const request = {
        ...row(),
        actionType: 'contract_cancellation',
        amountIrR: '750000',
        details: {
          terminalAction: 'reject',
          contractId: first,
          profileId: second,
          versionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          refundDecision: {
            mode: 'full_wallet',
            refunds: [
              { invoiceId: 'first-invoice', amount: '500000', destination: 'wallet' },
              { invoiceId: 'second-invoice', amount: '250000', destination: 'wallet' },
            ],
          },
        },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json([request]))
      );
      await render();
      expect(container.textContent).toContain(contractText('rejectionTitle', locale));
      await click(t('admin.approvals.approve', locale));
      expect(container.querySelector('[role=dialog]')!.textContent).toContain(
        contractText('rejectionFinancialReview', locale)
      );
      expect(container.querySelector('[role=dialog]')!.textContent).toContain('first-invoice');
      expect(container.querySelector('[role=dialog]')!.textContent).toContain('second-invoice');
      expect(container.querySelector('[role=dialog]')!.textContent).toContain('500000');
      expect(container.querySelector('[role=dialog]')!.textContent).toContain('250000');
    }
  );
for (const locale of ['en', 'fa'] as const)
  for (const action of ['reject', 'cancel'] as const)
    it(`${locale}: shows the contractless ${action} target and every wallet obligation to finance`, async () => {
      state.locale = locale;
      const request = {
        ...row(),
        actionType: 'contract_cancellation',
        amountIrR: '350000',
        details: {
          entityType: 'electricity_order_termination',
          terminalAction: action,
          orderId: first,
          profileId: second,
          refundDecision: {
            mode: 'full_wallet',
            refunds: [
              { invoiceId: 'invoice-one', amount: '100000', destination: 'wallet' },
              { invoiceId: 'invoice-two', amount: '250000', destination: 'wallet' },
            ],
          },
        },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json([request]))
      );
      await render();
      expect(container.textContent).toContain(appText('electricity.rawDraft.' + action, locale));
      await click(t('admin.approvals.approve', locale));
      const dialog = container.querySelector('[role=dialog]')!;
      expect(dialog.textContent).toContain(appText('electricity.rawDraft.walletReturn', locale));
      expect(dialog.textContent).toContain(first);
      expect(dialog.textContent).toContain(second);
      expect(dialog.textContent).toContain('invoice-one');
      expect(dialog.textContent).toContain('invoice-two');
      expect(dialog.textContent).toContain('100000');
      expect(dialog.textContent).toContain('250000');
      expect(dialog.textContent).not.toContain(contractText('version', locale));
    });
