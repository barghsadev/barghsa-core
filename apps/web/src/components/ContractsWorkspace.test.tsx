import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContractsWorkspace } from './ContractsWorkspace.js';
import { ContractDetail } from './ContractDetail.js';
import { ContractTerms } from './ContractTerms.js';
import ContractsPage from '../pages/ContractsPage.js';
import AdminContractsPage from '../pages/AdminContractsPage.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import type { TeamAction } from './TeamActionDialog.js';
import type { ContractDetailData, ContractVersion } from '../lib/contracts.js';
import { en, fa } from '@barghsa/i18n/contracts';
const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  action: null as TeamAction | null,
  result: null as unknown,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (value: string) => value }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: (value: number) => String(value) }),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onClose,
    onSuccess,
  }: {
    action: TeamAction;
    onClose: () => void;
    onSuccess: (result: unknown) => Promise<void>;
  }) => {
    harness.action = action;
    return (
      <div role="dialog">
        <button onClick={() => void onSuccess(harness.result)}>Confirm action</button>
        <button onClick={onClose}>Close confirmation</button>
      </div>
    );
  },
}));
const ID = '11111111-1111-4111-8111-111111111111',
  PROFILE = '22222222-2222-4222-8222-222222222222',
  VERSION = '33333333-3333-4333-8333-333333333333',
  OLD = '44444444-4444-4444-8444-444444444444';
