import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { securityRateLimitPolicies, securityRateLimitPolicyKeys } from '@barghsa/shared/rate-limit';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import SecurityRateLimitPanel from './SecurityRateLimitPanel.js';
import type { TeamActionDialog } from './TeamActionDialog.js';
import { QueryComponentProvider } from '../test/query-provider.js';

const controls = vi.hoisted(() => ({
  command: null as ComponentProps<typeof TeamActionDialog> | null,
  locale: 'en' as 'en' | 'fa',
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => controls.locale }));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: (props: ComponentProps<typeof TeamActionDialog>) => {
    controls.command = props;
    return <div role="dialog">{props.summary}</div>;
  },
}));

const base = '/api/admin/config/security-rate-limits';
const policy = 'otpDestinationHour';
const prior = { id: '11111111-1111-4111-8111-111111111111', limit: 4, version: 2 };
const draft = {
  id: '22222222-2222-4222-8222-222222222222',
  baseVersion: 3,
  limit: prior.limit,
  sourceId: prior.id,
  sourceVersion: prior.version,
};
const emergency = {
  limit: 1,
  owner: 'incident-operator',
  reason: 'Temporary delivery incident',
  active: false,
  expiresAt: '2020-01-02T12:00:00.000Z',
};
function snapshot(key: (typeof securityRateLimitPolicyKeys)[number]) {
  const { ceiling, windowMs } = securityRateLimitPolicies[key];
  return { policy: key, ceiling, windowMs, limit: ceiling, version: 0, emergency: null };
}
const current = { ...snapshot(policy), version: 3, limit: 3, emergency };
const text = (key: Parameters<typeof verificationConfigText>[0]) =>
  verificationConfigText(key, controls.locale);

let root: Root, host: HTMLDivElement;
let saved: Omit<typeof current, 'emergency'> & { emergency: typeof emergency | null };
let history: () => unknown, older: () => unknown, configuration: () => unknown;
let readStatus: number;
let read: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;

