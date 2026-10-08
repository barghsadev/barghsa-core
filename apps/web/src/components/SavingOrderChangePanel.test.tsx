import { QueryComponentProvider as QueryProvider } from '../test/query-provider.js';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type * as SchemaModule from '../lib/saving-change-form-schemas.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import {
  ids,
  source,
  plans,
  addresses,
  fullQuote,
  receipt,
} from '../lib/saving-change-form.fixtures.js';
import { SavingOrderChangePanel } from './SavingOrderChangePanel.js';
import type { SavingChangeSource } from '../lib/saving-change-form.js';

vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
const schemaLoader = vi.hoisted(() => ({ hold: null as Promise<void> | null }));
vi.mock('../lib/saving-change-form-schemas.js', async (importOriginal) => {
  if (schemaLoader.hold) await schemaLoader.hold;
  return importOriginal<typeof SchemaModule>();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
let root: Root | undefined;
let host: HTMLDivElement;
let current = source;
let actor = 'buyer';
const changed = vi.fn();
const locks = vi.fn();
const withdrawn = vi.fn();
function tree() {
  return (
    <AccountUserProvider value={actor}>
      <SavingOrderChangePanel
        {...current}
        onChanged={changed}
        onCommandLock={locks}
        onWithdrawal={withdrawn}
      />
    </AccountUserProvider>
  );
}
const options = (url: string) =>
  Response.json(
    url === '/api/saving/plans'
      ? plans
      : {
          addresses: addresses.addresses.map((row) => ({ ...row, profileId: url.split('/')[3] })),
        }
  );
async function render(fetchMock: ReturnType<typeof vi.fn>) {
  current = source;
  actor = 'buyer';
  changed.mockReset();
  locks.mockReset();
  withdrawn.mockReset();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', fetchMock);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<QueryProvider>{tree()}</QueryProvider>));
}
async function rerender(patch: Partial<SavingChangeSource> = {}, nextActor = actor) {
  current = { ...current, ...patch };
  actor = nextActor;
  await act(async () => root!.render(<QueryProvider>{tree()}</QueryProvider>));
}
async function settled(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    check();
  });
}
const control = (name: string) => host.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
async function select(name: string, value: string) {
  await act(async () => {
    const node = control(name);
    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function choose() {
  await select('hardwareProductId', ids.nextHardware);
  await select('installationAddressId', ids.nextAddress);
}
async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
const writes = (mock: ReturnType<typeof vi.fn>, suffix: string) =>
  mock.mock.calls.filter(
    ([url, init]) =>
      (init as RequestInit | undefined)?.method === 'POST' && (url as string).endsWith(suffix)
  );
const publicError = (fields: unknown[], code = 'VALIDATION:INPUT:INVALID') => ({
  error: { code, message: 'Invalid input', correlationId: ids.orderId, fields },
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  schemaLoader.hold = null;
  vi.unstubAllGlobals();
});

it('owns a held lazy submit synchronously, keeps controls focusable and discards errors from the old draft', async () => {
  const held = deferred<void>();
  schemaLoader.hold = held.promise;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    init?.method === 'POST' ? Response.json(fullQuote(), { status: 201 }) : options(url)
  );
  await render(fetchMock);
  await submit();
  await submit();
  expect(writes(fetchMock, 'change-quote')).toHaveLength(0);
  expect(control('hardwareProductId').disabled).toBe(false);
  await choose();
  await act(async () => held.resolve());
  await settled(() => expect(host.querySelector('[aria-busy="true"]')).toBeNull());
  expect(control('hardwareProductId').getAttribute('aria-invalid')).not.toBe('true');
  expect(writes(fetchMock, 'change-quote')).toHaveLength(0);
  await submit();
  await settled(() =>
    expect(host.querySelector('[data-testid="saving-change-quote"]')).not.toBeNull()
  );
  expect(writes(fetchMock, 'change-quote')).toHaveLength(1);
});
it('previews and confirms one equipment and address change with the reviewed digest', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? Response.json(url.endsWith('change-quote') ? fullQuote() : receipt(), { status: 201 })
      : options(url)
  );
  await render(fetchMock);
  expect(
    (host.querySelector(`option[value="${ids.emptyHardware}"]`) as HTMLOptionElement).disabled
  ).toBe(true);
  await choose();
  await click('Review new price');
  await settled(() =>
    expect(host.textContent).toContain('Your existing gift discount remains applied.')
  );
  expect(JSON.parse(String(writes(fetchMock, 'change-quote')[0]![1]!.body))).toEqual({
    hardwareProductId: ids.nextHardware,
    installationAddressId: ids.nextAddress,
  });
  await click('Confirm changes');
  expect(JSON.parse(String(writes(fetchMock, 'change')[0]![1]!.body))).toEqual({
    hardwareProductId: ids.nextHardware,
    installationAddressId: ids.nextAddress,
    expectedQuoteDigest: 'a'.repeat(64),
    idempotencyKey: expect.any(String),
  });
  expect(changed).toHaveBeenCalledOnce();
  expect(locks.mock.calls.map(([locked]) => locked)).toEqual([true, false]);
});
it('links touched unchanged/address feedback, focuses actual selects and preserves companions', async () => {
  const fetchMock = vi.fn(async (url: string) => options(url));
  await render(fetchMock);
  await submit();
  await settled(() => expect(document.activeElement).toBe(control('hardwareProductId')));
  expect(host.textContent).toContain('Choose a different device or installation address.');
  expect(control('hardwareProductId').id).toBe('saving-change-hardware');
  expect(host.querySelector('label[for="saving-change-hardware"]')).not.toBeNull();
  expect(control('hardwareProductId').getAttribute('aria-describedby')).toContain(
    'saving-change-hardware-description'
  );
  await select('hardwareProductId', ids.nextHardware);
  await select('installationAddressId', '');
  await submit();
  await settled(() => expect(document.activeElement).toBe(control('installationAddressId')));
  expect(control('hardwareProductId').value).toBe(ids.nextHardware);
  expect(writes(fetchMock, 'change-quote')).toHaveLength(0);
});
it.each(['hardwareProductId', 'installationAddressId'] as const)(
  'maps complete owned %s failures and retains selections',
  async (field) => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === 'POST' ? Response.json(publicError([field]), { status: 400 }) : options(url)
    );
    await render(fetchMock);
    await choose();
    await submit();
    await settled(() => expect(document.activeElement).toBe(control(field)));
    expect(control('hardwareProductId').value).toBe(ids.nextHardware);
    expect(control('installationAddressId').value).toBe(ids.nextAddress);
    expect(host.textContent).not.toContain('Invalid input');
  }
);
it.each([{ fields: ['hardwareProductId', 'expectedQuoteDigest'] }, { fields: ['idempotencyKey'] }])(
  'keeps protected/mixed errors generic: $fields',
  async ({ fields }) => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === 'POST' ? Response.json(publicError(fields), { status: 400 }) : options(url)
    );
    await render(fetchMock);
    await choose();
    await submit();
    await settled(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
    expect(host.querySelector('select[aria-invalid="true"]')).toBeNull();
    expect(control('hardwareProductId').value).toBe(ids.nextHardware);
  }
);
it.each([201, 400])('discards held preview%s success/error after draft edits', async (status) => {
  const held = deferred<Response>();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    init?.method === 'POST' ? held.promise : options(url)
  );
  await render(fetchMock);
  await choose();
  await submit();
  await settled(() => expect(writes(fetchMock, 'change-quote')).toHaveLength(1));
  await select('hardwareProductId', ids.hardware);
  await act(async () =>
    held.resolve(
      Response.json(status === 201 ? fullQuote() : publicError(['hardwareProductId']), { status })
    )
  );
  expect(host.querySelector('[data-testid="saving-change-quote"]')).toBeNull();
  expect(control('hardwareProductId').getAttribute('aria-invalid')).not.toBe('true');
  expect(control('hardwareProductId').value).toBe(ids.hardware);
});
it('rejects a foreign quote before exposing its private address/agreement or confirming', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? Response.json(
          {
            ...fullQuote(),
            baseVersionId: ids.newVersion,
            address: { ...fullQuote().address, full_address: 'Foreign private address' },
          },
          { status: 201 }
        )
      : options(url)
  );
  await render(fetchMock);
  await choose();
  await submit();
  expect(host.textContent).not.toContain('Foreign private address');
  expect(host.textContent).not.toContain('Confirm changes');
  expect(control('hardwareProductId').value).toBe(ids.nextHardware);
});
it('retains exact captured body/key through unknown receipt, attempted edits, duplicate confirms and rejected uncertain retry', async () => {
  const held = deferred<Response>();
  let save = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    init?.method !== 'POST'
      ? options(url)
      : url.endsWith('change-quote')
        ? Response.json(fullQuote(), { status: 201 })
        : ++save === 1
          ? held.promise
          : save === 2
            ? Response.json(publicError(['hardwareProductId']), { status: 400 })
            : Response.json(receipt(), { status: 201 })
  );
  await render(fetchMock);
  await choose();
  await submit();
  await settled(() => expect(host.textContent).toContain('Confirm changes'));
  const button = [...host.querySelectorAll('button')].find(
    (item) => item.textContent === 'Confirm changes'
  )!;
  await act(async () => {
    button.click();
    button.click();
  });
  expect(writes(fetchMock, 'change')).toHaveLength(1);
  expect(control('hardwareProductId').disabled).toBe(true);
  await select('hardwareProductId', ids.hardware);
  expect(control('hardwareProductId').value).toBe(ids.nextHardware);
  await act(async () =>
    held.resolve(Response.json({ savingOrderId: ids.orderId }, { status: 201 }))
  );
  await click('Retry captured change');
  expect(host.textContent).toContain('Retry captured change');
  expect(control('hardwareProductId').disabled).toBe(true);
  expect(host.querySelector('select[aria-invalid="true"]')).toBeNull();
  await click('Retry captured change');
  const sent = writes(fetchMock, 'change');
  expect(sent).toHaveLength(3);
  expect(sent[0]![1]!.body).toBe(sent[1]![1]!.body);
  expect(sent[1]![1]!.body).toBe(sent[2]![1]!.body);
  expect(changed).toHaveBeenCalledOnce();
});
it('keeps unknown complete4xx or wrong2xx receipts locked but releases a complete original known rejection', async () => {
  let stage = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    init?.method !== 'POST'
      ? options(url)
      : url.endsWith('change-quote')
        ? Response.json(fullQuote(), { status: 201 })
        : Response.json(
            stage === 0
              ? publicError(['installationAddressId'])
              : stage === 1
                ? publicError([], 'UNKNOWN')
                : receipt(),
            { status: stage === 2 ? 200 : 400 }
          )
  );
  await render(fetchMock);
  await choose();
  await submit();
  await settled(() => expect(host.textContent).toContain('Confirm changes'));
  await click('Confirm changes');
  await settled(() => expect(document.activeElement).toBe(control('installationAddressId')));
  expect(control('installationAddressId').disabled).toBe(false);
  expect(changed).not.toHaveBeenCalled();
  stage = 1;
  await submit();
  await settled(() => expect(host.textContent).toContain('Confirm changes'));
  await click('Confirm changes');
  expect(control('hardwareProductId').disabled).toBe(true);
  stage = 2;
  await click('Retry captured change');
  expect(host.textContent).toContain('Retry captured change');
  expect(changed).not.toHaveBeenCalled();
});
it.each([401, 403, 404])(
  'withdraws private quote/draft after a current write%s',
  async (status) => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method !== 'POST'
        ? options(url)
        : Response.json(url.endsWith('change-quote') ? fullQuote() : {}, {
            status: url.endsWith('change-quote') ? 201 : status,
          })
    );
    await render(fetchMock);
    await choose();
    await submit();
    await settled(() => expect(host.textContent).toContain('Confirm changes'));
    await click('Confirm changes');
    expect(host.querySelector('select')).toBeNull();
    expect(host.textContent).not.toContain('Original accepted agreement body');
    expect(host.textContent).not.toContain('New street');
    expect(locks).toHaveBeenLastCalledWith(false);
    expect(withdrawn).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
  }
);
it('withdraws private choices on current denied read and preserves drafts through ordinary options retry', async () => {
  let status = 503;
  const fetchMock = vi.fn(async (url: string) =>
    status === 200 ? options(url) : Response.json({}, { status })
  );
  await render(fetchMock);
  expect(host.textContent).toContain('Reload available choices');
  status = 200;
  await click('Reload available choices');
  await choose();
  await rerender({}, 'new buyer');
  status = 403;
  await rerender({}, 'third buyer');
  expect(host.querySelector('select')).toBeNull();
  expect(host.textContent).toContain('You cannot change this order.');
});
it.each(['actor', 'profileId', 'orderId', 'currentVersionId', 'invoiceId'] as const)(
  'fences obsolete quote/read callbacks at changed %s scope',
  async (field) => {
    const held = deferred<Response>();
    let quotes = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? ++quotes === 1
          ? held.promise
          : Response.json(fullQuote(), { status: 201 })
        : options(url)
    );
    await render(fetchMock);
    await choose();
    await submit();
    await settled(() => expect(quotes).toBe(1));
    await rerender(
      field === 'actor' ? {} : { [field]: ids.city },
      field === 'actor' ? 'new buyer' : actor
    );
    await act(async () => held.resolve(Response.json({}, { status: 403 })));
    expect(host.textContent).not.toContain('You cannot change this order.');
    expect(host.querySelector('[data-testid="saving-change-quote"]')).toBeNull();
    expect(control('hardwareProductId').value).toBe(ids.hardware);
  }
);
it('clears old captured private work synchronously after confirmed active profile revision and ignores its late receipt', async () => {
  const held = deferred<Response>();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    init?.method !== 'POST'
      ? options(url)
      : url.endsWith('change-quote')
        ? Response.json(fullQuote(), { status: 201 })
        : held.promise
  );
  await render(fetchMock);
  await choose();
  await submit();
  await settled(() => expect(host.textContent).toContain('Confirm changes'));
  await click('Confirm changes');
  await act(async () => refreshProfileContext());
  expect(host.textContent).not.toContain('Original accepted agreement body');
  expect(control('hardwareProductId').value).toBe(ids.hardware);
  await act(async () => held.resolve(Response.json(receipt(), { status: 201 })));
  expect(changed).not.toHaveBeenCalled();
  expect(control('hardwareProductId').value).toBe(ids.hardware);
});

it('rejects an explicit foreign profile address before exposing private options', async () => {
  const fetchMock = vi.fn(async (url: string) =>
    Response.json(
      url === '/api/saving/plans'
        ? plans
        : {
            addresses: [
              {
                ...addresses.addresses[0],
                profileId: ids.city,
                fullAddress: 'Foreign private choice',
              },
            ],
          }
    )
  );
  await render(fetchMock);
  expect(host.textContent).not.toContain('Foreign private choice');
  expect(host.querySelector('select')).toBeNull();
  expect(host.textContent).toContain('Reload available choices');
});
