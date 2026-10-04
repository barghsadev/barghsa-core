import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { t } from '@barghsa/i18n/app';
import type * as Ui from '@barghsa/ui';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { ElectricityPriceAdjustmentsPanel } from './ElectricityPriceAdjustmentsPanel.js';
import {
  priceAdjustmentRow,
  priceContractId,
  priceProfileId,
  priceVersionId,
  priceAdjustmentInvoiceId,
} from '../test/electricity-price-adjustment-fixtures.js';

const callbacks = vi.hoisted(() => ({ retries: [] as (() => void)[] }));
vi.mock('@barghsa/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof Ui>();
  return {
    ...actual,
    Button: (props: React.ComponentProps<typeof actual.Button> & { 'data-testid'?: string }) => {
      const handler = props.onClick;
      if (handler && props['data-testid'] === 'electricity-price-history-retry')
        callbacks.retries.push(() => Reflect.apply(handler, undefined, []));
      return <actual.Button {...props} />;
    },
  };
});
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    irrDigits: String,
    number: (value: number | bigint, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en-US', options).format(value),
  }),
}));
let host: HTMLDivElement, root: Root;
let requests: Mock<(path: string, init?: RequestInit) => Promise<Response>>;
let read: () => Response | Promise<Response>;
beforeEach(() => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  callbacks.retries = [];
  read = () => Response.json({ adjustments: [priceAdjustmentRow()] });
  requests = vi.fn(async () => read());
  vi.stubGlobal('fetch', requests);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
type Scope = { actor: string; contractId: string; profileId: string; versionId: string | null };
async function render(overrides: Partial<Scope> = {}) {
  const props: Scope = {
    actor: 'customer',
    contractId: priceContractId,
    profileId: priceProfileId,
    versionId: priceVersionId,
    ...overrides,
  };
  await act(async () =>
    root.render(
      <AccountUserProvider value={props.actor}>
        <ElectricityPriceAdjustmentsPanel {...props} formatTimestamp={String} />
      </AccountUserProvider>
    )
  );
}
const retry = () =>
  host.querySelector<HTMLButtonElement>('[data-testid=electricity-price-history-retry]')!;
function rowWithReason(reason: string, contractId = priceContractId) {
  const row = priceAdjustmentRow();
  row.reason = row.calculation.reason = reason;
  row.contractId = row.calculation.contractId = contractId;
  return row;
}

it.each(['en', 'fa'] as const)(
  'discloses complete historical credit history in %s without customer acceptance',
  async (locale) => {
    document.documentElement.lang = locale;
    read = () => Response.json({ adjustments: [priceAdjustmentRow('finalized')] });
    await render({ versionId: '77777777-7777-4777-8777-777777777777' });
    expect(host.textContent).toContain('Published tariff correction');
    expect(host.textContent).toContain('Clause 7');
    expect(host.textContent).toContain('450000');
    expect(host.textContent).toContain('1000000');
    expect(host.textContent).toContain(t('electricity.priceAdjustment.creditAmount', locale));
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      `/invoices/${priceAdjustmentInvoiceId}`
    );
    expect(host.querySelector('button')).toBeNull();
    expect(requests).toHaveBeenCalledWith(
      `/api/electricity/contracts/${priceContractId}/price-adjustments`,
      expect.objectContaining({ credentials: 'include' })
    );
  }
);

it('loads authorized history even when the current order has no version', async () => {
  await render({ versionId: null });
  expect(host.textContent).toContain('Published tariff correction');
});

it.each(['partial', 'incoherent', 'foreign', 'duplicate'] as const)(
  'suppresses the entire %s public history before any private financial value is displayed',
  async (kind) => {
    const row = rowWithReason('Private malformed history');
    const rows: unknown[] = [priceAdjustmentRow('cancelled'), row];
    if (kind === 'partial') rows[1] = { adjustmentId: row.adjustmentId, reason: row.reason };
    if (kind === 'incoherent') row.calculation.quote.newFutureIrR = '450001';
    if (kind === 'foreign')
      row.contractId = row.calculation.contractId = '77777777-7777-4777-8777-777777777777';
    if (kind !== 'duplicate') {
      (rows[0] as ReturnType<typeof priceAdjustmentRow>).adjustmentId =
        '88888888-8888-4888-8888-888888888888';
    }
    read = () => Response.json({ adjustments: rows });
    await render();
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    expect(host.textContent).not.toContain('Private malformed history');
    expect(host.textContent).not.toContain('Published tariff correction');
    expect(host.querySelector('a')).toBeNull();
  }
);