beforeEach(() => {
  controls.command = null;
  controls.locale = 'en';
  saved = current;
  readStatus = 200;
  configuration = () => ({
    policies: securityRateLimitPolicyKeys.map((key) => (key === policy ? saved : snapshot(key))),
  });
  history = () => ({
    policy,
    baseVersion: saved.version,
    items: [prior],
    nextBeforeVersion: 2,
    draft: null,
  });
  older = () => ({
    policy,
    baseVersion: saved.version,
    items: [],
    nextBeforeVersion: null,
    draft: null,
  });
  read = vi.fn(async (url: string) => {
    if (url === base) return Response.json(configuration(), { status: readStatus });
    if (!url.startsWith(base + '/rollback-history?')) throw new Error('Unexpected read: ' + url);
    return Response.json(url.includes('beforeVersion=2') ? older() : history());
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

async function mount(onReadDenied = vi.fn()) {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <SecurityRateLimitPanel onReadDenied={onReadDenied} />
      </QueryComponentProvider>
    )
  );
  return onReadDenied;
}
function button(key: Parameters<typeof text>[0], area: ParentNode = host) {
  const target = [...area.querySelectorAll('button')].find(
    (node) => node.textContent === text(key)
  );
  expect(target, text(key)).toBeDefined();
  return target!;
}
const click = (key: Parameters<typeof text>[0], area?: ParentNode) =>
  act(async () => button(key, area).click());
async function field(name: string, value: string) {
  const node = host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    '#security-rate-' + name
  )!;
  const prototype = Object.getPrototypeOf(node);
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
const submit = () =>
  act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
const visible = (value: string) => vi.waitFor(() => expect(host.textContent).toContain(value));
const ready = () => vi.waitFor(() => expect(host.querySelector('fieldset')?.disabled).toBe(false));
const recovery = async () => {
  await click('rateRecoveryHistory');
  await vi.waitFor(() =>
    expect(
      host.querySelector('section[aria-label="' + text('rateRecoveryHistory') + '"]')
    ).not.toBeNull()
  );
  return host.querySelector<HTMLElement>(
    'section[aria-label="' + text('rateRecoveryHistory') + '"]'
  )!;
};
async function settleError(value: unknown, message: string) {
  await act(async () => {
    await expect(controls.command!.onSuccess!(value)).rejects.toThrow(message);
  });
}

it('rejects a limit past the built-in ceiling and keeps the existing emergency rule for a regular update', async () => {
  await mount();
  await ready();
  await visible(text('rateLimitExpired'));
  expect(button('rateLimitSave').disabled).toBe(true);
  await field('value', '6');
  await submit();
  await visible(text('invalid'));
  expect(controls.command).toBeNull();
  await field('value', '4');
  await submit();
  expect(controls.command?.action).toMatchObject({
    method: 'PUT',
    path: base,
    requiresPassword: true,
    body: { policy, expectedVersion: 3, limit: 4, emergency: { operation: 'keep' } },
  });
  expect(host.querySelector('fieldset')?.disabled).toBe(true);
  const next = { ...saved, version: 4, limit: 4 };
  for (const incorrect of [
    null,
    { ...next, ...snapshot('login') },
    { ...next, limit: 3 },
    { ...next, version: 7 },
    { ...next, emergency: null },
    { ...next, emergency: { ...emergency, reason: 'Different operator reason' } },
    { ...next, emergency: { ...emergency, owner: 'different-operator' } },
    { ...next, emergency: { ...emergency, expiresAt: '2020-01-03T12:00:00.000Z' } },
  ])
    await settleError(incorrect, 'Unconfirmed rate-limit configuration');
  await act(async () => {
    saved = next;
    await controls.command!.onSuccess!(saved);
  });
  await visible(text('rateLimitSaved'));
  expect(host.querySelector<HTMLInputElement>('#security-rate-value')?.value).toBe('4');
  expect(host.querySelector('[role=dialog]')).toBeNull();
});

it('reviews a clear separately and requires an explicit reset after an unconfirmed acknowledgement', async () => {
  await mount();
  await ready();
  await field('emergency', 'clear');
  await field('reason', 'short');
  await submit();
  await visible(text('invalid'));
  expect(controls.command).toBeNull();
  await field('reason', '  Incident response complete  ');
  await submit();
  expect(controls.command?.action?.body).toEqual({
    policy,
    expectedVersion: 3,
    limit: 3,
    emergency: { operation: 'clear', reason: 'Incident response complete' },
  });
  expect(host.querySelector('[role=dialog]')?.textContent).toContain(text('rateLimitClear'));
  await settleError({ ...saved, version: 4 }, 'Unconfirmed rate-limit configuration');
  const command = controls.command!;
  readStatus = 503;
  await act(async () => {
    command.onUnconfirmed!();
    command.onClose();
  });
  await visible(text('unverified'));
  await visible(text('loadFailed'));
  expect(button('resetSaved').disabled).toBe(true);
  expect(host.querySelector<HTMLTextAreaElement>('#security-rate-reason')?.value).toContain(
    'Incident response'
  );
  readStatus = 200;
  saved = { ...saved, version: 4, emergency: null };
  await click('reload');
  await vi.waitFor(() => expect(button('resetSaved').disabled).toBe(false));
  expect(button('rateLimitSave').disabled).toBe(true);
  await click('resetSaved');
  await ready();
  expect(host.querySelector('#security-rate-reason')).toBeNull();
  expect(host.textContent).not.toContain(text('unverified'));
  expect(host.textContent).not.toContain(emergency.owner);
});

it('requires a strictly lower short-lived emergency rule and confirms its exact receipt in Persian', async () => {
  controls.locale = 'fa';
  await mount();
  await ready();
  await field('emergency', 'set');
  const reason = 'بررسی محدودیت موقت ارسال';
  await field('reason', reason);
  await field('emergency-value', '3');
  await field('emergency-minutes', '4');
  await submit();
  expect(host.textContent).toContain(text('invalid'));
  expect(controls.command).toBeNull();
  await field('emergency-value', '2');
  await submit();
  expect(controls.command).toBeNull();
  await field('emergency-minutes', '5');
  await submit();
  expect(controls.command?.action?.body).toEqual({
    policy,
    expectedVersion: 3,
    limit: 3,
    emergency: { operation: 'set', limit: 2, minutes: 5, reason },
  });
  const updated = {
    ...saved,
    version: 4,
    emergency: { ...emergency, active: true, limit: 2, reason },
  };
  for (const incorrect of [
    null,
    { ...updated.emergency, active: false },
    { ...updated.emergency, limit: 1 },
    { ...updated.emergency, reason: emergency.reason },
  ])
    await settleError({ ...updated, emergency: incorrect }, 'Unconfirmed rate-limit configuration');
  await act(async () => {
    saved = updated;
    await controls.command!.onSuccess!(saved);
  });
  await visible(text('rateLimitSaved'));
});

it('paginates rollback history, verifies the source receipt, then activates only the exact draft with its emergency rule intact', async () => {
  let pending: typeof draft | null = null;
  history = () => ({
    policy,
    baseVersion: saved.version,
    items: [prior],
    nextBeforeVersion: 2,
    draft: pending,
  });
  await mount();
  await ready();
  const panel = await recovery();
  await vi.waitFor(() => expect(button('rateRecoveryOlder', panel).disabled).toBe(false));
  expect(button('rateLimitSave').disabled).toBe(true);
  await click('rateRecoveryOlder', panel);
  await visible(text('rateRecoveryEmpty'));
  expect(read.mock.calls.some(([url]) => url.endsWith('&beforeVersion=2'))).toBe(true);
  await click('rateRecoveryLatest', panel);
  await vi.waitFor(() => expect(button('rateRecoveryStage', panel).disabled).toBe(false));
  await click('rateRecoveryStage', panel);
  expect(controls.command?.action).toMatchObject({
    path: base + '/rollback-draft',
    method: 'POST',
    requiresPassword: true,
    successStatus: 201,
    body: { policy, expectedVersion: 3, sourceId: prior.id },
  });
  expect(button('rateRecoveryOlder', panel).disabled).toBe(true);
  expect(button('rateRecoveryStage', panel).disabled).toBe(true);
  for (const incorrect of [
    null,
    { ...draft, sourceId: draft.id },
    { ...draft, sourceVersion: 1 },
    { ...draft, limit: 3 },
  ])
    await settleError(incorrect, 'Invalid rate-limit recovery draft receipt');
  await act(async () => {
    pending = draft;
    await controls.command!.onSuccess!(draft);
  });
  await vi.waitFor(() => expect(button('rateRecoveryActivate', panel).disabled).toBe(false));
  await click('rateRecoveryActivate', panel);
  expect(controls.command?.action).toMatchObject({
    path: base + '/rollback-activate',
    method: 'POST',
    requiresPassword: true,
    successStatus: 200,
    body: { policy, expectedVersion: 3, draftId: draft.id },
  });
  const next = { ...saved, limit: 4, version: 4 };
  for (const incorrect of [
    undefined,
    { draftId: prior.id, current: next },
    { draftId: draft.id, current: null },
    ...[
      { ...next, ...snapshot('login') },
      { ...next, version: 5 },
      { ...next, limit: 3 },
      { ...next, emergency: null },
    ].map((current) => ({ draftId: draft.id, current })),
  ])
    await settleError(incorrect, 'Invalid rate-limit recovery activation receipt');
  await act(async () => {
    saved = next;
    pending = null;
    await controls.command!.onSuccess!({ draftId: draft.id, current: saved });
  });
  await visible(text('rateLimitSaved'));
  expect(host.querySelector<HTMLInputElement>('#security-rate-value')?.value).toBe('4');
  expect(host.textContent).toContain(emergency.owner);
  expect(host.querySelector('[role=dialog]')).toBeNull();
});

it.each([
  null,
  { policy: 'login' },
  { baseVersion: -1 },
  { items: null },
  { items: Array.from({ length: 21 }, () => prior) },
  { items: [null] },
  { items: [{ ...prior, id: 'invalid' }] },
  { items: [{ ...prior, version: 3 }] },
  { items: [{ ...prior, limit: 6 }] },
  { nextBeforeVersion: 3 },
  { draft: { ...draft, id: 'invalid' } },
  { draft: { ...draft, sourceId: 'invalid' } },
  { draft: { ...draft, baseVersion: 4 } },
  { draft: { ...draft, sourceVersion: 3 } },
  { draft: { ...draft, limit: 0 } },
])('rejects corrupt rollback history (%j) before enabling actions', async (invalid) => {
  const valid = history;
  history = () => (invalid === null ? null : { ...(valid() as object), ...invalid });
  await mount();
  await ready();
  const panel = await recovery();
  await visible(text('loadFailed'));
  expect(panel.querySelector('ul')).toBeNull();
  history = valid;
  await click('reload', panel);
  await vi.waitFor(() => expect(button('rateRecoveryStage', panel).disabled).toBe(false));
});

it('blocks a stale history without offering staging or activation', async () => {
  history = () => ({
    policy,
    baseVersion: 4,
    items: [prior],
    nextBeforeVersion: null,
    draft: null,
  });
  await mount();
  await ready();
  const panel = await recovery();
  await visible(text('conflict'));
  expect(panel.querySelector('button')).toBeNull();
});

it('removes private configuration and withdraws recovery confirmation when authority expires', async () => {
  history = () => ({ policy, baseVersion: 3, items: [], nextBeforeVersion: null, draft });
  const denied = await mount();
  await ready();
  await recovery();
  await vi.waitFor(() => expect(button('rateRecoveryActivate').disabled).toBe(false));
  await click('rateRecoveryActivate');
  await act(async () => controls.command!.onDenied!(401));
  await visible(text('forbidden'));
  expect(denied).toHaveBeenCalledWith(401);
  expect(host.textContent).not.toContain(emergency.owner);
  expect(host.querySelector('[role=dialog]')).toBeNull();
  expect(host.querySelector('fieldset')).toBeNull();
});

it('refuses a rollback retry until a lost acknowledgement is reconciled from a fresh read', async () => {
  await mount();
  await ready();
  await recovery();
  await vi.waitFor(() => expect(button('rateRecoveryStage').disabled).toBe(false));
  await click('rateRecoveryStage');
  readStatus = 503;
  await act(async () => controls.command!.onUnconfirmed!());
  await visible(text('unverified'));
  await visible(text('loadFailed'));
  expect(button('resetSaved').disabled).toBe(true);
  expect(button('rateLimitSave').disabled).toBe(true);
  expect(host.querySelector('[role=dialog]')).toBeNull();
  expect(host.querySelector('#security-rate-limit-recovery')).toBeNull();
});