const version = (extra: Partial<ContractVersion> = {}): ContractVersion => ({
  id: VERSION,
  versionNumber: 2,
  content: { price: '9007199254740993', termMonths: 12, text: '<script>never execute</script>' },
  changeDescription: 'Revised price',
  createdAt: '2026-09-21T00:00:00Z',
  createdBy: 'legal-reviewer',
  acceptedAt: null,
  ...extra,
});
const detail = (extra: Partial<ContractDetailData> = {}): ContractDetailData => ({
  id: ID,
  profileId: PROFILE,
  serviceType: 'electricity',
  state: 'AwaitingCustomerAcceptance',
  version: version(),
  canAccept: true,
  ...extra,
});
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  harness.locale = 'en';
  harness.action = null;
  harness.result = null;
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
function button(text: string) {
  const match = [...container.querySelectorAll('button')].find((item) => item.textContent === text);
  expect(match, text).toBeDefined();
  return match!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function value(selector: string, text: string) {
  const input = container.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    selector
  )!;
  const prototype =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
function api(current = detail()) {
  return vi.fn(async (raw: string) => {
    const url = new URL(raw, 'https://app.test');
    if (url.pathname.endsWith('/activation'))
      return response({
        checks: [],
        isCurrent: true,
        ready: false,
        evaluatedAt: '2026-09-21T00:00:00Z',
      });
    if (url.pathname.endsWith('/signature'))
      return response({ canRequest: false, canRecord: false, request: null, signature: null });
    if (url.pathname.endsWith('/documents')) return response({ documents: [], nextBefore: null });
    if (url.pathname.endsWith('/versions'))
      return response({
        versions: [
          version(),
          version({ id: OLD, versionNumber: 1, changeDescription: 'Original terms' }),
        ],
        nextBefore: null,
      });
    if (url.pathname.endsWith('/versions/' + OLD))
      return response(
        url.pathname.includes('/admin/')
          ? version({ id: OLD, versionNumber: 1, content: { text: 'Earlier terms' } })
          : {
              ...current,
              version: version({ id: OLD, versionNumber: 1, content: { text: 'Earlier terms' } }),
              canAccept: false,
            }
      );
    if (url.pathname.endsWith('/versions/' + VERSION))
      return response(url.pathname.includes('/admin/') ? version() : current);
    if (url.pathname.endsWith('/' + ID)) return response(current);
    return response({
      contracts: [
        {
          id: ID,
          serviceType: 'electricity',
          state: current.state,
          versionId: VERSION,
          versionNumber: 2,
        },
      ],
      nextBefore: null,
    });
  });
}
it.each(['en', 'fa'] as const)(
  'renders published terms and exact acceptance in %s',
  async (locale) => {
    harness.locale = locale;
    const words = locale === 'fa' ? fa : en;
    const fetcher = api();
    vi.stubGlobal('fetch', fetcher);
    await render(<ContractsPage />);
    expect(container.querySelector('[dir]')?.getAttribute('dir')).toBe(
      locale === 'fa' ? 'rtl' : 'ltr'
    );
    await click(`${words.electricity} · ${words.version} ${(2).toLocaleString(locale)}`);
    expect(container.textContent).toContain('9007199254740993');
    expect(container.querySelector('script')).toBeNull();
    expect(button(words.accept).disabled).toBe(true);
    await act(async () =>
      container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click()
    );
    await click(words.accept);
    expect(harness.action).toMatchObject({
      path: `/api/contracts/${ID}/accept`,
      body: { expectedVersionId: VERSION },
    });
    const key = (harness.action!.body as { idempotencyKey: string }).idempotencyKey;
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    await click('Close confirmation');
    await click(`${words.version} ${(1).toLocaleString(locale)}`);
    expect(container.textContent).toContain('Earlier terms');
    expect(container.textContent).not.toContain(words.acceptAcknowledgement);
    expect(fetcher.mock.calls.some(([url]) => url.includes('contractVersionId=' + OLD))).toBe(true);
    await click(`${words.version} ${(2).toLocaleString(locale)}`);
    expect(button(words.accept).disabled).toBe(true);
    await click(words.close);
    expect(container.querySelector('input[type=checkbox]')).toBeNull();
  }
);
it('abandons a pending contract response when the active profile changes', async () => {
  let resolve!: (value: Response) => void;
  let staleSignal: AbortSignal | undefined;
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((_: string, options: RequestInit) => {
      calls++;
      if (calls === 1) {
        staleSignal = options.signal as AbortSignal;
        return new Promise<Response>((done) => {
          resolve = done;
        });
      }
      return Promise.resolve(response({ contracts: [], nextBefore: null }));
    })
  );
  await render(<ContractsWorkspace />);
  await act(async () => refreshProfileContext());
  expect(staleSignal?.aborted).toBe(true);
  await act(async () =>
    resolve(
      response({
        contracts: [{ id: ID, serviceType: 'solar', state: 'Draft', versionNumber: 1 }],
        nextBefore: null,
      })
    )
  );
  expect(container.textContent).toContain(en.empty);
  expect(container.textContent).not.toContain(en.solar);
});
it('validates staff filters, deduplicates pagination, and recovers list errors', async () => {
  let failed = true;
  const fetcher = vi.fn(async (raw: string) => {
    const url = new URL(raw, 'https://app.test');
    if (failed) return response({}, 403);
    return response({
      contracts: [{ id: ID, serviceType: 'electricity', state: 'Draft', versionNumber: 2 }],
      nextBefore: url.searchParams.has('before') ? null : ID,
    });
  });
  vi.stubGlobal('fetch', fetcher);
  await render(<AdminContractsPage />);
  expect(container.querySelector('[role=alert]')).not.toBeNull();
  failed = false;
  await click(en.refresh);
  await click(en.next);
  expect(container.querySelectorAll('li')).toHaveLength(1);
  await value('#contracts-profile', 'bad');
  await click(en.apply);
  expect(container.textContent).toContain(en.invalidProfile);
  await value('#contracts-profile', PROFILE);
  await value('#contracts-state', 'Draft');
  await value('#contracts-service', 'electricity');
  await click(en.apply);
  expect(fetcher.mock.calls.at(-1)?.[0]).toContain(`profileId=${PROFILE}`);
  expect(fetcher.mock.calls.at(-1)?.[0]).toContain('state=Draft');
});
it('requires a changes reason and captures the current staff version for review', async () => {
  const changed = vi.fn();
  let current = detail({
    state: 'AwaitingStaffReview',
    currentVersionId: VERSION,
    currentVersion: version(),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => api(current)(url))
  );
  await render(<ContractDetail id={ID} staff onClose={() => {}} onChanged={changed} />);
  await click(en['request-changes']);
  expect(container.textContent).toContain(en.reasonRequired);
  expect(harness.action).toBeNull();
  await value('#contract-change-reason', 'Explain the revised price');
  await click(en['request-changes']);
  expect(harness.action).toMatchObject({
    body: { expectedVersionId: VERSION, reason: 'Explain the revised price' },
  });
  await click('Close confirmation');
  await click(en.publish);
  expect(harness.action?.path).toBe(`/api/admin/contracts/${ID}/publish`);
  current = { ...current, state: 'AwaitingCustomerAcceptance' };
  await click('Confirm action');
  expect(changed).toHaveBeenCalledOnce();
  expect(container.textContent).not.toContain(en.publish);
});
it('submits drafts and hides mutations for historical and signed contracts', async () => {
  vi.stubGlobal(
    'fetch',
    api(detail({ state: 'Draft', currentVersionId: VERSION, currentVersion: version() }))
  );
  await render(<ContractDetail id={ID} staff onClose={() => {}} onChanged={() => {}} />);
  await click(en.submit);
  expect(harness.action?.body).toMatchObject({ expectedVersionId: VERSION });
  await click('Close confirmation');
  await click('Version 1');
  expect(container.textContent).not.toContain(en.submit);
  expect(container.textContent).not.toContain(en.uploadOriginal);
  await render(
    <ContractDetail key="signed" id={ID} staff onClose={() => {}} onChanged={() => {}} />
  );
  vi.stubGlobal(
    'fetch',
    api(
      detail({
        state: 'Signed',
        currentVersionId: VERSION,
        currentVersion: version({ acceptedAt: '2026-09-21T01:00:00Z' }),
      })
    )
  );
  await render(
    <ContractDetail key="locked" id={ID} staff onClose={() => {}} onChanged={() => {}} />
  );
  expect(container.textContent).toContain(en.acceptedAt);
  expect(container.textContent).not.toContain(en.uploadSigned);
});
it('derives signed upload context from the accepted customer contract', async () => {
  const fetcher = api(detail({ state: 'Accepted', canAccept: false }));
  vi.stubGlobal('fetch', fetcher);
  await render(<ContractDetail id={ID} staff={false} onClose={() => {}} onChanged={() => {}} />);
  await click(en.uploadSigned);
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', {
    value: [new File(['signed'], 'signed.pdf', { type: 'application/pdf' })],
  });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await click('Upload document');
  expect(harness.action?.body).toMatchObject({
    profileId: PROFILE,
    businessRecordType: 'contract',
    businessRecordId: ID,
    contractVersionId: VERSION,
    contractRole: 'signed',
    category: 'contract',
  });
  await click('Close confirmation');
  await click('Cancel');
  expect(container.querySelector('input[type=file]')).toBeNull();
});
it('handles missing detail and history pagination failure without using stale versions', async () => {
  let fail = true;
  let historyFail = true;
  const fetcher = vi.fn(async (raw: string) => {
    const url = new URL(raw, 'https://app.test');
    if (fail) return response({}, 404);
    if (url.pathname.endsWith('/versions')) {
      if (url.searchParams.has('before'))
        return historyFail
          ? response({}, 503)
          : response({ versions: [version({ id: OLD, versionNumber: 1 })], nextBefore: null });
      return response({ versions: [version()], nextBefore: 2 });
    }
    return api()(raw);
  });
  vi.stubGlobal('fetch', fetcher);
  await render(<ContractDetail id={ID} staff={false} onClose={() => {}} onChanged={() => {}} />);
  expect(container.querySelector('[role=alert]')).not.toBeNull();
  fail = false;
  await click(en.refresh);
  await click(en.next);
  expect(container.querySelector('[role=alert]')).not.toBeNull();
  historyFail = false;
  await click(en.next);
  expect(container.textContent).toContain('Version 1');
});
it('renders arbitrary stored values as escaped text with a bounded deep fallback', async () => {
  await render(
    <ContractTerms
      value={{
        title: 'Title',
        unknown: '<img src=x onerror=alert(1)>',
        empty: null,
        flags: [true, false],
        amount: '9007199254740993',
      }}
    />
  );
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain(en.yes);
  expect(container.textContent).toContain(en.no);
  expect(container.textContent).toContain(en.noValue);
  expect(container.textContent).toContain('9007199254740993');
  await render(<ContractTerms value={{ nested: { value: 'deep' } }} depth={20} />);
  expect(container.querySelector('pre')?.textContent).toContain('deep');
});
