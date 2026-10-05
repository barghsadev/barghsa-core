import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Page from './AdminNotificationsPage.js';
import { notificationTemplate } from '../test/content-catalogue-fixtures.js';
type SchemaModule = typeof import('../lib/catalogue-form-schemas.js');
const harness = vi.hoisted(() => ({
  fail: false,
  hold: false,
  release: null as (() => void) | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useTimezone.js', () => ({
  useTimezone: () => ({ status: 'ready', timezone: 'UTC', retry: vi.fn() }),
}));
vi.mock('../components/DeadLetterPanel.js', () => ({ default: () => null }));
vi.mock('../components/CustomerCorrectionsPanel.js', () => ({
  CustomerCorrectionsSection: () => null,
}));
vi.mock('../components/DeliveryWindowConfigPanel.js', () => ({ default: () => null }));
vi.mock('../components/TemplatePreviewPanel.js', () => ({ default: () => null }));
vi.mock('../components/BrandedEmailPreview.js', () => ({ default: () => null }));
vi.mock('../lib/catalogue-form-schemas.js', async (original) => {
  const actual = await original<SchemaModule>();
  return {
    ...actual,
    notificationFormSchema: (...args: Parameters<typeof actual.notificationFormSchema>) => {
      if (harness.fail) throw new Error('Unavailable module');
      if (harness.hold)
        return new Promise((resolve) => {
          harness.release = () => resolve(actual.notificationFormSchema(...args));
        });
      return actual.notificationFormSchema(...args);
    },
  };
});
let host: HTMLDivElement, root: Root, items: unknown, receipt: unknown, writeStatus: number;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.fail = harness.hold = false;
  harness.release = null;
  items = [notificationTemplate()];
  receipt = {};
  writeStatus = 200;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_: string, init?: RequestInit) =>
      Response.json(init?.method ? receipt : items, { status: init?.method ? writeStatus : 200 })
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function click(name: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}
async function mount() {
  await act(async () => root.render(<Page />));
  await click('Edit');
}
const field = (name: string) =>
  host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#notification-template-${name}`)!;