it.each([401, 403, 404])(
  'withdraws previously authorized history on a live %s read after a recoverable failure',
  async (status) => {
    read = () => new Response('', { status: 503 });
    await render();
    const retainedRetry = callbacks.retries.at(-1)!;
    read = () => Response.json({ adjustments: [priceAdjustmentRow('finalized')] });
    await act(async () => retainedRetry());
    expect(host.textContent).toContain('Published tariff correction');
    read = () => new Response('', { status: 503 });
    await act(async () => retainedRetry());
    expect(host.textContent).toContain('Published tariff correction');
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    read = () => new Response('', { status });
    await act(async () => retry().click());
    expect(host.textContent).not.toContain('Published tariff correction');
    expect(host.querySelector('a')).toBeNull();
    expect(host.querySelector('[role=alert]')).not.toBeNull();
  }
);

it('guards a retry synchronously before a held read begins', async () => {
  read = () => new Response('', { status: 503 });
  await render();
  const handler = callbacks.retries.at(-1)!;
  let release!: (response: Response) => void;
  read = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  await act(async () => {
    handler();
    handler();
  });
  expect(requests).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role=status]')).not.toBeNull();
  await act(async () => release(Response.json({ adjustments: [priceAdjustmentRow()] })));
  expect(host.textContent).toContain('Published tariff correction');
});

it.each(['actor', 'profileId', 'contractId', 'versionId'] as const)(
  'fences held history and obsolete retry callbacks when %s changes',
  async (field) => {
    read = () => new Response('', { status: 503 });
    await render();
    const obsoleteRetry = callbacks.retries.at(-1)!;
    let release!: (response: Response) => void;
    read = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    await act(async () => obsoleteRetry());
    const next = {
      [field]: field === 'actor' ? 'new-customer' : '77777777-7777-4777-8777-777777777777',
    };
    const nextContract = field === 'contractId' ? next[field] : priceContractId;
    read = () =>
      Response.json({ adjustments: [rowWithReason('Current authorized history', nextContract)] });
    await render(next);
    expect(host.textContent).toContain('Current authorized history');
    const count = requests.mock.calls.length;
    await act(async () => obsoleteRetry());
    expect(requests).toHaveBeenCalledTimes(count);
    await act(async () =>
      release(Response.json({ adjustments: [rowWithReason('Obsolete private history')] }))
    );
    expect(host.textContent).toContain('Current authorized history');
    expect(host.textContent).not.toContain('Obsolete private history');
  }
);

it('does not let an old denied read withdraw the newly authorized account history', async () => {
  let release!: (response: Response) => void;
  read = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  await render();
  read = () => Response.json({ adjustments: [rowWithReason('New account history')] });
  await render({ actor: 'new-customer' });
  await act(async () => release(new Response('', { status: 403 })));
  expect(host.textContent).toContain('New account history');
  expect(host.querySelector('[role=alert]')).toBeNull();
});

it('fences parsed response data across a confirmed profile context revision', async () => {
  let release!: (body: unknown) => void;
  const response = Response.json({});
  vi.spyOn(response, 'json').mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  read = () => response;
  await render();
  read = () => Response.json({ adjustments: [] });
  await act(async () => refreshProfileContext());
  await act(async () => release({ adjustments: [rowWithReason('Previous profile secret')] }));
  expect(host.textContent).not.toContain('Previous profile secret');
  expect(requests).toHaveBeenCalledTimes(2);
});

it('formats a large persisted percentage without converting its integer basis points to a float', async () => {
  const row = priceAdjustmentRow('proposed', 'charge');
  row.percentageBps = row.calculation.quote.percentageBps = '999999999999999999';
  row.adjustmentAmountIrR = row.calculation.quote.amountIrR = '100000000000000';
  row.calculation.quote.oldFutureIrR = '1';
  row.calculation.quote.newFutureIrR = '100000000000001';
  Object.assign(row.calculation.quote.components[0]!, {
    basisIrR: '2',
    oldFutureIrR: '1',
    changeIrR: row.adjustmentAmountIrR,
    newFutureIrR: row.calculation.quote.newFutureIrR,
  });
  await render();
  read = () => Response.json({ adjustments: [row] });
  await render({ versionId: null });
  expect(host.textContent).toContain('9,999,999,999,999,999.99%');
});
