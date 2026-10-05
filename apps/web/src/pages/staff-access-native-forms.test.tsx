import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { t } from '@barghsa/i18n/admin-ui';
import Users from './AdminStaffUsersPage.js';
import Roles from './AdminRolesPage.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import { staffAccess, staffUser, staffRoles } from '../test/staff-directory-fixtures.js';
const captured = vi.hoisted(() => ({
  actions: [] as TeamAction[],
  fields: null as ((fields: unknown[]) => boolean) | null,
  close: null as (() => void) | null,
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onValidationError,
    onClose,
  }: {
    action: TeamAction;
    onValidationError: (fields: unknown[]) => boolean;
    onClose: () => void;
  }) => {
    if (captured.actions.at(-1) !== action) captured.actions.push(action);
    captured.fields = onValidationError;
    captured.close = onClose;
    return <div role="dialog">{action.title}</div>;
  },
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  captured.actions = [];
  captured.fields = null;
  captured.close = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path.endsWith('/timezone')) return Response.json({ timezone: 'UTC' });
      if (path.endsWith('/staff-access')) return Response.json(staffAccess);
      if (path.endsWith('/staff-role-options')) return Response.json(staffRoles);
      if (path.endsWith('/staff')) return Response.json({ items: [staffUser], total: 1 });
      if (path.endsWith('/roles'))
        return Response.json(
          staffRoles.map((role) => ({ ...role, permissions: ['finance:view'], predefined: true }))
        );
      return Response.json({}, { status: 404 });
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.lang = 'en';
  vi.unstubAllGlobals();
});
async function mount(Page: typeof Users | typeof Roles) {
  await act(async () => root.render(<Page />));
}
async function settle() {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
async function click(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === text
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}
async function fill(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(times = 1) {
  const form = host.querySelector('form')!;
  await act(async () => {
    for (let i = 0; i < times; i++)
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}
for (const locale of ['en', 'fa'] as const) {
  const label = (key: string) => t(`admin.staff.${key}`, locale);
  it(`creation focuses invalid fields and keeps independent raw drafts (${locale})`, async () => {
    document.documentElement.lang = locale;
    await mount(Users);
    await click(label('create'));
    await fill('staff-lastName', '  Retained surname  ');
    await submit();
    const username = host.querySelector<HTMLInputElement>('#staff-username')!;
    expect(document.activeElement).toBe(username);
    expect(username.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(username.getAttribute('aria-describedby')!)?.textContent).toBe(
      label('invalidUsername')
    );
    expect(host.querySelector<HTMLInputElement>('#staff-lastName')!.value).toBe(
      '  Retained surname  '
    );
    expect(captured.actions).toHaveLength(0);
  });
  it(`creation captures one normalized proposal and maps only owned server errors (${locale})`, async () => {
    document.documentElement.lang = locale;
    await mount(Users);
    await click(label('create'));
    await fill('staff-username', '  Staff@Example.Test  ');
    await fill('staff-firstName', '  First  ');
    await fill('staff-lastName', '  Last  ');
    await submit(2);
    expect(captured.actions).toHaveLength(1);
    expect(captured.actions[0]!.body).toEqual({
      username: 'staff@example.test',
      firstName: 'First',
      lastName: 'Last',
      roleIds: [],
      activationMethod: 'link',
    });
    await act(async () => {
      expect(captured.fields!(['unknown'])).toBe(false);
      expect(captured.fields!(['firstName'])).toBe(true);
      captured.close!();
    });
    expect(host.querySelector<HTMLInputElement>('#staff-username')!.value).toBe(
      '  Staff@Example.Test  '
    );
    expect(host.querySelector<HTMLInputElement>('#staff-lastName')!.value).toBe('  Last  ');
    expect(host.querySelector('#staff-firstName')!.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('#staff-lastName')!.getAttribute('aria-invalid')).toBeNull();
  });
  it(`a phone activation link is rejected while temporary passwords remain available (${locale})`, async () => {
    document.documentElement.lang = locale;
    await mount(Users);
    await click(label('create'));
    await fill('staff-username', '+989121234567');
    await fill('staff-firstName', 'First');
    await fill('staff-lastName', 'Last');
    await submit();
    expect(captured.actions).toHaveLength(0);
    expect(host.textContent).toContain(label('invalidActivation'));
    await act(async () =>
      host.querySelector<HTMLInputElement>('input[value="tempPassword"]')!.click()
    );
    await submit();
    expect(captured.actions).toHaveLength(1);
    expect(captured.actions[0]!.body).toMatchObject({
      username: '+989121234567',
      activationMethod: 'tempPassword',
    });
  });
  it(`role reasons validate before OTP and remain raw through field rejection (${locale})`, async () => {
    document.documentElement.lang = locale;
    await mount(Users);
    await click(label('editRoles'));
    await submit();
    expect(captured.actions).toHaveLength(0);
    expect(document.activeElement).toBe(host.querySelector('#staff-role-reason'));
    await fill('staff-role-reason', '  Review this role  ');
    await submit(2);
    expect(captured.actions).toHaveLength(1);
    expect(captured.actions[0]!.requiresOtp).toBe(true);
    expect(captured.actions[0]!.body).toEqual({
      roleIds: ['role-finance'],
      reason: 'Review this role',
    });
    await act(async () => {
      expect(captured.fields!(['reason'])).toBe(true);
      captured.close!();
    });
    expect(host.querySelector<HTMLInputElement>('#staff-role-reason')!.value).toBe(
      '  Review this role  '
    );
    expect(host.querySelector('#staff-role-reason')!.getAttribute('aria-invalid')).toBe('true');
  });
  it(`effective permission lookup rejects blank IDs without a request (${locale})`, async () => {
    document.documentElement.lang = locale;
    await mount(Roles);
    await fill('staffUserId', '   ');
    await submit(2);
    const input = host.querySelector('#staffUserId')!;
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(host.textContent).toContain(t('admin.roles.effective.invalidUserId', locale));
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([input]) => String(input).includes('effective-permissions'))
    ).toHaveLength(0);
  });
}
