import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { StaffEffectivePermissions } from './StaffEffectivePermissions.js';
import Roles from '../pages/AdminRolesPage.js';
import Staff from '../pages/AdminStaffUsersPage.js';
import { catalogueRole, effectivePermissions } from '../test/policy-catalogue-fixtures.js';
import { staffAccess, staffRoles, staffUser } from '../test/staff-directory-fixtures.js';
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (value: string) => value }),
}));
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
});
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const target = { userId: 'staff-one', username: 'staff@example.test', name: 'Finance Alice' };
const denied = vi.fn();
async function inspect(overrides: Partial<Parameters<typeof StaffEffectivePermissions>[0]> = {}) {
  await act(async () =>
    root.render(
      <StaffEffectivePermissions
        target={target}
        paused={false}
        onClose={() => {}}
        onDenied={denied}
        finalFocus={false}
        {...overrides}
      />
    )
  );
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
it('reads the selected account directly, and preserves its last result on failed or foreign refresh', async () => {
  let mode = 'valid';
  const fetcher = vi.fn(async () =>
    mode === 'failed'
      ? response({}, 503)
      : mode === 'missing'
        ? response({}, 404)
        : response({
            ...effectivePermissions,
            userId: mode === 'foreign' ? 'foreign' : target.userId,
          })
  );
  vi.stubGlobal('fetch', fetcher);
  await inspect();
  expect(fetcher.mock.calls).toHaveLength(1);
  expect(document.body.textContent).toContain('Finance Alice');
  expect(document.body.textContent).toContain('finance:read');
  mode = 'failed';
  await click('Refresh');
  expect(document.body.textContent).toContain('last result is retained');
  expect(document.body.textContent).toContain('finance:read');
  mode = 'foreign';
  await click('Retry');
  expect(document.body.textContent).not.toContain('foreign');
  expect(document.body.textContent).toContain('finance:read');
  mode = 'missing';
  await click('Retry');
  expect(document.querySelector('[data-testid=effective-permissions]')).toBeNull();
  expect(document.body.textContent).toContain('User not found');
});
it.each([401, 403] as const)(
  'clears accepted permissions on %s and delegates authority recovery',
  async (status) => {
    denied.mockClear();
    let forbidden = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(effectivePermissions, forbidden ? status : 200))
    );
    await inspect();
    forbidden = true;
    await click('Refresh');
    expect(denied).toHaveBeenCalledWith(status);
    expect(document.querySelector('[data-testid=effective-permissions]')).toBeNull();
  }
);
it('withdraws a paused request and rechecks authority before accepting a resumed result', async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        })
    )
    .mockResolvedValue(response(effectivePermissions));
  vi.stubGlobal('fetch', fetcher);
  await inspect();
  await inspect({ paused: true });
  await act(async () => resolve(response(effectivePermissions)));
  expect(document.querySelector('[data-testid=effective-permissions]')).toBeNull();
  await inspect({ paused: false });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain('finance:read');
});
it('does not display another target or accept a cancelled response', async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(response(effectivePermissions))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          })
      )
  );
  await inspect();
  await inspect({ target: { ...target, userId: 'staff-two', name: 'Other staff' } });
  expect(document.body.textContent).not.toContain('finance:read');
  await act(async () => root.render(<div>Closed</div>));
  await act(async () => resolve(response({ ...effectivePermissions, userId: 'staff-two' })));
  expect(document.body.textContent).not.toContain('finance:read');
});
it('compares granted and ungranted module permissions across roles without enabling edits', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      response([
        catalogueRole,
        { ...catalogueRole, roleId: 'second', name: 'Payments', permissions: ['finance:write'] },
        { ...catalogueRole, roleId: 'all', name: 'All access', permissions: ['*'] },
      ])
    )
  );
  await act(async () => root.render(<Roles />));
  const select = document.querySelector<HTMLSelectElement>('#role-module')!;
  await act(async () => {
    select.value = 'finance';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const rows = [...host.querySelectorAll('tbody tr')];
  const boxes = (row: Element) =>
    [...row.querySelectorAll<HTMLInputElement>('input')].map((input) => input.checked);
  expect(rows.map(boxes)).toEqual([
    [true, false],
    [false, true],
    [true, true],
  ]);
  expect(
    [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].every(
      (input) => input.disabled
    )
  ).toBe(true);
});
it.each([true, false])(
  'offers per-user inspection only to staff role administrators: %s',
  async (canEditRoles) => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.endsWith('staff-access')) return response({ ...staffAccess, canEditRoles });
      if (path.endsWith('staff-role-options')) return response(staffRoles);
      if (path.includes('/staff?')) return response({ items: [staffUser], total: 1 });
      if (path.endsWith('/effective-permissions'))
        return response({ ...effectivePermissions, userId: staffUser.userId });
      return response({});
    });
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(<Staff />));
    const button = [...host.querySelectorAll('button')].find(
      (item) => item.textContent === 'View effective permissions'
    );
    expect(!!button).toBe(canEditRoles);
    if (canEditRoles) {
      await act(async () => button!.click());
      expect(document.body.textContent).toContain('finance:read');
      expect(
        fetcher.mock.calls.some(
          ([url]) => String(url) === `/api/admin/users/${staffUser.userId}/effective-permissions`
        )
      ).toBe(true);
    }
  }
);