async function fill(name: string, value: string) {
  await act(async () => {
    const el = field(name),
      proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    field('eventKey')
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
const writes = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method);
it('rejects undeclared placeholders with linked body focus and retains declared metadata', async () => {
  await mount();
  const variables = field('variablesLabel').value;
  await fill('bodyTemplate', 'Hello {{unknown}}');
  await submit();
  await vi.waitFor(() => expect(field('bodyTemplate').getAttribute('aria-invalid')).toBe('true'));
  expect(field('variablesLabel').value).toBe(variables);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.activeElement).toBe(field('bodyTemplate'));
  });
  expect(writes()).toHaveLength(0);
});
it('maps owned server feedback while preserving all valid content', async () => {
  await mount();
  await fill('bodyTemplate', 'Local body');
  await fill('subject', 'Local subject');
  writeStatus = 400;
  receipt = { error: { fields: ['bodyTemplate'] } };
  await submit();
  await vi.waitFor(() => expect(field('bodyTemplate').getAttribute('aria-invalid')).toBe('true'));
  expect(field('subject').value).toBe('Local subject');
  expect(field('bodyTemplate').value).toBe('Local body');
});
it('keeps drafts and blocks writes while validation is unavailable, then retries the same data', async () => {
  await mount();
  await fill('bodyTemplate', 'Local body');
  harness.fail = true;
  await submit();
  await vi.waitFor(() => expect(host.textContent).toContain('Validation could not load'));
  expect(writes()).toHaveLength(0);
  expect(field('bodyTemplate').value).toBe('Local body');
  harness.fail = false;
  receipt = { ...notificationTemplate(), bodyTemplate: 'Local body' };
  await submit();
  await vi.waitFor(() => expect(host.querySelector('#notification-template-eventKey')).toBeNull());
  expect(writes()).toHaveLength(1);
});
it('locks before deferred validation and cancels obsolete work after a changed catalogue', async () => {
  await mount();
  await fill('bodyTemplate', 'Local body');
  harness.hold = true;
  await submit();
  await vi.waitFor(() => expect(harness.release).toBeTypeOf('function'));
  expect(field('bodyTemplate').matches(':disabled')).toBe(true);
  await submit();
  expect(writes()).toHaveLength(0);
  items = [{ ...notificationTemplate(), bodyTemplate: 'Changed server body' }];
  await click('Refresh templates');
  await act(async () => harness.release!());
  expect(writes()).toHaveLength(0);
  expect(field('bodyTemplate').value).toBe('Local body');
});
it('requires a fresh read and explicit reset after an unverified save acknowledgement', async () => {
  await mount();
  await fill('bodyTemplate', 'Local body');
  receipt = { ...notificationTemplate(), bodyTemplate: 'Different body' };
  await submit();
  await vi.waitFor(() => expect(host.textContent).toContain('could not be verified'));
  const reset = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === 'Reset to saved template'
  )!;
  expect(reset.disabled).toBe(true);
  await submit();
  expect(writes()).toHaveLength(1);
  await click('Refresh templates');
  await click('Reset to saved template');
  expect(field('bodyTemplate').value).toBe(notificationTemplate().bodyTemplate);
});
it('blocks another protected write when the retried save receipt cannot be verified', async () => {
  await mount();
  await fill('bodyTemplate', 'Local body');
  let attempts = 0;
  vi.mocked(fetch).mockImplementation(async (path, init) => {
    if (String(path).endsWith('/auth/step-up')) return Response.json({ verified: true });
    if (!init?.method) return Response.json(items);
    attempts++;
    return attempts === 1
      ? Response.json({ requiresStepUp: true }, { status: 403 })
      : Response.json({});
  });
  await submit();
  await vi.waitFor(() =>
    expect(document.querySelector('[role=dialog] input[type=password]')).not.toBeNull()
  );
  await act(async () => {
    const password = document.querySelector<HTMLInputElement>(
      '[role=dialog] input[type=password]'
    )!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      password,
      'synthetic-password'
    );
    password.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    document
      .querySelector('[role=dialog] form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.textContent).toContain('could not be verified');
  });
  const confirm = document.querySelector<HTMLButtonElement>('[role=dialog] button[type=submit]')!;
  expect(confirm.disabled).toBe(true);
  await act(async () =>
    document
      .querySelector('[role=dialog] form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(attempts).toBe(2);
  expect(field('bodyTemplate').value).toBe('Local body');
});

it('keeps a saved template outside the applied event scope out of the catalogue when refresh fails', async () => {
  await act(async () => root.render(<Page />));
  const event = host.querySelector<HTMLInputElement>('#notification-event-filter')!;
  event.value = notificationTemplate().eventKey;
  await act(async () =>
    event.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await click('New Template');
  await fill('eventKey', 'another.event');
  await fill('subject', 'Other saved subject');
  await fill('bodyTemplate', 'Other saved body');
  let saved = false;
  vi.mocked(fetch).mockImplementation(async (_, init) => {
    if (init?.method) {
      saved = true;
      return Response.json(
        {
          ...notificationTemplate(),
          id: 'other-template',
          eventKey: 'another.event',
          subject: 'Other saved subject',
          bodyTemplate: 'Other saved body',
        },
        { status: 201 }
      );
    }
    return Response.json(saved ? {} : items, { status: saved ? 503 : 200 });
  });
  await submit();
  await vi.waitFor(() =>
    expect(host.querySelector('#notification-template-bodyTemplate')).toBeNull()
  );
  expect(writes()).toHaveLength(1);
  expect(host.textContent).toContain('Failed to load notification templates');
  const catalogue = host.querySelector('table')!;
  expect(catalogue.textContent).toContain(notificationTemplate().eventKey);
  expect(catalogue.textContent).not.toContain('another.event');
});
