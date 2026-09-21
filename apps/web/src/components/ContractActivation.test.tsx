import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { en, fa } from '@barghsa/i18n/contracts';
import { ContractActivationPanel } from './ContractActivationPanel.js';
import { ContractActivationRules } from './ContractActivationRules.js';
import type { TeamAction } from './TeamActionDialog.js';
const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  action: null as TeamAction | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (value: string) => value }),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onClose,
    onSuccess,
  }: {
    action: TeamAction;
    onClose: () => void;
    onSuccess: () => Promise<void>;
  }) => {
    harness.action = action;
    return (
      <div role="dialog">
        <button onClick={onClose}>Cancel</button>
        <button onClick={() => void onSuccess()}>Confirm</button>
      </div>
    );
  },
}));
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  harness.locale = 'en';
  harness.action = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(node: ReactNode) {
  await act(async () => root.render(node));
}
async function click(text: string) {
  await act(async () => {
    const button = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === text
    );
    expect(button).toBeDefined();
    button!.click();
  });
}
function data(extra = {}) {
  return {
    contractId: 'contract',
    versionId: 'version',
    state: 'Accepted',
    isCurrent: true,
    ready: false,
    ruleRevision: 2,
    initialInvoiceId: null,
    serviceStartsAt: null,
    evaluatedAt: '2026-09-21T12:00:00Z',
    checks: [
      { key: 'staffApproval', required: true, status: 'met' },
      { key: 'customerAcceptance', required: true, status: 'met' },
      { key: 'signature', required: false, status: 'not_required' },
      { key: 'initialPayment', required: true, status: 'unmet' },
      { key: 'serviceStart', required: true, status: 'unmet' },
    ],
    ...extra,
  };
}
function rules(canEdit = true) {
  return {
    canEdit,
    rules: [
      {
        serviceType: 'electricity',
        signatureRequired: false,
        paymentRequired: true,
        serviceStartRequired: false,
        revision: 4,
        updatedAt: '2026-09-21T12:00:00Z',
      },
      {
        serviceType: 'savings',
        signatureRequired: false,
        paymentRequired: false,
        serviceStartRequired: false,
        revision: 1,
        updatedAt: '2026-09-21T12:00:00Z',
      },
      {
        serviceType: 'solar',
        signatureRequired: true,
        paymentRequired: false,
        serviceStartRequired: false,
        revision: 3,
        updatedAt: '2026-09-21T12:00:00Z',
      },
    ],
  };
}
for (const locale of ['en', 'fa'] as const)
  it(locale + ': shows missing prerequisites and exact-version evidence', async () => {
    harness.locale = locale;
    const words = locale === 'fa' ? fa : en;
    let result = data();
    const fetcher = vi.fn(async () => response(result));
    vi.stubGlobal('fetch', fetcher);
    await render(<ContractActivationPanel id="contract" versionId="version" staff={false} />);
    expect(fetcher.mock.calls[0]).toEqual([
      expect.stringContaining('/api/contracts/contract/activation?versionId=version'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ]);
    expect(container.querySelectorAll('li')).toHaveLength(5);
    expect(container.textContent).toContain(words.initialInvoiceMissing);
    expect(container.textContent).toContain(words['prerequisite.unmet']);
    expect(container.textContent).toContain(words['prerequisite.not_required']);
    expect(container.textContent).not.toContain(words.prerequisitesReady);
    result = data({
      isCurrent: false,
      initialInvoiceId: 'invoice',
      serviceStartsAt: '2026-09-22T00:00:00Z',
    });
    await click(words.refresh);
    expect(container.textContent).toContain(words.historicalRequirements);
    expect(container.textContent).toContain(words.initialInvoiceLinked);
    expect(container.textContent).toContain('2026-09-22T00:00:00Z');
    result = data({ ready: true, checks: [] });
    await click(words.refresh);
    expect(container.querySelector('[role=status]')?.textContent).toContain(
      words.prerequisitesReady
    );
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });
it('retries failures and ignores aborted version responses', async () => {
  let finish!: (value: Response) => void;
  let oldSignal: AbortSignal | undefined;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(async () => response({}, 503))
    .mockImplementationOnce((_: string, options: RequestInit) => {
      oldSignal = options.signal!;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    })
    .mockResolvedValue(response(data({ ready: true })));
  vi.stubGlobal('fetch', fetcher);
  await render(<ContractActivationPanel id="contract" versionId="old" staff />);
  expect(container.querySelector('[role=alert]')).not.toBeNull();
  await click(en.refresh);
  expect(container.textContent).toContain(en.loading);
  await render(<ContractActivationPanel id="contract" versionId="new" staff />);
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => finish(response(data())));
  expect(container.textContent).toContain(en.prerequisitesReady);
  expect(fetcher.mock.calls.at(-1)?.[0]).toContain(
    '/api/admin/contracts/contract/activation?versionId=new'
  );
});
for (const locale of ['en', 'fa'] as const)
  it(
    locale + ': edits optional rules with exact revision and mandatory requirements locked',
    async () => {
      harness.locale = locale;
      const words = locale === 'fa' ? fa : en;
      const fetcher = vi.fn(async (_url: string, _options: RequestInit) => response(rules()));
      vi.stubGlobal('fetch', fetcher);
      await render(<ContractActivationRules />);
      expect(fetcher).not.toHaveBeenCalled();
      await click(words.activationRules);
      const electricity = container.querySelectorAll('fieldset')[0]!,
        solar = container.querySelectorAll('fieldset')[2]!;
      const fields = electricity.querySelectorAll('input');
      expect(fields[1]!.disabled).toBe(true);
      expect(solar.querySelector('input')!.disabled).toBe(true);
      expect(electricity.querySelector('button')!.disabled).toBe(true);
      await act(async () => fields[0]!.click());
      expect(electricity.querySelector('button')!.disabled).toBe(false);
      await act(async () => electricity.querySelector('button')!.click());
      expect(harness.action).toMatchObject({
        method: 'PUT',
        path: '/api/admin/contract-activation-rules/electricity',
        body: {
          expectedRevision: 4,
          signatureRequired: true,
          paymentRequired: true,
          serviceStartRequired: false,
          idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
        },
      });
      await click('Cancel');
      expect(container.querySelector('[role=dialog]')).toBeNull();
      await act(async () => electricity.querySelector('button')!.click());
      await click('Confirm');
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(container.querySelector('input')!.checked).toBe(false);
      await click(words.activationRules);
      expect(container.querySelector('fieldset')).toBeNull();
      expect(fetcher.mock.calls[0]![1].signal?.aborted).toBe(true);
    }
  );
it('keeps view-only rules disabled and recovers failed loads', async () => {
  let failed = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => (failed ? response({}, 403) : response(rules(false))))
  );
  await render(<ContractActivationRules />);
  await click(en.activationRules);
  expect(container.querySelector('[role=alert]')).not.toBeNull();
  failed = false;
  await click(en.refresh);
  expect(container.textContent).toContain(en.activationRulesReadOnly);
  expect([...container.querySelectorAll('input')].every((input) => input.disabled)).toBe(true);
  expect(
    [...container.querySelectorAll('button')].some(
      (button) => button.textContent === en.saveActivationRules
    )
  ).toBe(false);
});
it('abandons rules loads when closed', async () => {
  let finish!: (value: Response) => void;
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_: string, options: RequestInit) => {
      signal = options.signal!;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    })
  );
  await render(<ContractActivationRules />);
  await click(en.activationRules);
  await click(en.activationRules);
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(response(rules())));
  expect(container.querySelector('fieldset')).toBeNull();
});
