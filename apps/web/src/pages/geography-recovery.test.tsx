import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Geography from './AdminGeographyPage.js';
import { CitiesPanel } from './AdminCitiesPanel.js';
import {
  recoveryProvince as province,
  recoveryCity as city,
} from '../test/geography-recovery-fixtures.js';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function reads(
  options: {
    provinces?: (url: URL) => Response | Promise<Response>;
    cities?: (url: URL) => Response | Promise<Response>;
    write?: () => Response | Promise<Response>;
  } = {}
) {
  const requests = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    if (init?.method && init.method !== 'GET')
      return options.write?.() ?? response({ ...province, nameEn: 'Updated' });
    return url.pathname.endsWith('/cities')
      ? (options.cities?.(url) ?? response({ cities: [city], total: 1 }))
      : (options.provinces?.(url) ?? response({ provinces: [province], total: 1 }));
  });
  vi.stubGlobal('fetch', requests);
  return requests;
}
async function render() {
  await act(async () => root.render(<Geography />));
}
async function click(name: string, dialog = false) {
  const area = dialog ? document.querySelector('[role=dialog]')! : host;
  expect(area).not.toBeNull();
  const button = [...area.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name
  );
  expect(button, name).toBeDefined();
  await act(async () => button!.click());
}
async function fill(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(waitForWrite = false) {
  const writes = () =>
    vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
  const before = writes().length;
  await act(async () => {
    document
      .querySelector('[role=dialog] form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    if (waitForWrite) await vi.waitFor(() => expect(writes()).toHaveLength(before + 1));
  });
}
function submitButton() {
  return document.querySelector<HTMLButtonElement>('[role=dialog] button[type=submit]')!;
}
it('province recovery preserves the expanded city panel and independent reads', async () => {
  let fail = false;
  const requests = reads({
    provinces: () => response({ provinces: [province], total: 1 }, fail ? 503 : 200),
  });
  await render();
  await click('Cities');
  await click('Add Province');
  await fill('#province-name-en', 'Draft');
  fail = true;
  await click('Retry provinces', true);
  expect(document.querySelector<HTMLInputElement>('#province-name-en')!.value).toBe('Draft');
  expect(host.textContent).toContain('Rey');
  expect(submitButton().disabled).toBe(true);
  fail = false;
  await click('Retry provinces', true);
  expect(submitButton().disabled).toBe(false);
  expect(requests.mock.calls.filter(([u]) => String(u).includes('/cities?'))).toHaveLength(1);
});
it('failed province navigation retains the accepted page and retries the exact target', async () => {
  let fail = true;
  const requests = reads({
    provinces: (url) =>
      response(
        {
          provinces: [
            { ...province, nameEn: url.searchParams.get('page') === '2' ? 'Second' : 'Tehran' },
          ],
          total: 21,
        },
        url.searchParams.get('page') === '2' && fail ? 503 : 200
      ),
  });
  await render();
  await click('Next');
  expect(host.textContent).toContain('Tehran');
  expect(host.textContent).toContain('Showing 1–20');
  const failed = String(requests.mock.calls.at(-1)![0]);
  fail = false;
  await click('Retry');
  expect(String(requests.mock.calls.at(-1)![0])).toBe(failed);
  expect(host.textContent).toContain('Second');
  expect(host.textContent).toContain('Showing 21–21');
});
it('changed province criteria hide old rows and discard editor work', async () => {
  let hold = false,
    finish!: (r: Response) => void;
  reads({
    provinces: () =>
      hold
        ? new Promise<Response>((done) => {
            finish = done;
          })
        : response({ provinces: [province], total: 1 }),
  });
  await render();
  await click('Edit');
  await fill('#province-name-en', 'Private');
  hold = true;
  await act(async () => {
    const select = host.querySelector('select')!;
    select.value = 'inactive';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(host.textContent).not.toContain('Tehran');
  expect(document.querySelector('[role=dialog]')).toBeNull();
  await act(async () => finish(response({ provinces: [], total: 0 })));
  expect(host.textContent).toContain('No provinces found.');
});
it.each([401, 403])(
  'province %s clears all private work and defeats a late city read',
  async (status) => {
    let deny = false,
      finish!: (r: Response) => void;
    reads({
      provinces: () => response({ provinces: [province], total: 1 }, deny ? status : 200),
      cities: () =>
        new Promise<Response>((done) => {
          finish = done;
        }),
    });
    await render();
    await click('Cities');
    deny = true;
    await click('Refresh');
    await act(async () => finish(response({ cities: [city], total: 1 })));
    expect(host.querySelector('table')).toBeNull();
    expect(host.textContent).toContain('do not have permission');
    deny = false;
    await click('Refresh');
    expect(host.textContent).toContain('Tehran');
    expect(host.textContent).not.toContain('Rey');
  }
);
it('city denial clears the parent catalogue and wins a racing parent refresh', async () => {
  let hold = false,
    finish!: (r: Response) => void;
  reads({
    provinces: () =>
      hold
        ? new Promise<Response>((done) => {
            finish = done;
          })
        : response({ provinces: [province], total: 1 }),
    cities: () => response({}, 403),
  });
  await render();
  hold = true;
  await click('Refresh');
  await click('Cities');
  await act(async () => finish(response({ provinces: [province], total: 1 })));
  expect(host.querySelector('table')).toBeNull();
  expect(host.textContent).toContain('do not have permission');
});
it('city recovery retains import rows and does not reread provinces', async () => {
  let fail = false;
  const requests = reads({
    cities: () => response({ cities: [city], total: 1 }, fail ? 503 : 200),
  });
  await render();
  await click('Cities');
  await click('Import Cities');
  await fill('#city-import-rows', 'اسلامشهر\tEslamshahr');
  fail = true;
  await click('Retry cities', true);
  expect(document.querySelector<HTMLTextAreaElement>('#city-import-rows')!.value).toContain(
    'Eslamshahr'
  );
  expect(submitButton().disabled).toBe(true);
  await submit();
  expect(requests.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  fail = false;
  await click('Retry cities', true);
  expect(submitButton().disabled).toBe(false);
  expect(requests.mock.calls.filter(([u]) => !String(u).includes('/cities'))).toHaveLength(1);
});
it('fresh province changes invalidate open editing while ordinary key order preserves it', async () => {
  let changed = false;
  reads({
    provinces: () =>
      response({
        provinces: [
          {
            status: province.status,
            nameEn: changed ? 'Changed' : province.nameEn,
            nameFa: province.nameFa,
            id: province.id,
          },
        ],
        total: 1,
      }),
  });
  await render();
  await click('Edit');
  await fill('#province-name-en', 'Draft');
  await click('Retry provinces', true);
  expect(document.querySelector<HTMLInputElement>('#province-name-en')!.value).toBe('Draft');
  changed = true;
  await click('Retry provinces', true);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(host.textContent).toContain('Changed');
});
it('a changed city invalidates an in-flight edit and old completion cannot erase a new draft', async () => {
  let changed = false,
    finish!: (r: Response) => void;
  reads({
    cities: () =>
      response({ cities: [{ ...city, nameEn: changed ? 'Changed' : city.nameEn }], total: 1 }),
    write: () =>
      new Promise<Response>((done) => {
        finish = done;
      }),
  });
  await render();
  await click('Cities');
  const edit = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .filter((b) => b.textContent === 'Edit')
    .at(-1)!;
  await act(async () => edit.click());
  await fill('#province-name-en', 'Updated');
  await submit(true);
  changed = true;
  await click('Retry cities', true);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  await click('Add City');
  await fill('#province-name-en', 'New draft');
  await act(async () => finish(response({ ...city, nameEn: 'Updated' })));
  expect(document.querySelector<HTMLInputElement>('#province-name-en')!.value).toBe('New draft');
});
it('import command failure retains rows and denied write clears them', async () => {
  let deny = false;
  reads({ write: () => response({}, deny ? 403 : 409) });
  await render();
  await click('Cities');
  await click('Import Cities');
  await fill('#city-import-rows', 'اسلامشهر\tEslamshahr');
  await submit(true);
  expect(document.querySelector<HTMLTextAreaElement>('#city-import-rows')!.value).toContain(
    'Eslamshahr'
  );
  deny = true;
  await submit(true);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(host.querySelector('table')).toBeNull();
});
it('malformed city responses retain accepted rows and pause open editing', async () => {
  let malformed = false;
  reads({ cities: () => response({ cities: malformed ? [city, city] : [city], total: 1 }) });
  await render();
  await click('Cities');
  await click('Add City');
  await fill('#province-name-en', 'Draft');
  malformed = true;
  await click('Retry cities', true);
  expect(host.textContent).toContain('Rey');
  expect(document.querySelector<HTMLInputElement>('#province-name-en')!.value).toBe('Draft');
  expect(submitButton().disabled).toBe(true);
});
it('failed city navigation retains the accepted page and retries its exact offset', async () => {
  let fail = true;
  const requests = reads({
    cities: (url) =>
      response(
        {
          cities: [
            { ...city, nameEn: url.searchParams.get('page') === '2' ? 'Second city' : 'Rey' },
          ],
          total: 21,
        },
        url.searchParams.get('page') === '2' && fail ? 503 : 200
      ),
  });
  await render();
  await click('Cities');
  await click('Next');
  expect(host.textContent).toContain('Rey');
  const failed = String(requests.mock.calls.at(-1)![0]);
  fail = false;
  await click('Retry');
  expect(String(requests.mock.calls.at(-1)![0])).toBe(failed);
  expect(host.textContent).toContain('Second city');
});
it('changing the parent province removes a city import draft and scopes the next read', async () => {
  const requests = reads({ cities: () => response({ cities: [], total: 0 }) });
  await act(async () => root.render(<CitiesPanel province={province} />));
  await click('Import Cities');
  await fill('#city-import-rows', 'اسلامشهر\tEslamshahr');
  await act(async () =>
    root.render(<CitiesPanel province={{ ...province, id: 'p2', nameEn: 'Other' }} />)
  );
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(String(requests.mock.calls.at(-1)![0])).toContain('/p2/cities?');
});
