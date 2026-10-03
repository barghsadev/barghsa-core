import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ServiceSettingsEditor } from './ServiceSettingsEditor.js';
import Page from './AdminServiceTargetsPage.js';
import type { TeamAction } from '../components/TeamActionDialog.js';

interface Confirmation {
  action: TeamAction;
  confirmationDisabled: boolean;
  onClose: () => void;
  onSuccess: (result: unknown) => Promise<void>;
  onValidationError: (fields: unknown[]) => boolean;
}
const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  command: null as Confirmation | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../components/AuditLogViewer.js', () => ({ AuditLogViewer: () => null }));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: Confirmation) => {
    harness.command = props;
    return <div data-testid="confirmation">{props.action.description}</div>;
  },
}));
const policy = (hours: number) => ({
  ticket: {
    level2: { delayHours: hours, channels: ['in_app', 'email'] },
    level3: { delayHours: null, channels: ['in_app'] },
  },
  verification_case: null,
});
const cases = [
  {
    kind: 'targets',
    selector: '#target-ticket',
    field: 'ticketHours',
    initial: { ticket: 24, verification_case: null },
    saved: { ticket: 72, verification_case: null },
    changed: { ticket: 48, verification_case: null },
  },
  {
    kind: 'escalation',
    selector: '#escalation-ticketLevel2',
    field: 'ticketLevel2Hours',
    initial: policy(24),
    saved: policy(72),
    changed: policy(48),
  },
] as const;
let host: HTMLDivElement, root: Root, read: unknown, status: number;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.locale = 'en';
  harness.command = null;
  status = 200;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(read, { status }))
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const input = (selector: string) => host.querySelector<HTMLInputElement>(selector)!;
async function fill(selector: string, raw: string) {
  await act(async () => {
    const node = input(selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, raw);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.querySelector('form')!.getAttribute('aria-busy')).not.toBe('true');
  });
}
async function refresh() {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find((node) =>
    /^Refresh (response targets|escalation policy)$/.test(node.textContent!.trim())
  )!;
  await act(async () => button.click());
}
for (const item of cases) {
  it.each(['en', 'fa'] as const)(
    `${item.kind}: localized raw hours, focus, and owned errors (%s)`,
    async (locale) => {
      harness.locale = locale;
      read = item.initial;
      await act(async () => root.render(<ServiceSettingsEditor kind={item.kind} />));
      await fill(item.selector, '1e3');
      await submit();
      expect(harness.command).toBeNull();
      expect(input(item.selector).value).toBe('1e3');
      await vi.waitFor(() => expect(document.activeElement).toBe(input(item.selector)));
      expect(input(item.selector).getAttribute('aria-invalid')).toBe('true');
      await fill(item.selector, ' ۷۲ ');
      await submit();
      const command = harness.command!;
      expect(command.action.body).toEqual(item.saved);
      expect(input(item.selector).matches(':disabled')).toBe(true);
      await act(async () => {
        expect(command.onValidationError([item.field, 'actorUserId'])).toBe(false);
        expect(command.onValidationError(['verificationCaseLevel3Hours'])).toBe(
          item.kind === 'escalation'
        );
        expect(command.onValidationError([item.field])).toBe(true);
        command.onClose();
      });
      await vi.waitFor(() => expect(document.activeElement).toBe(input(item.selector)));
      expect(input(item.selector).value).toBe(' ۷۲ ');
      expect(input(item.selector).matches(':disabled')).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );
  it(`${item.kind}: failed or unchanged reads keep a proposal; changed reads require reset`, async () => {
    read = item.initial;
    await act(async () => root.render(<ServiceSettingsEditor kind={item.kind} />));
    await fill(item.selector, '72');
    await submit();
    const old = harness.command!;
    status = 503;
    await refresh();
    expect(harness.command!.confirmationDisabled).toBe(true);
    expect(input(item.selector).value).toBe('72');
    status = 200;
    await refresh();
    expect(harness.command!.confirmationDisabled).toBe(false);
    expect(harness.command!.action).toBe(old.action);
    read = item.changed;
    await refresh();
    expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
    expect(input(item.selector).value).toBe('72');
    expect(input(item.selector).matches(':disabled')).toBe(true);
    await act(async () => old.onSuccess(item.saved));
    expect(input(item.selector).value).toBe('72');
    const reset = [...host.querySelectorAll<HTMLButtonElement>('button')].find((node) =>
      node.textContent!.startsWith('Reset to current')
    )!;
    await act(async () => reset.click());
    expect(input(item.selector).value).toBe('48');
    expect(input(item.selector).matches(':disabled')).toBe(false);
  });
  it(`${item.kind}: unverified acknowledgement blocks a retry, and verified save resets cleanly`, async () => {
    read = item.initial;
    await act(async () => root.render(<ServiceSettingsEditor kind={item.kind} />));
    await fill(item.selector, '72');
    await submit();
    await act(async () => {
      await expect(harness.command!.onSuccess(item.changed)).rejects.toThrow('Unverified');
    });
    expect(harness.command!.confirmationDisabled).toBe(true);
    await act(async () => harness.command!.onClose());
    expect(input(item.selector).value).toBe('72');
    await refresh();
    await submit();
    read = item.saved;
    await act(async () => harness.command!.onSuccess(item.saved));
    expect(input(item.selector).value).toBe('72');
    expect(input(item.selector).matches(':disabled')).toBe(false);
    expect(host.textContent).not.toContain('Your draft is retained');
    expect(host.textContent).toContain('Changes saved.');
    await fill(item.selector, '73');
    expect(host.textContent).not.toContain('Changes saved.');
  });
  it(`${item.kind}: malformed reads freeze retained drafts and denied reads clear them`, async () => {
    read = item.initial;
    await act(async () => root.render(<ServiceSettingsEditor kind={item.kind} />));
    await fill(item.selector, '72');
    read = {};
    await refresh();
    expect(input(item.selector).value).toBe('72');
    expect(input(item.selector).matches(':disabled')).toBe(true);
    status = 403;
    await refresh();
    expect(input(item.selector)).toBeNull();
    status = 200;
    read = item.initial;
    await refresh();
    expect(input(item.selector).value).toBe('24');
  });
}
it('a denied target capability does not clear the independently granted escalation editor', async () => {
  vi.mocked(fetch).mockImplementation(async (url) =>
    String(url).endsWith('escalation-policy')
      ? Response.json(policy(24))
      : Response.json({}, { status: 403 })
  );
  await act(async () => root.render(<Page />));
  expect(input('#target-ticket')).toBeNull();
  expect(input('#escalation-ticketLevel2').value).toBe('24');
  await fill('#escalation-ticketLevel2', '72');
  await submit();
  expect(harness.command!.action.path).toBe('/api/admin/config/escalation-policy');
});

it('a captured action locks the other editor, which cannot replace the active confirmation', async () => {
  vi.mocked(fetch).mockImplementation(async (url) =>
    String(url).endsWith('escalation-policy')
      ? Response.json(policy(24))
      : Response.json(cases[0].initial)
  );
  await act(async () => root.render(<Page />));
  await fill('#target-ticket', '72');
  await submit();
  const command = harness.command!;
  expect(input('#escalation-ticketLevel2').matches(':disabled')).toBe(true);
  await act(async () =>
    input('#escalation-ticketLevel2')
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(harness.command!.action).toBe(command.action);
  await act(async () => command.onClose());
  expect(input('#escalation-ticketLevel2').matches(':disabled')).toBe(false);
});
