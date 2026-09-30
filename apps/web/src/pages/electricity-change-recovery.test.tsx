import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AdminElectricityIncreasesPage from './AdminElectricityIncreasesPage.js';
import AdminElectricityPriceAdjustmentsPage from './AdminElectricityPriceAdjustmentsPage.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import {
  changeContractId,
  changeCursor,
  increaseRow,
  increaseReview,
  priceReview,
  priceRow,
  priceState,
} from '../test/electricity-change-fixtures.js';

vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ irrDigits: String, number: String }),
}));
const captured = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as (() => Promise<void>) | null,
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    summary,
    onSuccess,
  }: {
    action: TeamAction;
    summary: ReactNode;
    onSuccess: () => Promise<void>;
  }) => {
    captured.action = action;
    captured.success = onSuccess;
    return (
      <div role="dialog" aria-label="Confirmation">
        {summary}
      </div>
    );
  },
}));
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.history.replaceState(
    {},
    '',
    `/admin/electricity-price-adjustments?contractId=${changeContractId}`
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  captured.action = null;
  captured.success = null;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});
async function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function set(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function proposal() {
  await set('price-percent', '10');
  await set('price-effective', '2026-10-06T12:00');
  await set('price-reason', 'Draft reason');
  await set('price-basis', 'Draft basis');
  await act(async () =>
    container
      .querySelectorAll('form')[1]!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('retries the exact increase cursor with rows, reasons and dates kept until denial clears them', async () => {
  let status = 200;
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
    status === 200
      ? Response.json({ requests: [increaseRow], nextBefore: changeCursor })
      : Response.json({}, { status })
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<AdminElectricityIncreasesPage />));
  await set(`increase-reason-${increaseRow.requestId}`, 'Capacity explanation');
  await set(`increase-effective-${increaseRow.requestId}`, '2026-10-06T12:00');
  const input = container.querySelector(`#increase-reason-${increaseRow.requestId}`);
  status = 503;
  await click('More requests');
  const failed = fetcher.mock.calls.at(-1);
  expect(container.textContent).toContain(increaseRow.orderId);
  expect(container.querySelector(`#increase-reason-${increaseRow.requestId}`)).toBe(input);
  status = 200;
  await click('Try again');
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe(failed?.[0]);
  expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({ credentials: 'include' });
  expect((input as HTMLInputElement).value).toBe('Capacity explanation');
  expect(
    (container.querySelector(`#increase-effective-${increaseRow.requestId}`) as HTMLInputElement)
      .value
  ).toBe('2026-10-06T12:00');
  status = 403;
  await click('Refresh');
  expect(container.textContent).not.toContain(increaseRow.orderId);
  expect(container.querySelector(`#increase-reason-${increaseRow.requestId}`)).toBeNull();
  expect(container.textContent).not.toContain('Try again');
});

it('retains an increase confirmation across transient refresh and removes it when the request changes', async () => {
  let status = 200,
    changed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/review')
        ? Response.json(increaseReview('approve'))
        : status === 200
          ? Response.json({
              requests: [{ ...increaseRow, requestedKwh: changed ? '13' : '12' }],
              nextBefore: null,
            })
          : Response.json({}, { status })
    )
  );
  await act(async () => root.render(<AdminElectricityIncreasesPage />));
  await click('Approve and issue amendment');
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  const action = captured.action;
  status = 503;
  await click('Refresh');
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  status = 200;
  await click('Try again');
  expect(captured.action).toBe(action);
  changed = true;
  await click('Refresh');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it('abandons an increase preview and clears drafts when the view changes', async () => {
  const pending = deferred();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.endsWith('/review')
        ? pending.promise
        : Promise.resolve(
            Response.json({
              requests: url.includes('expired') ? [] : [increaseRow],
              nextBefore: null,
            })
          )
    )
  );
  await act(async () => root.render(<AdminElectricityIncreasesPage />));
  await set(`increase-reason-${increaseRow.requestId}`, 'Draft');
  await click('Approve and issue amendment');
  await click('Expired');
  await act(async () => pending.resolve(Response.json(increaseReview('approve'))));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).not.toContain(increaseRow.orderId);
  await click('Pending review');
  expect(
    (container.querySelector(`#increase-reason-${increaseRow.requestId}`) as HTMLInputElement).value
  ).toBe('');
});

it('ignores a late increase preview after queue permission denial', async () => {
  const pending = deferred();
  let status = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.endsWith('/review')
        ? pending.promise
        : Promise.resolve(
            status === 200
              ? Response.json({ requests: [increaseRow], nextBefore: null })
              : Response.json({}, { status })
          )
    )
  );
  await act(async () => root.render(<AdminElectricityIncreasesPage />));
  await click('Approve and issue amendment');
  status = 401;
  await click('Refresh');
  await act(async () => pending.resolve(Response.json(increaseReview('approve'))));
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).not.toContain(increaseRow.orderId);
});

