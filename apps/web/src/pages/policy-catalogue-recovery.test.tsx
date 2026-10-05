import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Roles from './AdminRolesPage.js';
import Uploads from './AdminUploadPoliciesPage.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import {
  catalogueRole,
  effectivePermissions,
  policyLimit,
  uploadPolicy,
} from '../test/policy-catalogue-fixtures.js';
const captured = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as (() => Promise<void>) | null,
  close: null as (() => void) | null,
  disabled: false,
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (v: string) => v }),
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onSuccess,
    onClose,
    confirmationDisabled,
  }: {
    action: TeamAction;
    onSuccess: () => Promise<void>;
    onClose: () => void;
    confirmationDisabled: boolean;
  }) => {
    captured.action = action;
    captured.success = onSuccess;
    captured.close = onClose;
    captured.disabled = confirmationDisabled;
    return <div data-testid="confirmation">{action.title}</div>;
  },
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  captured.action = null;
  captured.success = null;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const response = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status });
async function render(Page: typeof Roles | typeof Uploads) {
  await act(async () => root.render(<Page />));
}
async function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
  if (text === 'Save policy') await vi.waitFor(() => expect(captured.action).not.toBeNull());
}
async function fill(selector: string, value: string) {
  const node = document.querySelector<HTMLInputElement>(selector)!;
  expect(node).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(([url]) => String(url).includes('/effective-permissions'))
      ).toHaveLength(1)
    );
  });
}
function uploadsFetch(
  options: {
    access?: () => Response | Promise<Response>;
    list?: () => Response | Promise<Response>;
    limits?: () => Response | Promise<Response>;
  } = {}
) {
  const requests = vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith('/access')) return options.access?.() ?? response({ canEdit: true });
    if (path.endsWith('/limits')) return options.limits?.() ?? response([policyLimit]);
    if (path === '/api/admin/upload-policies') return options.list?.() ?? response([uploadPolicy]);
    return response({});
  });
  vi.stubGlobal('fetch', requests);
  return requests;
}
it('role catalogue recovery retains accepted roles, lookup identity and result without rereading the user', async () => {
  let fail = false;
  const requests = vi.fn(async (url: RequestInfo | URL) =>
    String(url).endsWith('/roles')
      ? response([catalogueRole], fail ? 503 : 200)
      : response(effectivePermissions)
  );
  vi.stubGlobal('fetch', requests);
  await render(Roles);
  await fill('#staffUserId', 'staff-one');
  await submit();
  fail = true;
  await click('Refresh');
  expect(host.textContent).toContain(catalogueRole.name);
  expect(host.textContent).toContain('staff-one');
  expect(host.querySelector<HTMLInputElement>('#staffUserId')!.value).toBe('staff-one');
  await fill('#staffUserId', 'staff-two');
  fail = false;
  await click('Retry');
  expect(host.querySelector<HTMLInputElement>('#staffUserId')!.value).toBe('staff-two');
  expect(
    requests.mock.calls.filter(([u]) => String(u).includes('/effective-permissions'))
  ).toHaveLength(1);
});
it('catalogue denial aborts an outstanding lookup and prevents its late result from reviving private data', async () => {
  let deny = false,
    finish!: (r: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith('/roles')
        ? response([catalogueRole], deny ? 403 : 200)
        : new Promise<Response>((done) => {
            finish = done;
          })
    )
  );
  await render(Roles);
  await fill('#staffUserId', 'staff-one');
  await submit();
  deny = true;
  await click('Refresh');
  await act(async () => finish(response(effectivePermissions)));
  expect(host.textContent).not.toContain(catalogueRole.name);
  expect(host.querySelector('#staffUserId')).toBeNull();
  expect(host.textContent).toContain('do not have permission');
  deny = false;
  await click('Refresh');
  expect(host.querySelector<HTMLInputElement>('#staffUserId')!.value).toBe('');
});
it('effective permission denial clears the role catalogue', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith('/roles') ? response([catalogueRole]) : response({}, 403)
    )
  );
  await render(Roles);
  await fill('#staffUserId', 'staff-one');
  await submit();
  expect(host.querySelector('table')).toBeNull();
  expect(host.textContent).toContain('do not have permission');
});
it('policy retry preserves the open editor and reads the same catalogue without redundant access reads', async () => {
  let fail = false;
  const requests = uploadsFetch({ list: () => response([uploadPolicy], fail ? 503 : 200) });
  await render(Uploads);
  await click('Edit');
  await fill('#upload-policy-size', '1.5');
  fail = true;
  await click('Refresh');
  expect(document.querySelector<HTMLInputElement>('#upload-policy-size')!.value).toBe('1.5');
  await fill('#upload-policy-size', '1');
  fail = false;
  await click('Try again');
  expect(document.querySelector<HTMLInputElement>('#upload-policy-size')!.value).toBe('1');
  expect(requests.mock.calls.filter(([u]) => String(u).endsWith('/access'))).toHaveLength(2);
  await click('Save policy');
  expect(captured.action?.body).toEqual({
    category: 'document',
    allowedExtensions: ['.pdf'],
    maxSizeBytes: 1048576,
  });
});
it('policy confirmation stays frozen and disabled during failed catalogue recovery', async () => {
  let fail = false;
  uploadsFetch({ list: () => response([uploadPolicy], fail ? 503 : 200) });
  await render(Uploads);
  await click('Edit');
  await fill('#upload-policy-size', '1');
  await click('Save policy');
  const body = captured.action?.body;
  fail = true;
  await click('Refresh');
  expect(captured.disabled).toBe(true);
  expect(captured.action?.body).toEqual(body);
  fail = false;
  await click('Try again');
  expect(captured.disabled).toBe(false);
  expect(captured.action?.body).toEqual(body);
  await act(async () => captured.close!());
  expect(document.querySelector<HTMLInputElement>('#upload-policy-size')!.value).toBe('1');
});
it.each(['policy', 'limit'])(
  'changed %s retains local entries until explicit reset',
  async (kind) => {
    let changed = false;
    uploadsFetch({
      list: () =>
        response([
          {
            ...uploadPolicy,
            maxSizeBytes: changed && kind === 'policy' ? 1048576 : uploadPolicy.maxSizeBytes,
          },
        ]),
      limits: () =>
        response([
          {
            ...policyLimit,
            maxSizeBytes: changed && kind === 'limit' ? 1048576 : policyLimit.maxSizeBytes,
          },
        ]),
    });
    await render(Uploads);
    await click('Edit');
    await fill('#upload-policy-size', '1.5');
    changed = true;
    await click('Refresh');
    expect(document.querySelector<HTMLInputElement>('#upload-policy-size')!.value).toBe('1.5');
    expect(document.querySelector<HTMLInputElement>('#upload-policy-size')!.disabled).toBe(true);
    expect(captured.action).toBeNull();
    await click('Reset to saved settings');
    expect(document.querySelector<HTMLInputElement>('#upload-policy-size')!.value).toBe('1');
  }
);
it('access failure preserves editing and can recover independently', async () => {
  let fail = false;
  const requests = uploadsFetch({ access: () => response({ canEdit: true }, fail ? 503 : 200) });
  await render(Uploads);
  await click('Edit');
  await fill('#upload-policy-size', '1');
  fail = true;
  await click('Refresh');
  expect(document.querySelector<HTMLInputElement>('#upload-policy-size')!.value).toBe('1');
  expect(document.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  const count = requests.mock.calls.filter(
    ([u]) => String(u) === '/api/admin/upload-policies'
  ).length;
  fail = false;
  await click('Retry access');
  expect(
    requests.mock.calls.filter(([u]) => String(u) === '/api/admin/upload-policies')
  ).toHaveLength(count + 1);
  expect(document.querySelector<HTMLInputElement>('#upload-policy-size')!.value).toBe('1');
});
it('read denial clears confirmation and prevents old command completion from reporting success', async () => {
  let deny = false;
  uploadsFetch({ limits: () => response([policyLimit], deny ? 403 : 200) });
  await render(Uploads);
  await click('End policy');
  const old = captured.success!;
  deny = true;
  await click('Refresh');
  await act(async () => old());
  expect(host.querySelector('table')).toBeNull();
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  expect(host.textContent).not.toContain('Policy changes saved.');
});
it('denial in one concurrent resource prevents a late other resource from restoring the editor', async () => {
  let hold = false,
    finish!: (r: Response) => void;
  uploadsFetch({
    list: () =>
      hold
        ? new Promise<Response>((done) => {
            finish = done;
          })
        : response([uploadPolicy]),
    limits: () => response([policyLimit], hold ? 403 : 200),
  });
  await render(Uploads);
  await click('Edit');
  hold = true;
  await click('Refresh');
  await act(async () => finish(response([uploadPolicy])));
  expect(host.querySelector('table')).toBeNull();
  expect(document.querySelector('#upload-policy-size')).toBeNull();
  expect(host.textContent).toContain('do not have permission');
});
it('malformed authority response retains accepted rows and prevents editing', async () => {
  let malformed = false;
  uploadsFetch({
    limits: () => response(malformed ? [{ ...policyLimit, maxSizeBytes: 'large' }] : [policyLimit]),
  });
  await render(Uploads);
  malformed = true;
  await click('Refresh');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(
    [...host.querySelectorAll<HTMLButtonElement>('tbody button')].every((b) => b.disabled)
  ).toBe(true);
  expect(host.textContent).toContain('Could not load upload policies');
});
it('cancelled confirmation cannot clear the restored editor through a late completion', async () => {
  uploadsFetch();
  await render(Uploads);
  await click('Edit');
  await fill('#upload-policy-size', '1');
  await click('Save policy');
  const old = captured.success!;
  await act(async () => captured.close!());
  await fill('#upload-policy-size', '1.5');
  await act(async () => old());
  expect(document.querySelector<HTMLInputElement>('#upload-policy-size')!.value).toBe('1.5');
  expect(host.textContent).not.toContain('Policy changes saved.');
});
it('empty role catalogue still shows an independent permission lookup', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith('/roles') ? response([]) : response(effectivePermissions)
    )
  );
  await render(Roles);
  expect(host.textContent).toContain('No roles yet.');
  await fill('#staffUserId', 'staff-one');
  await submit();
  expect(host.textContent).toContain('staff-one');
});
it('empty deployment category catalogue shows an explicit empty state', async () => {
  uploadsFetch({ limits: () => response([]) });
  await render(Uploads);
  expect(host.textContent).toContain('No upload categories available.');
  expect(host.querySelector('table')).toBeNull();
});
it('a changed active policy removes an obsolete end confirmation and invalidates its completion', async () => {
  let changed = false;
  uploadsFetch({
    list: () => response([{ ...uploadPolicy, id: changed ? 'other-policy' : uploadPolicy.id }]),
  });
  await render(Uploads);
  await click('End policy');
  const old = captured.success!;
  changed = true;
  await click('Refresh');
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  await act(async () => old());
  expect(host.textContent).not.toContain('Policy changes saved.');
});
