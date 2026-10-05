import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Increases from './AdminElectricityIncreasesPage.js';
import Prices from './AdminElectricityPriceAdjustmentsPage.js';
import { useListQuery } from '../hooks/useListQuery.js';
import {
  electricityIncreaseQueryOptions,
  electricityPriceQueryOptions,
} from '../lib/electricity-change-query.js';
import {
  changeContractId,
  changeCursor,
  increaseRow,
  increaseReview,
  priceState,
} from '../test/electricity-change-fixtures.js';

let confirmation: { onSuccess: () => Promise<void>; onClose: () => void } | null;
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: NonNullable<typeof confirmation>) => {
    confirmation = props;
    return <div role="dialog">Review</div>;
  },
}));
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
let navigate: (raw: Record<string, unknown>) => void;
let host: HTMLDivElement, root: Root;
function Bound({ price = false }: { price?: boolean }) {
  const [raw, setRaw] = useState<Record<string, unknown>>(
    price ? { contractId: changeContractId } : {}
  );
  navigate = setRaw;
  const queries = useListQuery(
    price ? electricityPriceQueryOptions : electricityIncreaseQueryOptions,
    raw,
    setRaw
  );
  return price ? <Prices queries={queries} /> : <Increases queries={queries} />;
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
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function fill(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>('#' + id)!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('increase history clears private work and old callbacks cannot dismiss a newer review or reload', async () => {
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith('/review')
      ? Response.json(increaseReview('approve'))
      : Response.json({ requests: [increaseRow], nextBefore: changeCursor })
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<Bound />));
  await fill('increase-reason-' + increaseRow.requestId, 'Private draft');
  await click('Approve and issue amendment');
  await act(async () => vi.dynamicImportSettled());
  const old = confirmation!;
  await act(async () => navigate({ cursor: changeCursor }));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(
    host.querySelector<HTMLInputElement>('#increase-reason-' + increaseRow.requestId)?.value
  ).toBe('');
  await click('Approve and issue amendment');
  await act(async () => vi.dynamicImportSettled());
  const count = fetcher.mock.calls.length;
  await act(async () => {
    old.onClose();
    await old.onSuccess();
  });
  expect(fetcher).toHaveBeenCalledTimes(count);
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
});
it('a pending increase page keeps More visible but disabled and refuses a repeated cursor', async () => {
  let finish!: (r: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.includes('before=')
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(Response.json({ requests: [increaseRow], nextBefore: changeCursor }))
    )
  );
  await act(async () => root.render(<Bound />));
  await fill('increase-reason-' + increaseRow.requestId, 'Local draft');
  await click('More requests');
  const more = [...host.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'More requests'
  );
  expect(more?.disabled).toBe(true);
  expect(
    host.querySelector<HTMLInputElement>('#increase-reason-' + increaseRow.requestId)?.value
  ).toBe('Local draft');
  await act(async () =>
    finish(Response.json({ requests: [increaseRow], nextBefore: changeCursor }))
  );
  expect(
    [...host.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'More requests')
  ).toBe(false);
});
it('late increase reviews are discarded after restored cursor navigation', async () => {
  let finish!: (r: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.endsWith('/review')
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(Response.json({ requests: [increaseRow], nextBefore: null }))
    )
  );
  await act(async () => root.render(<Bound />));
  await click('Approve and issue amendment');
  await act(async () => navigate({ cursor: changeCursor }));
  await act(async () => finish(Response.json(increaseReview('approve'))));
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it('price selection restores the contract input and clears only obsolete contract work', async () => {
  const fetcher = vi.fn(async (url: string) =>
    Response.json({ ...priceState, contractId: url.split('/')[5] })
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () => root.render(<Bound price />));
  await fill('price-reason', 'Private price reason');
  await fill('electricity-price-contract', 'Unapplied input');
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => navigate({ contractId: changeCursor }));
  expect(host.querySelector<HTMLInputElement>('#electricity-price-contract')?.value).toBe(
    changeCursor
  );
  expect(host.querySelector<HTMLInputElement>('#price-reason')?.value).toBe('');
  await act(async () => navigate({ contractId: changeContractId }));
  expect(host.querySelector<HTMLInputElement>('#electricity-price-contract')?.value).toBe(
    changeContractId
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
});