it('recovers malformed increase envelopes locally without discarding accepted rows', async () => {
  let malformed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        malformed ? { requests: {}, nextBefore: 5 } : { requests: [increaseRow], nextBefore: null }
      )
    )
  );
  await act(async () => root.render(<AdminElectricityIncreasesPage />));
  malformed = true;
  await click('Refresh');
  expect(container.textContent).toContain(increaseRow.orderId);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  malformed = false;
  await click('Try again');
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it('preserves price proposal drafts, confirmation and publish key through recovery', async () => {
  let status = 200;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) =>
    url.endsWith('/review')
      ? Response.json(priceReview(JSON.parse(String(init?.body))))
      : status === 200
        ? Response.json(priceState)
        : Response.json({}, { status })
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<AdminElectricityPriceAdjustmentsPage />));
  await proposal();
  const action = captured.action;
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  const input = container.querySelector('#price-reason');
  status = 503;
  await click('Refresh');
  expect(container.querySelector('#price-reason')).toBe(input);
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  const failed = fetcher.mock.calls.at(-1);
  status = 200;
  await click('Try again');
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe(failed?.[0]);
  expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({ credentials: 'include' });
  expect(captured.action).toBe(action);
  expect((input as HTMLInputElement).value).toBe('Draft reason');
  status = 403;
  await click('Refresh');
  expect(container.querySelector('#price-reason')).toBeNull();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it('keeps a failed price preview error while the separate list recovers', async () => {
  let status = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/review')
        ? Response.json({}, { status: 503 })
        : status === 200
          ? Response.json(priceState)
          : Response.json({}, { status })
    )
  );
  await act(async () => root.render(<AdminElectricityPriceAdjustmentsPage />));
  await proposal();
  const message = container.querySelector('[role="alert"]')!.textContent;
  status = 503;
  await click('Refresh');
  status = 200;
  await click('Try again');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(message);
  expect((container.querySelector('#price-reason') as HTMLInputElement).value).toBe('Draft reason');
});

it('invalidates price confirmation and its publish key when the version changes while keeping drafts', async () => {
  let changed = false;
  const nextVersion = '88888888-8888-4888-8888-888888888888';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/review')) {
        const review = priceReview(JSON.parse(String(init?.body)));
        if (changed) review.data.calculation.versionId = nextVersion;
        return Response.json(review);
      }
      return Response.json({
        ...priceState,
        versionId: changed ? nextVersion : priceState.versionId,
      });
    })
  );
  await act(async () => root.render(<AdminElectricityPriceAdjustmentsPage />));
  await proposal();
  const oldKey = (captured.action!.body as { idempotencyKey: string }).idempotencyKey;
  changed = true;
  await click('Refresh');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect((container.querySelector('#price-reason') as HTMLInputElement).value).toBe('Draft reason');
  await proposal();
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect((captured.action!.body as { idempotencyKey: string }).idempotencyKey).not.toBe(oldKey);
});

it('scope changes clear price drafts and block late previews for the old contract', async () => {
  const pending = deferred();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.endsWith('/review')
        ? pending.promise
        : Promise.resolve(
            Response.json({
              ...priceState,
              contractId: url.includes('/other-contract/') ? 'other-contract' : changeContractId,
            })
          )
    )
  );
  await act(async () => root.render(<AdminElectricityPriceAdjustmentsPage />));
  await proposal();
  await set('electricity-price-contract', 'other-contract');
  await click('Open contract');
  await act(async () =>
    pending.resolve(
      Response.json(
        priceReview({
          reason: 'Draft reason',
          contractualBasis: 'Draft basis',
          effectiveFrom: '2026-10-06T12:00:00.000Z',
          percentageBps: '1000',
        })
      )
    )
  );
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect((container.querySelector('#price-reason') as HTMLInputElement).value).toBe('');
});

it('closes price finalization when fresh data removes the permission and keeps rows', async () => {
  let allowed = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ...priceState,
        canPropose: false,
        canFinalize: allowed,
        adjustments: [priceRow],
      })
    )
  );
  await act(async () => root.render(<AdminElectricityPriceAdjustmentsPage />));
  await click('Finalize and issue adjustment');
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  allowed = false;
  await click('Refresh');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toContain('Published tariff');
});

it('an obsolete price write cannot clear new drafts after permission recovery', async () => {
  let status = 200;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) =>
    url.endsWith('/review')
      ? Response.json(priceReview(JSON.parse(String(init?.body))))
      : status === 200
        ? Response.json(priceState)
        : Response.json({}, { status })
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<AdminElectricityPriceAdjustmentsPage />));
  await proposal();
  const oldSuccess = captured.success!;
  expect(oldSuccess).toBeTypeOf('function');
  status = 403;
  await click('Refresh');
  status = 200;
  await click('Refresh');
  await set('price-reason', 'New authorized draft');
  const reads = fetcher.mock.calls.length;
  await act(async () => oldSuccess());
  expect((container.querySelector('#price-reason') as HTMLInputElement).value).toBe(
    'New authorized draft'
  );
  expect(fetcher.mock.calls.length).toBe(reads);
});
it('an obsolete increase write cannot reload a different queue view', async () => {
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith('/review')
      ? Response.json(increaseReview('approve'))
      : Response.json({ requests: url.includes('expired') ? [] : [increaseRow], nextBefore: null })
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<AdminElectricityIncreasesPage />));
  await click('Approve and issue amendment');
  const oldSuccess = captured.success!;
  expect(oldSuccess).toBeTypeOf('function');
  await click('Expired');
  const reads = fetcher.mock.calls.length;
  await act(async () => oldSuccess());
  expect(fetcher.mock.calls.length).toBe(reads);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
