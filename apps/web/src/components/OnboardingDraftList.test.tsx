import { act, type PropsWithChildren } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OnboardingDraftList from './OnboardingDraftList.js';
import { parseOnboardingDraftPage } from '../lib/onboarding-draft-list.js';
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (v: string) => v, notice: null }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...props
  }: PropsWithChildren<{
    to: string;
    params: { profileId: string };
    search: { step: number };
  }>) => (
    <a {...props} href={to.replace('$profileId', params.profileId) + `?step=${search.step}`}>
      {children}
    </a>
  ),
}));
const id = (n: number) => `${n.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`;
const row = (n = 100) => ({
  id: id(n),
  profileType: 'INDIVIDUAL',
  name: 'Saved base profile',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  hasDraft: true,
  expired: false,
});
const page = (drafts: unknown[] = [row()], nextAfter: string | null = null) => ({
  drafts,
  nextAfter,
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const first = () =>
  page(
    Array.from({ length: 50 }, (_, n) => row(100 - n)),
    id(51)
  );
const ready = vi.fn();
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function mount(account = 'owner', locale: 'en' | 'fa' = 'en') {
  await act(async () =>
    root.render(<OnboardingDraftList key={account} locale={locale} onReady={ready} />)
  );
}
async function click(name: string) {
  await act(async () => {
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === name);
    expect(button).toBeDefined();
    button!.click();
  });
}
for (const locale of ['en', 'fa'] as const)
  it(`${locale}: links saved, expired and empty drafts to their original forms`, async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response(
          page([
            row(100),
            { ...row(99), profileType: 'LEGAL', expired: true },
            { ...row(98), hasDraft: false, updatedAt: null },
          ])
        )
      )
    );
    await mount('owner', locale);
    expect(ready).toHaveBeenLastCalledWith(true);
    const links = [...container.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `/onboarding/individual/${id(100)}?step=1`,
      `/onboarding/legal/${id(99)}?step=1`,
      `/onboarding/individual/${id(98)}?step=1`,
    ]);
    expect(links.map((a) => a.textContent)).toEqual(
      locale === 'fa'
        ? ['ادامه فرم', 'شروع دوباره فرم', 'تکمیل فرم']
        : ['Resume form', 'Restart form', 'Complete form']
    );
    expect(container.querySelector('section')?.dir).toBe(locale === 'fa' ? 'rtl' : 'ltr');
  });
for (const failure of [response({}, 503), response({ drafts: [row()], nextAfter: id(100) })])
  it('retains the first page and retries the same cursor after an unavailable or malformed page', async () => {
    const calls: string[] = [];
    let later = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return !url.includes('?')
          ? response(first())
          : later++ === 0
            ? failure
            : response(page([row(50)]));
      })
    );
    await mount();
    await click('More profiles');
    expect(container.querySelectorAll('li')).toHaveLength(50);
    expect(container.querySelector('[role=alert]')).not.toBeNull();
    await click('Retry');
    expect(container.querySelectorAll('li')).toHaveLength(51);
    expect(calls.slice(1)).toEqual([
      `/api/onboarding/drafts?after=${id(51)}`,
      `/api/onboarding/drafts?after=${id(51)}`,
    ]);
  });
for (const status of [401, 403])
  it(`clears previously displayed profile details on ${status}`, async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        response(url.includes('?') ? {} : first(), url.includes('?') ? status : 200)
      )
    );
    await mount();
    await click('More profiles');
    expect(container.querySelectorAll('li')).toHaveLength(0);
    expect(container.textContent).not.toContain('Saved base profile');
    expect(ready).toHaveBeenLastCalledWith(false);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
it('aborts old account reads and ignores late responses after remount', async () => {
  let resolve!: (r: Response) => void;
  let signal: AbortSignal | null | undefined;
  const pending = new Promise<Response>((r) => {
    resolve = r;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      if (!signal) {
        signal = init.signal;
        return pending;
      }
      return Promise.resolve(response(page([])));
    })
  );
  await mount('old');
  await mount('new');
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(response(page())));
  expect(container.childElementCount).toBe(0);
});
it('keeps initial errors recoverable without claiming the list loaded', async () => {
  let attempt = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => (attempt++ ? response(page([])) : response({}, 503)))
  );
  await mount();
  expect(ready).not.toHaveBeenCalled();
  await click('Retry');
  expect(ready).toHaveBeenLastCalledWith(true);
});
it('accepts empty final pages but rejects repeated identities, reversed order, invalid metadata and cursors', () => {
  expect(parseOnboardingDraftPage(page([]), id(1)).drafts).toEqual([]);
  for (const value of [
    null,
    {},
    page([row(100), row(100)]),
    page([row(99), row(100)]),
    page([{ ...row(), expired: 'true' }]),
    page([{ ...row(), hasDraft: false }]),
    page([{ ...row(), createdAt: 'wrong' }]),
    page([row()], id(100)),
    { drafts: [row()] },
  ])
    expect(() => parseOnboardingDraftPage(value, null)).toThrow();
  expect(() => parseOnboardingDraftPage(page([row(100)]), id(100))).toThrow();
  expect(parseOnboardingDraftPage(first(), null).nextAfter).toBe(id(51));
});
