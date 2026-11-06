import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_SERVICE_WORKFLOWS, type ServiceWorkflowView } from '@barghsa/shared/admin';
import { ServiceWorkflowSettings } from './ServiceWorkflowSettings.js';
import { QueryProvider } from '../test/query-provider.js';
import type { TeamAction } from './TeamActionDialog.js';
const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  command: null as null | {
    action: TeamAction;
    confirmationDisabled: boolean;
    onClose: () => void;
    onSuccess: (value: unknown) => Promise<void>;
    onUnconfirmed: () => void;
  },
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: (props: NonNullable<typeof harness.command>) => {
    harness.command = props;
    return <div data-confirmation />;
  },
}));
let host: HTMLDivElement, root: Root, view: ServiceWorkflowView, status: number;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.locale = 'en';
  harness.command = null;
  status = 200;
  view = {
    policy: structuredClone(DEFAULT_SERVICE_WORKFLOWS),
    version: 0,
    roles: [{ id: 'reviewer', name: 'Reviewer' }],
    teams: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(view, { status }))
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const mount = () =>
  act(async () =>
    root.render(
      <QueryProvider>
        <ServiceWorkflowSettings />
      </QueryProvider>
    )
  );
async function change(id: string, value: string) {
  await act(async () => {
    const n = host.querySelector<HTMLInputElement | HTMLSelectElement>('#' + id)!;
    Object.getOwnPropertyDescriptor(
      n.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLSelectElement.prototype,
      'value'
    )!.set!.call(n, value);
    n.dispatchEvent(new Event(n.tagName === 'INPUT' ? 'input' : 'change', { bubbles: true }));
  });
}
const submit = () =>
  act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
for (const locale of ['en', 'fa'] as const)
  it(`captures localized days and safe typed rules without overwriting other targets (${locale})`, async () => {
    harness.locale = locale;
    await mount();
    await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
    await change('workflow-hours-ticket_urgent', '۲');
    await change('workflow-hours-ticket_urgent-unit', 'days');
    await submit();
    expect(harness.command?.action.requiresPassword).toBe(true);
    expect(harness.command?.action.body).toMatchObject({
      expectedVersion: 0,
      policy: { ticket_low: null, ticket_urgent: { hours: 48, escalation: null } },
    });
    expect(host.querySelector('section')!.dir).toBe(locale === 'fa' ? 'rtl' : 'ltr');
  });
it('rejects malformed durations locally and focuses the owned field before confirmation', async () => {
  await mount();
  await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await change('workflow-hours-ticket_urgent', '1e3');
  await submit();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(host.querySelector('#workflow-hours-ticket_urgent'))
  );
  expect(harness.command).toBeNull();
  expect(host.querySelector('#workflow-hours-ticket_urgent')?.getAttribute('aria-invalid')).toBe(
    'true'
  );
});
it('holds an uncertain acknowledgement, preserves the draft on reload and requires explicit saved-state reset', async () => {
  await mount();
  await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await submit();
  await act(async () => {
    await expect(harness.command!.onSuccess({ ...view, version: 99 })).rejects.toThrow(
      'Unconfirmed workflow policy'
    );
  });
  await vi.waitFor(() => expect(harness.command!.confirmationDisabled).toBe(true));
  expect(host.querySelector<HTMLInputElement>('#workflow-hours-ticket_urgent')!.value).toBe('1');
  await act(async () => harness.command!.onClose());
  await vi.waitFor(() =>
    expect(
      [...host.querySelectorAll('button')]
        .find((b) => b.textContent === 'Reset to saved workflow rules')!
        .matches(':disabled')
    ).toBe(false)
  );
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((b) => b.textContent === 'Reset to saved workflow rules')!
      .click()
  );
  expect(host.querySelector('#workflow-hours-ticket_urgent')).toBeNull();
});
it('clears private configuration and withdraws confirmation when current authorization is denied', async () => {
  await mount();
  await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await submit();
  status = 403;
  // The real dialog calls its denial callback; a read denial also clears the scope.
  await act(async () => harness.command!.onUnconfirmed());
  await vi.waitFor(() => expect(host.querySelector('form')).toBeNull());
  expect(host.textContent).toContain('access changed');
});
