import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { standardMaintenanceNotice } from '@barghsa/i18n/maintenance-public';
import { tMaintenance } from '@barghsa/i18n/maintenance';
import type { TeamActionDialog } from '../components/TeamActionDialog.js';
import type { MaintenanceSetting } from '../lib/maintenance-form.js';
import { QueryComponentProvider } from '../test/query-provider.js';
import Page from './AdminMaintenancePage.js';

const admin = vi.hoisted(() => ({
  timezone: 'Asia/Tehran',
  timeStatus: 'ready',
  locale: 'en' as 'en' | 'fa',
  command: null as ComponentProps<typeof TeamActionDialog> | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => admin.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({
    timezone: admin.timezone,
    status: admin.timeStatus,
    notice: null,
    format: (value: string | null) => value,
  }),
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: ComponentProps<typeof TeamActionDialog>) => {
    admin.command = props;
    return <div role="dialog">{props.summary}</div>;
  },
}));

const capabilities = [
  'electricity_checkout',
  'saving_orders',
  'solar_requests',
  'wallet_topup',
  'ai_chat',
] as const;
const capability = capabilities[0];
const path = '/api/admin/maintenance';
const deadline = '2099-12-17T12:30:00.000Z';
const changedOn = '2026-11-08T12:30:00.000Z';
const reasons = { en: 'Check the settlement rules', fa: 'بررسی قوانین تسویه' };
const owner = 'Grid operations';
const copy = (key: string) => tMaintenance(key, admin.locale);
const active = {
  capability,
  active: true,
  version: 3,
  reason: reasons,
  estimatedUntil: deadline,
  owner,
  updatedAt: changedOn,
} satisfies MaintenanceSetting;
const available = {
  capability,
  active: false,
  version: 4,
  reason: null,
  estimatedUntil: null,
  owner: null,
  updatedAt: changedOn,
} satisfies MaintenanceSetting;
const sourceId = '11111111-1111-4111-8111-111111111111';
const draft = {
  id: '22222222-2222-4222-8222-222222222222',
  baseVersion: 3,
  sourceId,
  setting: { ...available, version: 2 },
};

