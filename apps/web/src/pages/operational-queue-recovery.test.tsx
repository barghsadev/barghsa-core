import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Jobs from './AdminFailedJobsPage.js';
import DeadLetters from '../components/DeadLetterPanel.js';
import { failedJob, deadLetter } from '../test/operational-queue-fixtures.js';
vi.mock('../hooks/useTimezone.js', () => ({
  useTimezone: () => ({ status: 'ready', timezone: 'UTC', retry: () => {} }),
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
async function click(name: string, dialog = false) {
  const area = dialog ? document.querySelector('[role=dialog]')! : host;
  const button = [...area.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name
  );
  expect(button, name).toBeDefined();
  await act(async () => button!.click());
}
async function submit() {
  await act(async () =>
    document
      .querySelector('[role=dialog] form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
const confirmation = () =>
  document.querySelector<HTMLButtonElement>('[role=dialog] button[type=submit]')!;
const cases = [
  {
    name: 'jobs',
    endpoint: '/api/admin/failed-jobs',
    row: failedJob,
    page: <Jobs />,
    retry: 'Retry',
    marker: 'Storage cleanup',
  },
  {
    name: 'notifications',
    endpoint: '/api/admin/failed-notifications',
    row: deadLetter,
    page: <DeadLetters uiLocale="en" />,
    retry: 'Retry',
    marker: 'invoice.created',
  },
] as const;
for (const scenario of cases) {
  function reads(
    options: {
      access?: () => Response | Promise<Response>;
      list?: (url: URL) => Response | Promise<Response>;
      write?: () => Response | Promise<Response>;
      detail?: () => Response | Promise<Response>;
    } = {}
  ) {
    const requests = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === `${scenario.endpoint}/access`)
        return options.access?.() ?? response({ canView: true, canRetry: true });
      if (init?.method && init.method !== 'GET') return options.write?.() ?? response({});
      if (url.pathname === scenario.endpoint)
        return options.list?.(url) ?? response([scenario.row]);
      if (url.pathname === `${scenario.endpoint}/${scenario.row.id}`)
        return options.detail?.() ?? response(scenario.row);
      return response([]);
    });
    vi.stubGlobal('fetch', requests);
    return requests;
  }
  const render = async () => {
    await act(async () => root.render(scenario.page));
  };
  it(`${scenario.name}: uncertain saves require exact-record review and a fresh queue before another command`, async () => {
    let detailFails = true,
      queueFails = false,
      writes = 0;
    const requests = reads({
      detail: () => response(scenario.row, detailFails ? 503 : 200),
      list: () => response([scenario.row], queueFails ? 503 : 200),
      write: () => {
        writes++;
        return response({}, 503);
      },
    });
    await render();
    await click('Retry');
    await submit();
    expect(writes).toBe(1);
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('Review action outcome');
    expect(document.querySelector('[role=dialog] button[type=submit]')).toBeNull();
    expect(
      requests.mock.calls.filter(
        ([input]) => String(input) === `${scenario.endpoint}/${scenario.row.id}`
      )
    ).toHaveLength(1);
    detailFails = false;
    await click('Read selected records again', true);
    queueFails = true;
    await click('I reviewed the state; return to queue', true);
    await click('Retry');
    expect(writes).toBe(1);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    queueFails = false;
    await click('Refresh');
    await click('Retry');
    expect(document.querySelector('[role=dialog] form')).not.toBeNull();
    expect(writes).toBe(1);
  });
  it(`${scenario.name}: exact-record denial clears captured work and cached rows`, async () => {
    reads({ write: () => response({}, 503), detail: () => response({}, 403) });
    await render();
    await click('Retry');
    await submit();
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(host.querySelectorAll('tbody tr')).toHaveLength(0);
  });
  it(`${scenario.name}: independent read retry preserves review and pauses confirmation`, async () => {
    let fail = false,
      accessFail = false;
    const requests = reads({
      list: () => response([scenario.row], fail ? 503 : 200),
      access: () => response({ canView: true, canRetry: true }, accessFail ? 503 : 200),
    });
    await render();
    await click(scenario.retry);
    fail = true;
    await click('Retry queue', true);
    expect(host.textContent).toContain(scenario.marker);
    expect(confirmation().disabled).toBe(true);
    fail = false;
    await click('Retry queue', true);
    expect(confirmation().disabled).toBe(false);
    expect(requests.mock.calls.filter(([u]) => String(u).endsWith('/access'))).toHaveLength(1);
    const lists = requests.mock.calls.filter(
      ([u]) => new URL(String(u), 'http://localhost').pathname === scenario.endpoint
    ).length;
    accessFail = true;
    await click('Retry access', true);
    expect(confirmation().disabled).toBe(true);
    accessFail = false;
    await click('Retry access', true);
    expect(confirmation().disabled).toBe(false);
    expect(
      requests.mock.calls.filter(
        ([u]) => new URL(String(u), 'http://localhost').pathname === scenario.endpoint
      )
    ).toHaveLength(lists);
  });
  it(`${scenario.name}: failed navigation retains accepted page and repeats the failed query`, async () => {
    let fail = true;
    const rows = Array.from({ length: 26 }, (_, index) => ({
      ...scenario.row,
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    }));
    const requests = reads({
      list: (url) =>
        url.searchParams.get('offset') === '25'
          ? response(
              [{ ...scenario.row, id: '10000000-0000-4000-8000-000000000027' }],
              fail ? 503 : 200
            )
          : response(rows),
    });
    await render();
    await click('Next');
    expect(host.querySelectorAll('tbody tr')).toHaveLength(25);
    expect(host.querySelector('nav')!.textContent).toContain('1');
    const target = requests.mock.calls.at(-1)![0];
    fail = false;
    await click('Try again');
    expect(requests.mock.calls.filter(([u]) => String(u) === String(target))).toHaveLength(2);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(host.querySelector('nav')!.textContent).toContain('2');
  });
  it.each([401, 403])(
    `${scenario.name}: %i denial wins a racing queue response`,
    async (status) => {
      let resolve!: (response: Response) => void,
        pending = false,
        deny = false;
      reads({
        access: () => response({ canView: true, canRetry: true }, deny ? status : 200),
        list: () =>
          pending
            ? new Promise<Response>((r) => {
                resolve = r;
              })
            : response([scenario.row]),
      });
      await render();
      await click('Retry');
      pending = true;
      await click('Retry queue', true);
      deny = true;
      await click('Retry access', true);
      expect(document.querySelector('[role=dialog]')).toBeNull();
      expect(host.querySelectorAll('tbody tr')).toHaveLength(0);
      await act(async () => resolve(response([scenario.row])));
      expect(host.querySelectorAll('tbody tr')).toHaveLength(0);
    }
  );
  it(`${scenario.name}: changed criteria hide accepted rows and discard confirmation`, async () => {
    let pending = false;
    reads({ list: () => (pending ? new Promise<Response>(() => {}) : response([scenario.row])) });
    await render();
    await click('Retry');
    pending = true;
    if (scenario.name === 'jobs') await click('Dead letter');
    else
      await act(async () => {
        const select = host.querySelector<HTMLSelectElement>('select')!;
        select.value = 'resolved';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(host.querySelectorAll('tbody tr')).toHaveLength(0);
  });
  it(`${scenario.name}: fresh eligibility and withdrawn command permission remove stale review`, async () => {
    let changed = false,
      canRetry = true;
    reads({
      access: () => response({ canView: true, canRetry }),
      list: () => response([{ ...scenario.row, attempts: changed ? 4 : 5 }]),
    });
    await render();
    await click('Retry');
    await click('Retry queue', true);
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    changed = true;
    await click('Retry queue', true);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    await click('Retry');
    canRetry = false;
    await click('Retry access', true);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(host.querySelector('button[aria-label^="Retry "]')).toBeNull();
  });
  it(`${scenario.name}: malformed responses retain accepted rows without enabling commands`, async () => {
    let malformed = false;
    reads({ list: () => response(malformed ? [scenario.row, scenario.row] : [scenario.row]) });
    await render();
    await click('Retry');
    malformed = true;
    await click('Retry queue', true);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(confirmation().disabled).toBe(true);
  });
  it(`${scenario.name}: delayed password verification cannot submit while required reads are unavailable`, async () => {
    let resolve!: (value: Response) => void,
      fail = false;
    const requests = reads({
      list: () => response([scenario.row], fail ? 503 : 200),
      write: () => response({ requiresStepUp: true }, 403),
    });
    const fetcher = vi.mocked(fetch);
    fetcher.mockImplementation(async (input, init) => {
      if (String(input) === '/api/auth/step-up')
        return new Promise<Response>((r) => {
          resolve = r;
        });
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname.endsWith('/access')) return response({ canView: true, canRetry: true });
      if (init?.method === 'POST') return response({ requiresStepUp: true }, 403);
      return response([scenario.row], fail ? 503 : 200);
    });
    await render();
    await click('Retry');
    await submit();
    const password = document.querySelector<HTMLInputElement>('input[type=password]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        password,
        'test-password'
      );
      password.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await submit();
    fail = true;
    await click('Retry queue', true);
    await act(async () => resolve(response({ verified: true })));
    expect(
      requests.mock.calls.filter(
        ([, init]) => init?.method === 'POST' && String(init?.body).includes('password') === false
      )
    ).toHaveLength(1);
    expect(confirmation().disabled).toBe(true);
  });
  it(`${scenario.name}: denied writes clear private work`, async () => {
    reads({ write: () => response({}, 403) });
    await render();
    await click('Retry');
    await submit();
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(host.querySelectorAll('tbody tr')).toHaveLength(0);
  });
  it(`${scenario.name}: obsolete command completion cannot publish a success notice`, async () => {
    let resolve!: (response: Response) => void,
      deny = false;
    reads({
      access: () => response({ canView: true, canRetry: true }, deny ? 403 : 200),
      write: () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    });
    await render();
    await click('Retry');
    await submit();
    deny = true;
    await click('Retry access', true);
    await act(async () =>
      resolve(
        response({ ...scenario.row, status: scenario.name === 'jobs' ? 'retrying' : 'retried' })
      )
    );
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(host.querySelector('[role=status]')).toBeNull();
  });
}
it('bulk job selection survives read failure and accepts only a unique acknowledged subset', async () => {
  let fail = false,
    valid = false;
  const other = { ...failedJob, id: '10000000-0000-4000-8000-000000000002' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/access')
        ? response({ canView: true, canRetry: true })
        : new URL(String(input), 'http://localhost').pathname.startsWith(
              '/api/admin/failed-jobs/'
            ) && !init?.method
          ? response(String(input).endsWith(other.id) ? other : failedJob, fail ? 503 : 200)
          : init?.method === 'POST'
            ? response(
                valid
                  ? [{ ...failedJob, status: 'retrying' }]
                  : [
                      { ...failedJob, status: 'retrying' },
                      { ...failedJob, status: 'retrying' },
                    ]
              )
            : response([failedJob, other], fail ? 503 : 200)
    )
  );
  await act(async () => root.render(<Jobs />));
  await act(async () => {
    host.querySelectorAll<HTMLInputElement>('table input[type=checkbox]').forEach((n) => n.click());
  });
  await click('Retry selected (2)');
  fail = true;
  await click('Retry queue', true);
  expect(host.querySelectorAll('table input:checked')).toHaveLength(2);
  expect(host.querySelectorAll('ol input:checked')).toHaveLength(2);
  fail = false;
  await click('Retry queue', true);
  await submit();
  expect(document.querySelector('[role=dialog]')).not.toBeNull();
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('Review action outcome');
  expect(document.querySelector('[role=dialog] button[type=submit]')).toBeNull();
  await click('I reviewed the state; return to queue', true);
  await act(async () => {
    host.querySelectorAll<HTMLInputElement>('table input[type=checkbox]').forEach((n) => n.click());
  });
  valid = true;
  await click('Retry selected (2)');
  await submit();
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(host.textContent).toContain('1 selections were skipped');
});
it('malformed job authority never dispatches a queue read', async () => {
  const requests = vi.fn(async () => response({ canView: 'true', canRetry: true }));
  vi.stubGlobal('fetch', requests);
  await act(async () => root.render(<Jobs />));
  expect(requests).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role=alert]')).not.toBeNull();
});
it('delivery history remains mounted through queue recovery and is removed on parent denial', async () => {
  let fail = false,
    deny = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/access')
        ? response({ canView: true, canRetry: true }, deny ? 403 : 200)
        : String(input).includes('/delivery-logs?')
          ? response([])
          : response([deadLetter], fail ? 503 : 200)
    )
  );
  await act(async () => root.render(<DeadLetters uiLocale="en" />));
  await act(async () => {
    host.querySelector('details')!.open = true;
  });
  await click('Delivery attempt history');
  fail = true;
  await click('Refresh');
  expect(document.querySelector('[role=dialog]')).not.toBeNull();
  deny = true;
  await click('Refresh');
  expect(document.querySelector('[role=dialog]')).toBeNull();
});
