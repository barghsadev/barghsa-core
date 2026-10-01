import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import Users from './AdminStaffUsersPage.js';
import Teams from './AdminStaffTeamsPage.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import {
  staffAccess,
  staffUser,
  staffRoles,
  staffTeam,
  staffMember,
  staffTeamId,
  staffRoutingRules,
} from '../test/staff-directory-fixtures.js';
const captured = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as ((data: unknown) => Promise<void>) | null,
  close: null as (() => void) | null,
}));
vi.mock('../components/StaffPermissionHistory.js', () => ({ StaffPermissionHistory: () => null }));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onSuccess,
    onClose,
  }: {
    action: TeamAction;
    onSuccess: (data: unknown) => Promise<void>;
    onClose: () => void;
  }) => {
    captured.action = action;
    captured.success = onSuccess;
    captured.close = onClose;
    return <div role="dialog">{action.title}</div>;
  },
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers();
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function render(Page: typeof Users | typeof Teams) {
  await act(async () => root.render(<Page />));
  await tick();
}
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}
async function click(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
async function fill(selector: string, value: string) {
  const el = host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    selector
  )!;
  expect(el, selector).not.toBeNull();
  await act(async () => {
    const proto =
      el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function read(input: RequestInfo | URL): Response {
  const url = new URL(String(input), 'http://localhost');
  if (url.pathname.endsWith('/timezone')) return Response.json({ timezone: 'Asia/Tehran' });
  if (url.pathname.endsWith('/staff-access')) return Response.json(staffAccess);
  if (url.pathname.endsWith('/staff-role-options')) return Response.json(staffRoles);
  if (url.pathname === '/api/admin/staff') return Response.json({ items: [staffUser], total: 51 });
  if (url.pathname === '/api/admin/staff-teams') return Response.json([staffTeam]);
  if (url.pathname.endsWith('/assignment-rules')) return Response.json(staffRoutingRules);
  if (url.pathname.endsWith('/staff-teams/members'))
    return Response.json({ items: [staffMember], selected: [staffMember], hasMore: false });
  return Response.json({}, { status: 404 });
}
it('staff list retry retains creation input and exact offset without rereading access or roles', async () => {
  let fail = false;
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    fail && String(url).includes('offset=25') ? Response.json({}, { status: 503 }) : read(url)
  );
  vi.stubGlobal('fetch', fetcher);
  await render(Users);
  await click('Create staff user');
  await fill('#staff-firstName', 'Keep creation');
  const input = host.querySelector('#staff-firstName');
  fail = true;
  await click('Next');
  expect(host.querySelector('#staff-firstName')).toBe(input);
  await fill('#staff-lastName', 'During recovery');
  const failed = String(fetcher.mock.calls.at(-1)![0]);
  const reads = fetcher.mock.calls.filter(([url]) => !String(url).includes('/staff?')).length;
  fail = false;
  await click('Retry');
  expect(String(fetcher.mock.calls.at(-1)![0])).toBe(failed);
  expect(fetcher.mock.calls.filter(([url]) => !String(url).includes('/staff?'))).toHaveLength(
    reads
  );
  expect((input as HTMLInputElement).value).toBe('Keep creation');
  expect(host.querySelector<HTMLInputElement>('#staff-lastName')!.value).toBe('During recovery');
});
it('role options retry retains creation work and recovers independently from the staff list', async () => {
  let fail = false;
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    fail && String(url).endsWith('/staff-role-options')
      ? Response.json({}, { status: 503 })
      : read(url)
  );
  vi.stubGlobal('fetch', fetcher);
  await render(Users);
  await click('Create staff user');
  await fill('#staff-firstName', 'Retained first name');
  fail = true;
  await click('Refresh staff and access');
  const reads = fetcher.mock.calls.filter(
    ([url]) => !String(url).endsWith('/staff-role-options')
  ).length;
  expect(host.textContent).toContain('Staff roles could not be loaded');
  expect(host.querySelector<HTMLInputElement>('#staff-firstName')!.value).toBe(
    'Retained first name'
  );
  fail = false;
  await click('Retry staff roles');
  expect(
    fetcher.mock.calls.filter(([url]) => !String(url).endsWith('/staff-role-options'))
  ).toHaveLength(reads);
  expect(host.querySelector<HTMLInputElement>('#staff-firstName')!.value).toBe(
    'Retained first name'
  );
});
it('access recovery preserves a draft during failure then removes it when creation permission is revoked', async () => {
  let mode = 'ok';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith('/staff-access')
        ? mode === 'fail'
          ? Response.json({}, { status: 503 })
          : Response.json({ ...staffAccess, canCreate: mode !== 'revoked' })
        : read(url)
    )
  );
  await render(Users);
  await click('Create staff user');
  await fill('#staff-firstName', 'Private draft');
  mode = 'fail';
  await click('Refresh staff and access');
  expect(host.querySelector<HTMLInputElement>('#staff-firstName')!.value).toBe('Private draft');
  mode = 'revoked';
  await click('Retry staff access');
  expect(host.querySelector('#staff-firstName')).toBeNull();
  expect(host.textContent).toContain('staff@example.test');
});
it('a newer staff denial clears work and ignores a racing role-options response', async () => {
  let refresh = false;
  const pending = deferred();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL) =>
      refresh && String(url).endsWith('/staff-role-options')
        ? pending.promise
        : Promise.resolve(
            refresh && String(url).includes('/staff?')
              ? Response.json({}, { status: 403 })
              : read(url)
          )
    )
  );
  await render(Users);
  await click('Create staff user');
  await fill('#staff-firstName', 'Private');
  refresh = true;
  await click('Refresh staff and access');
  await act(async () => pending.resolve(Response.json(staffRoles)));
  expect(host.querySelector('#staff-firstName')).toBeNull();
  expect(host.textContent).not.toContain('staff@example.test');
  expect(host.textContent).not.toContain('Private');
});
it('a fresh staff state clears the role editor while ordinary retry preserves its explanation', async () => {
  let fail = false,
    changed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('/staff?')
        ? fail
          ? Response.json({}, { status: 503 })
          : Response.json({
              items: [{ ...staffUser, status: changed ? 'disabled' : 'active' }],
              total: 51,
            })
        : read(url)
    )
  );
  await render(Users);
  await click('Edit roles');
  await fill('#staff-role-reason', 'Review explanation');
  const input = host.querySelector('#staff-role-reason');
  fail = true;
  await click('Next');
  fail = false;
  await click('Retry');
  expect(host.querySelector('#staff-role-reason')).toBe(input);
  expect((input as HTMLInputElement).value).toBe('Review explanation');
  changed = true;
  await click('Refresh staff and access');
  expect(host.querySelector('#staff-role-reason')).toBeNull();
});
it('an obsolete staff completion cannot erase newly authorized creation work', async () => {
  let denied = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      denied && String(url).endsWith('/staff-access')
        ? Response.json({}, { status: 403 })
        : read(url)
    )
  );
  await render(Users);
  await click('Edit roles');
  await fill('#staff-role-reason', 'Initial role reason');
  await click('Save roles');
  const oldSuccess = captured.success!;
  // A reload models a later authorization check after the old dialog has been closed.
  await act(async () => root.render(null));
  denied = true;
  await render(Users);
  denied = false;
  await click('Refresh staff and access');
  await click('Create staff user');
  await fill('#staff-firstName', 'New authorized draft');
  await act(async () => oldSuccess({}));
  expect(host.querySelector<HTMLInputElement>('#staff-firstName')!.value).toBe(
    'New authorized draft'
  );
  expect(host.textContent).not.toContain('Changes saved');
});
it('team retry keeps the mounted editor and does not reread or overwrite dirty routing rules', async () => {
  let fail = false;
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    fail && String(url) === '/api/admin/staff-teams'
      ? Response.json({}, { status: 503 })
      : read(url)
  );
  vi.stubGlobal('fetch', fetcher);
  await render(Teams);
  await click('Edit team');
  await tick();
  await fill('#staff-team-description', 'Keep team notes');
  await fill('#team-ticket', staffTeamId);
  const input = host.querySelector('#staff-team-description');
  const rulesReads = fetcher.mock.calls.filter(([url]) =>
    String(url).includes('/assignment-rules')
  ).length;
  fail = true;
  await click('Refresh team list');
  expect(host.querySelector('#staff-team-description')).toBe(input);
  await fill('#staff-team-name', 'Editable during recovery');
  fail = false;
  await click('Try again');
  expect((input as HTMLTextAreaElement).value).toBe('Keep team notes');
  expect(host.querySelector<HTMLSelectElement>('#team-ticket')!.value).toBe(staffTeamId);
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).includes('/assignment-rules'))
  ).toHaveLength(rulesReads);
});
it('routing recovery keeps a dirty draft and never reloads the team directory', async () => {
  let fail = true;
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    fail && String(url).endsWith('/assignment-rules')
      ? Response.json({}, { status: 503 })
      : read(url)
  );
  vi.stubGlobal('fetch', fetcher);
  await render(Teams);
  await fill('#team-ticket', staffTeamId);
  const teamReads = fetcher.mock.calls.filter(
    ([url]) => String(url) === '/api/admin/staff-teams'
  ).length;
  fail = false;
  await click('Retry assignment rules');
  expect(host.querySelector<HTMLSelectElement>('#team-ticket')!.value).toBe(staffTeamId);
  expect(
    fetcher.mock.calls.filter(([url]) => String(url) === '/api/admin/staff-teams')
  ).toHaveLength(teamReads);
});
it('member search retry keeps the selected members, leader and exact search scope', async () => {
  let fail = false;
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    fail && String(url).includes('/staff-teams/members?')
      ? Response.json({}, { status: 503 })
      : read(url)
  );
  vi.stubGlobal('fetch', fetcher);
  await render(Teams);
  await click('Edit team');
  await tick();
  await fill('#staff-team-name', 'Retained team');
  fail = true;
  await fill('#staff-team-search', 'finance & review');
  await tick();
  const failed = String(fetcher.mock.calls.at(-1)![0]);
  expect(host.querySelector<HTMLInputElement>('#staff-team-name')!.value).toBe('Retained team');
  expect(host.querySelector<HTMLSelectElement>('#staff-team-lead')!.value).toBe(staffMember.id);
  fail = false;
  await click('Retry staff search');
  await tick();
  expect(String(fetcher.mock.calls.at(-1)![0])).toBe(failed);
  expect(captured.action).toBeNull();
  await click('Save team');
  expect((captured.action!.body as { memberUserIds: string[] }).memberUserIds).toEqual([
    staffMember.id,
  ]);
});
it('a newer member denial prevents an older team-list success from reviving private editors', async () => {
  const pending = deferred();
  let hold = false,
    denyMembers = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL) =>
      hold && String(url) === '/api/admin/staff-teams'
        ? pending.promise
        : Promise.resolve(
            denyMembers && String(url).includes('/staff-teams/members?')
              ? Response.json({}, { status: 403 })
              : read(url)
          )
    )
  );
  await render(Teams);
  await fill('#staff-team-name', 'Private team');
  hold = true;
  await click('Refresh team list');
  denyMembers = true;
  await fill('#staff-team-search', 'New scope');
  await tick();
  await act(async () => pending.resolve(Response.json([staffTeam])));
  expect(host.querySelector('#staff-team-name')).toBeNull();
  expect(host.textContent).not.toContain('Finance team');
  expect(host.textContent).not.toContain('Private team');
});
it('fresh member eligibility blocks team save while preserving the editable explanation', async () => {
  let inactive = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('/staff-teams/members?')
        ? Response.json({
            items: [{ ...staffMember, eligible: !inactive }],
            selected: [{ ...staffMember, eligible: !inactive }],
            hasMore: false,
          })
        : read(url)
    )
  );
  await render(Teams);
  await click('Edit team');
  await tick();
  await fill('#staff-team-description', 'Keep eligibility notes');
  inactive = true;
  await fill('#staff-team-search', 'Updated staff');
  await tick();
  await click('Save team');
  expect(captured.action).toBeNull();
  expect(host.querySelector<HTMLTextAreaElement>('#staff-team-description')!.value).toBe(
    'Keep eligibility notes'
  );
});
it('a successful team edit does not discard an unrelated unsaved routing draft', async () => {
  const fetcher = vi.fn(async (url: RequestInfo | URL) => read(url));
  vi.stubGlobal('fetch', fetcher);
  await render(Teams);
  await fill('#team-ticket', staffTeamId);
  await click('Edit team');
  await tick();
  await fill('#staff-team-name', 'Edited finance');
  await click('Save team');
  await act(async () => captured.success!({ ok: true }));
  expect(host.querySelector<HTMLSelectElement>('#team-ticket')!.value).toBe(staffTeamId);
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).endsWith('/assignment-rules'))
  ).toHaveLength(1);
});
it('withdrawing view access clears private role-edit work while authorized creation remains available', async () => {
  let canView = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith('/staff-access') ? Response.json({ ...staffAccess, canView }) : read(url)
    )
  );
  await render(Users);
  await click('Edit roles');
  await fill('#staff-role-reason', 'Private role reason');
  canView = false;
  await click('Refresh staff and access');
  expect(host.querySelector('#staff-role-reason')).toBeNull();
  expect(host.textContent).not.toContain('staff@example.test');
  await click('Create staff user');
  expect(host.querySelector('#staff-firstName')).not.toBeNull();
});
it('withdrawn roles can be removed without losing a staff explanation', async () => {
  let withdrawn = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith('/staff-role-options')
        ? Response.json(withdrawn ? [] : staffRoles)
        : read(url)
    )
  );
  await render(Users);
  await click('Edit roles');
  await fill('#staff-role-reason', 'Retain this explanation');
  withdrawn = true;
  await click('Refresh staff and access');
  const input = host.querySelector<HTMLInputElement>('label input[type="checkbox"]')!;
  expect(input).not.toBeNull();
  expect(host.textContent).toContain('Role no longer available');
  await act(async () => input.click());
  await click('Save roles');
  expect(captured.action?.body).toEqual({ roleIds: [], reason: 'Retain this explanation' });
});
it('routine login telemetry does not discard an unchanged role-review draft', async () => {
  let updated = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes('/staff?')
        ? Response.json({
            items: [{ ...staffUser, lastLoginAt: updated ? '2026-10-01T08:00:00Z' : null }],
            total: 51,
          })
        : read(url)
    )
  );
  await render(Users);
  await click('Edit roles');
  await fill('#staff-role-reason', 'Keep role review');
  const input = host.querySelector('#staff-role-reason');
  updated = true;
  await click('Refresh staff and access');
  expect(host.querySelector('#staff-role-reason')).toBe(input);
  expect((input as HTMLInputElement).value).toBe('Keep role review');
});
it('deleting a listed team preserves an unrelated new-team draft', async () => {
  let deleted = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      deleted && String(url) === '/api/admin/staff-teams' ? Response.json([]) : read(url)
    )
  );
  await render(Teams);
  await fill('#staff-team-name', 'Unrelated new team');
  await fill('#staff-team-description', 'Keep this unsaved description');
  await click('Delete team');
  deleted = true;
  await act(async () => captured.success!({ ok: true }));
  expect(host.querySelector<HTMLInputElement>('#staff-team-name')!.value).toBe(
    'Unrelated new team'
  );
  expect(host.querySelector<HTMLTextAreaElement>('#staff-team-description')!.value).toBe(
    'Keep this unsaved description'
  );
});
it('malformed staff creation confirmation retains input instead of claiming an account was created', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => read(url))
  );
  await render(Users);
  await click('Create staff user');
  await fill('#staff-username', 'new.staff@example.test');
  await fill('#staff-firstName', 'New');
  await fill('#staff-lastName', 'Staff');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('form button[type="submit"]')!.click()
  );
  expect(captured.action?.path).toBe('/api/admin/users/create-staff');
  await expect(captured.success!({})).rejects.toThrow('Unconfirmed staff creation');
  expect(host.querySelector<HTMLInputElement>('#staff-username')!.value).toBe(
    'new.staff@example.test'
  );
  expect(host.querySelector('#staff-created-password')).toBeNull();
});
it('an actor change removes the prior creator one-time password even when both actors can create staff', async () => {
  let actor = 'admin';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith('/staff-access')
        ? Response.json({ ...staffAccess, userId: actor })
        : read(url)
    )
  );
  await render(Users);
  await click('Create staff user');
  await fill('#staff-username', 'new.staff@example.test');
  await fill('#staff-firstName', 'New');
  await fill('#staff-lastName', 'Staff');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('form button[type="submit"]')!.click()
  );
  await act(async () => {
    await captured.success!({
      username: 'new.staff@example.test',
      temporaryPassword: 'One-time-only',
    });
    captured.close!();
  });
  expect(host.querySelector<HTMLInputElement>('#staff-created-password')!.value).toBe(
    'One-time-only'
  );
  actor = 'second-admin';
  await click('Refresh staff and access');
  expect(host.querySelector('#staff-created-password')).toBeNull();
  expect(host.textContent).not.toContain('new.staff@example.test');
});