let root: Root, host: HTMLDivElement;
let saved: MaintenanceSetting, status: number, history: unknown;
let read: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;
beforeEach(() => {
  admin.timezone = 'Asia/Tehran';
  admin.timeStatus = 'ready';
  admin.locale = 'en';
  admin.command = null;
  saved = active;
  status = 200;
  history = { baseVersion: 3, items: [], nextBeforeVersion: null, draft };
  read = vi.fn(async (url: string) => {
    if (url === path + '/' + capability + '/history') return Response.json(history);
    if (url !== path) throw new Error('Unexpected read: ' + url);
    return Response.json(
      capabilities.map((key) =>
        key === capability
          ? saved
          : {
              ...available,
              capability: key,
              version: 0,
              updatedAt: null,
            }
      ),
      { status }
    );
  });
  vi.stubGlobal('fetch', read);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function button(key: string) {
  const node = [...host.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === copy(key)
  );
  expect(node, copy(key)).toBeDefined();
  return node!;
}
const click = (key: string) => act(async () => button(key).click());
const field = (name: string) =>
  host.querySelector<HTMLInputElement | HTMLTextAreaElement>('[name="' + name + '"]')!;
async function fill(name: string, value: string) {
  const node = field(name);
  expect(node).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const toggle = (name: string) => act(async () => field(name).click());
const submit = () =>
  act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
const mount = () =>
  act(async () =>
    root.render(
      <QueryComponentProvider>
        <Page />
      </QueryComponentProvider>
    )
  );
const visible = (key: string) => vi.waitFor(() => expect(host.textContent).toContain(copy(key)));
const manage = async () => {
  await visible('manage');
  await click('manage');
  expect(host.querySelector('form')).not.toBeNull();
};
const command = async () => {
  await vi.waitFor(() => expect(host.querySelector('[role=dialog]')).not.toBeNull());
  return admin.command!;
};
async function rejectReceipt(value: unknown) {
  await act(async () => {
    await expect(admin.command!.onSuccess!(value)).rejects.toThrow(
      'Unconfirmed maintenance receipt'
    );
  });
}

it('keeps the staff rationale private and only accepts the standard notice for the exact capability and version', async () => {
  admin.locale = 'fa';
  await mount();
  await manage();
  expect(host.querySelector('section')?.dir).toBe('rtl');
  expect(host.textContent).toContain(reasons.fa);
  expect(host.querySelector('time')?.dateTime).toBe(deadline);
  await toggle('publishReason');
  await submit();
  const review = await command();
  expect(review.action).toMatchObject({
    method: 'PUT',
    path: path + '/' + capability,
    risk: 'destructive',
    body: {
      active: true,
      reason: reasons,
      owner,
      estimatedUntil: deadline,
      expectedVersion: 3,
      publishReason: false,
    },
  });
  expect(host.querySelector('[role=dialog]')?.textContent).toContain(copy('standardNotice'));
  expect(host.querySelector('[role=dialog]')?.textContent).toContain(copy('privateReasonEn'));
  expect(host.querySelector('fieldset')?.disabled).toBe(true);
  await rejectReceipt({ ...active, version: 4 });
  const receipt = { ...active, version: 4, reason: standardMaintenanceNotice };
  await rejectReceipt({ ...receipt, capability: 'saving_orders' });
  await rejectReceipt({ ...receipt, estimatedUntil: '2099-12-18T12:30:00.000Z' });
  await act(async () => {
    saved = receipt;
    await review.onSuccess!(saved);
  });
  await visible('saved');
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).not.toContain(reasons.fa);
  expect(read.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it('maps server validation only to owned fields and focuses the first invalid input', async () => {
  await mount();
  await manage();
  await submit();
  const review = await command();
  expect(review.action?.body).toMatchObject({ active: true, reason: reasons, expectedVersion: 3 });
  expect(host.querySelector('[role=dialog]')?.textContent).toContain(copy('customNotice'));
  await act(async () => {
    expect(review.onValidationError!(['unknown', 1, '__proto__'])).toBe(false);
    expect(
      review.onValidationError!(['unknown', 'owner', 'estimatedUntil', 'reasonEn', 'active'])
    ).toBe(true);
    review.onClose();
  });
  await vi.waitFor(() => expect(document.activeElement).toBe(field('owner')));
  for (const key of ['invalidOwner', 'invalidDeadline', 'invalidReason', 'invalidField'])
    await visible(key);
});

it('holds a pending edit after an unconfirmed save until authoritative status is read and reviewed', async () => {
  await mount();
  await manage();
  await fill('reasonEn', 'Draft retained for reconciliation');
  await toggle('active');
  await submit();
  const review = await command();
  expect(review.action).not.toHaveProperty('risk');
  expect(review.action?.body).toEqual({
    active: false,
    reason: null,
    owner: null,
    estimatedUntil: null,
    expectedVersion: 3,
  });
  status = 503;
  await act(async () => review.onUnconfirmed!());
  await visible('loadError');
  await visible('unconfirmed');
  expect(button('returnToEditing').disabled).toBe(true);
  expect(button('save').matches(':disabled')).toBe(true);
  status = 200;
  saved = available;
  await click('refresh');
  await vi.waitFor(() => expect(button('returnToEditing').disabled).toBe(false));
  await click('returnToEditing');
  expect(host.textContent).not.toContain(copy('unconfirmed'));
  expect(field('active').matches(':checked')).toBe(false);
  await toggle('active');
  expect(field('reasonEn').value).toBe('Draft retained for reconciliation');
  await toggle('active');
  admin.command = null;
  await submit();
  const retry = await command();
  expect(retry.action?.body).toMatchObject({ expectedVersion: 4 });
  await act(async () => {
    saved = { ...available, version: 5 };
    await retry.onSuccess!(saved);
  });
  await visible('saved');
});

it('blocks a stale draft after a version or account time zone change and resets explicitly', async () => {
  await mount();
  await manage();
  await fill('owner', 'Owner from stale draft');
  saved = { ...active, version: 4, owner: 'New shift' };
  await click('refresh');
  await visible('versionConflict');
  expect(button('save').matches(':disabled')).toBe(true);
  await submit();
  expect(admin.command).toBeNull();
  await click('reset');
  expect(field('owner').value).toBe('New shift');
  admin.timezone = 'UTC';
  await mount();
  await visible('zoneChanged');
  expect(button('save').matches(':disabled')).toBe(true);
  await click('reset');
  expect(host.textContent).toContain('UTC');
  expect(host.querySelector<HTMLInputElement>('#maintenance-time')?.value).toBe('12:30');
});

it('converts an edited deadline in the account zone and clears it on command denial', async () => {
  await mount();
  await manage();
  const time = host.querySelector<HTMLInputElement>('#maintenance-time')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(time, '17:15');
    time.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await submit();
  const review = await command();
  expect(review.action?.body).toMatchObject({ estimatedUntil: '2099-12-17T13:45:00.000Z' });
  await act(async () => review.onDenied!());
  await visible('denied');
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).not.toContain(owner);
  expect(host.textContent).not.toContain(reasons.en);
});

it('clears an existing staff draft on read denial without exposing stale maintenance details', async () => {
  await mount();
  await manage();
  await fill('owner', 'Private shift handoff');
  status = 403;
  await click('refresh');
  await visible('denied');
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).not.toContain(owner);
  expect(host.querySelectorAll('h2')).toHaveLength(0);
});

it('loads a persisted service-specific recovery draft and activates it against the live version', async () => {
  await mount();
  await manage();
  await click('history');
  const loadLabel = copy('resumeRecovery').replace('{version}', '2');
  const buttonForDraft = () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === loadLabel);
  await vi.waitFor(() => expect(buttonForDraft()).toBeDefined());
  await act(async () => buttonForDraft()!.click());
  await visible('recoveryEditing');
  expect(host.querySelector('[aria-label="' + copy('history') + '"]')).toBeNull();
  expect(field('active').matches(':checked')).toBe(false);
  await submit();
  const review = await command();
  expect(review.action?.title).toBe(copy('activateRecovery'));
  expect(review.action?.body).toEqual({
    active: false,
    reason: null,
    owner: null,
    estimatedUntil: null,
    expectedVersion: 3,
    rollbackDraftId: draft.id,
  });
  await act(async () => {
    saved = available;
    await review.onSuccess!(saved);
  });
  await visible('saved');
  expect(host.querySelector('form')).toBeNull();
});

it('keeps an expired return deadline in the editor and requires a future date before step-up', async () => {
  saved = { ...active, estimatedUntil: '2001-12-17T12:30:00.000Z' };
  await mount();
  await manage();
  await submit();
  await visible('invalidDeadline');
  expect(admin.command).toBeNull();
  expect(field('owner').value).toBe(owner);
});
