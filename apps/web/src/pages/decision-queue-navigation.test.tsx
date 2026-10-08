import { QueryProvider } from '../test/query-provider.js';
import { t } from '@barghsa/i18n/admin-ui';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminApprovalRequestsView } from './AdminApprovalRequestsPage.js';
import Reconciliation from './AdminReconciliationPage.js';
import { useListQuery } from '../hooks/useListQuery.js';
import {
  approvalQueueQueryOptions,
  reconciliationQueueQueryOptions,
} from '../lib/decision-queue-query.js';
import { reconciliationItem } from '../test/payment-review-fixtures.js';

let confirmation: {
  action: { title: string };
  onSuccess: (result?: unknown) => Promise<void>;
  onValidationError: (fields: unknown[]) => boolean;
  onClose: () => void;
} | null = null;
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: typeof confirmation) => {
    confirmation = props;
    return <div data-testid="decision-confirmation">{props?.action.title}</div>;
  },
}));
vi.mock('../components/DualApprovalThresholdPanel.js', () => ({ default: () => null }));
let host: HTMLDivElement, root: Root;
let navigate: (raw: Record<string, unknown>) => void;
const id = '82000000-0000-4000-8000-000000000001';
const from = '2026-09-01T07:00:15.123Z';
const approval = {
  id,
  actionType: 'refund',
  amountIrR: '9007199254740993',
  initiatorId: 'finance',
  initiatorUsername: 'Finance',
  reason: 'Original request',
  status: 'pending',
  reviewerId: null,
  reviewerUsername: null,
  reviewReason: null,
  details: null,
};
function Bound({
  kind,
  initial = {},
}: {
  kind: 'approval' | 'reconciliation';
  initial?: Record<string, unknown>;
}) {
  const [raw, setRaw] = useState(initial);
  navigate = setRaw;
  const queries = useListQuery(
    kind === 'approval' ? approvalQueueQueryOptions : reconciliationQueueQueryOptions,
    raw,
    (update) => setRaw(update)
  );
  return kind === 'approval' ? (
    <AdminApprovalRequestsView queries={queries} />
  ) : (
    <Reconciliation key={JSON.stringify(queries.query.filters)} queries={queries} />
  );
}
beforeEach(() => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  confirmation = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function click(name: string) {
  const b = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
  expect(b, name).toBeDefined();
  await act(async () => {
    b!.click();
    await vi.dynamicImportSettled();
  });
}
it('restores UTC filters after timezone recovery and preserves untouched seconds on Apply', async () => {
  let finish!: (value: Response) => void;
  const reads: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname.endsWith('/timezone'))
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      if (url.pathname.endsWith('/access'))
        return Response.json({ canView: true, canResolve: true });
      reads.push(url);
      return Response.json([reconciliationItem]);
    })
  );
  await act(async () =>
    root.render(
      <QueryProvider>
        {<Bound kind="reconciliation" initial={{ createdFrom: from }} />}
      </QueryProvider>
    )
  );
  const apply = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Apply filters'
  )!;
  expect(apply.disabled).toBe(true);
  expect(reads.at(-1)?.searchParams.get('createdFrom')).toBe(from);
  await act(async () => finish(Response.json({ timezone: 'America/Los_Angeles' })));
  expect(host.querySelector<HTMLInputElement>('#rex-from')?.value).toBe('2026-09-01T00:00');
  await click('Apply filters');
  expect(reads.at(-1)?.searchParams.get('createdFrom')).toBe(from);
  expect(reads).toHaveLength(2);
});
for (const kind of ['approval', 'reconciliation'] as const)
  it(`${kind} history navigation rejects a late decision without new reads or false success`, async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://localhost');
        calls.push(url.pathname + url.search);
        if (url.pathname.endsWith('/timezone')) return Response.json({ timezone: 'Asia/Tehran' });
        if (url.pathname.endsWith('/access'))
          return Response.json({ canView: true, canResolve: true });
        return Response.json(kind === 'approval' ? [approval] : [reconciliationItem]);
      })
    );
    await act(async () => root.render(<QueryProvider>{<Bound kind={kind} />}</QueryProvider>));
    if (kind === 'reconciliation') {
      await click(reconciliationItem.description);
      await click('Investigate');
    } else await click('Approve');
    expect(confirmation).not.toBeNull();
    const old = confirmation!;
    await act(async () => navigate({ page: 2 }));
    expect(host.querySelector('[data-testid="decision-confirmation"]')).toBeNull();
    if (kind === 'reconciliation') {
      await click(reconciliationItem.description);
      await click('Investigate');
    } else await click('Approve');
    const before = calls.length;
    await act(async () => {
      if (kind === 'reconciliation') expect(old.onValidationError(['note'])).toBe(false);
      await old.onSuccess();
      old.onClose();
    });
    expect(calls).toHaveLength(before);
    expect(host.textContent).not.toContain(
      t(kind === 'approval' ? 'admin.approvals.saved' : 'admin.reconciliation.saved', 'en')
    );
    expect(host.querySelector('[data-testid="decision-confirmation"]')).not.toBeNull();
  });
