import { act, useEffect, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Notifications from './AdminNotificationsPage.js';
import Terms from './AdminTosPage.js';
import { notificationTemplate, termsVersion } from '../test/content-catalogue-fixtures.js';
import { validTemplate, isVersion, templateBasis } from '../lib/content-catalogues.js';
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
vi.mock('./TosRichText.js', () => ({
  default: ({
    value,
    onChange,
    label,
    disabled,
  }: {
    value: string;
    onChange: (v: string) => void;
    label: string;
    disabled: boolean;
  }) => (
    <textarea
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  ),
}));
vi.mock('./TosPreview.js', () => ({
  default: function MockPreview({ onReady }: { onReady: () => void }) {
    useEffect(onReady, [onReady]);
    return <p>Preview</p>;
  },
}));
let host: HTMLDivElement, root: Root;
const reply = (v: unknown, status = 200) =>
  status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(v), { status });
const domains = ['templates', 'terms'] as const;
type Domain = (typeof domains)[number];
const item = (domain: Domain) => (domain === 'templates' ? notificationTemplate() : termsVersion());
const Page = ({ domain }: { domain: Domain }) =>
  domain === 'templates' ? <Notifications /> : <Terms />;
beforeEach(() => {
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
async function click(name: string, dialog = false) {
  const area = dialog ? document.querySelector('[role=dialog]')! : host;
  const node = [...area.querySelectorAll<HTMLButtonElement>('button')].find(
    (n) => n.textContent?.trim() === name
  );
  expect(node, name).toBeDefined();
  await act(async () => node!.click());
}
async function fill(selector: string, value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(dialog = false) {
  await act(async () =>
    document
      .querySelector(dialog ? '[role=dialog] form' : 'form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function render(
  domain: Domain,
  read: (path: string, init?: RequestInit) => Response | Promise<Response>,
  strict = false
) {
  const requests = vi.fn((path: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(read(String(path), init))
  );
  vi.stubGlobal('fetch', requests);
  await act(async () =>
    root.render(
      strict ? (
        <StrictMode>
          <Page domain={domain} />
        </StrictMode>
      ) : (
        <Page domain={domain} />
      )
    )
  );
  return requests;
}
const refresh = (d: Domain) => (d === 'templates' ? 'Refresh templates' : 'Refresh versions');
const edit = (d: Domain) => (d === 'templates' ? 'Edit' : 'Edit');
const input = (d: Domain) =>
  d === 'templates'
    ? '#notification-template-bodyTemplate'
    : 'textarea[aria-label="English content"]';
it.each([
  null,
  {},
  { ...notificationTemplate(), updatedAt: 'bad' },
  { ...notificationTemplate(), variables: [{}] },
  { ...notificationTemplate(), version: 0 },
  { ...notificationTemplate(), isActive: true },
  { ...notificationTemplate(), id: '../unsafe' },
  { ...notificationTemplate(), publishedAt: 'bad' },
])('rejects invalid template DTO %j', (v) => expect(validTemplate(v)).toBe(false));
it('validates complete publishing DTOs and stable settings comparisons', () => {
  expect(validTemplate(notificationTemplate())).toBe(true);
  expect(isVersion(termsVersion())).toBe(true);
  expect(isVersion({ ...termsVersion(), revision: 'wrong' })).toBe(false);
  expect(isVersion({ ...termsVersion(), status: 'draft', isActive: true })).toBe(false);
  expect(
    templateBasis({ ...notificationTemplate(), lastTestStatus: 'failed' } as ReturnType<
      typeof notificationTemplate
    >)
  ).toBe(templateBasis(notificationTemplate()));
});
it.each(domains)(
  '%s keeps accepted catalogue and local content during failure and retry',
  async (domain) => {
    let failed = false;
    await render(domain, () => reply([item(domain)], failed ? 503 : 200));
    await click(edit(domain));
    await fill(input(domain), 'Local text');
    failed = true;
    await click(refresh(domain));
    expect(host.querySelector<HTMLInputElement>(input(domain))!.value).toBe('Local text');
    expect(host.textContent).toContain(domain === 'templates' ? 'Recovery subject' : 'v2');
    expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled).toBe(true);
    failed = false;
    await click(refresh(domain));
    expect(host.querySelector<HTMLInputElement>(input(domain))!.value).toBe('Local text');
    expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled).toBe(false);
  }
);
for (const domain of domains)
  it.each([401, 403])(
    `${domain} denial %i clears private editor and recovers safely`,
    async (status) => {
      let denied = false;
      await render(domain, () => reply([item(domain)], denied ? status : 200));
      await click(edit(domain));
      await fill(input(domain), 'Private text');
      denied = true;
      await click(refresh(domain));
      expect(host.querySelector('form')).toBeNull();
      expect(host.textContent).not.toContain('Private text');
      expect(host.textContent).not.toContain(domain === 'templates' ? 'Recovery subject' : 'v2');
      denied = false;
      await click(refresh(domain));
      expect(host.textContent).toContain(domain === 'templates' ? 'Recovery subject' : 'v2');
    }
  );
it.each(domains)(
  '%s rejects duplicate history rows without inventing an empty state',
  async (domain) => {
    await render(domain, () => reply([item(domain), item(domain)]));
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    expect(host.querySelector('table')).toBeNull();
  }
);
it.each(domains)(
  '%s metadata changes preserve local text but disable obsolete saves',
  async (domain) => {
    let changed = false;
    await render(domain, (path) =>
      reply(
        path.endsWith('/draft-one')
          ? { ...termsVersion(), revision: 'b'.repeat(64), contentEn: 'Fresh text' }
          : [
              changed
                ? domain === 'templates'
                  ? {
                      ...notificationTemplate(),
                      updatedAt: '2026-10-01T01:00:00Z',
                      bodyTemplate: 'Fresh text',
                    }
                  : { ...termsVersion(), revision: 'b'.repeat(64), contentEn: 'Fresh text' }
                : item(domain),
            ]
      )
    );
    await click(edit(domain));
    await fill(input(domain), 'Local text');
    changed = true;
    await click(refresh(domain));
    expect(host.querySelector<HTMLInputElement>(input(domain))!.value).toBe('Local text');
    expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled).toBe(true);
    await click(domain === 'templates' ? 'Reset to saved template' : 'Reload saved draft');
    expect(host.querySelector<HTMLInputElement>(input(domain))!.value).toBe('Fresh text');
  }
);
it.each(domains)('%s late successful command cannot restore denied content', async (domain) => {
  let denied = false,
    resolve!: (v: Response) => void;
  await render(domain, (_path, init) =>
    init?.method
      ? new Promise((done) => {
          resolve = done;
        })
      : reply([item(domain)], denied ? 403 : 200)
  );
  await click(edit(domain));
  await fill(input(domain), 'Local text');
  await submit();
  if (domain === 'templates') await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  denied = true;
  await click(refresh(domain));
  await act(async () =>
    resolve(
      reply(
        domain === 'templates'
          ? { ...notificationTemplate(), bodyTemplate: 'Local text' }
          : { ...termsVersion(), contentEn: 'Local text' }
      )
    )
  );
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).not.toContain('Local text');
});
it.each(domains)('%s malformed save acknowledgement preserves local editor', async (domain) => {
  await render(domain, (_path, init) => (init?.method ? reply({}) : reply([item(domain)])));
  await click(edit(domain));
  await fill(input(domain), 'Local text');
  await submit();
  expect(host.querySelector<HTMLInputElement>(input(domain))!.value).toBe('Local text');
  expect(host.querySelector('[role=alert]')).not.toBeNull();
});
it.each(domains)('%s accepted receipt survives failed authoritative reload', async (domain) => {
  let fail = false;
  await render(domain, (_path, init) => {
    if (init?.method) {
      fail = true;
      return reply(
        domain === 'templates'
          ? { ...notificationTemplate(), bodyTemplate: 'Saved text' }
          : { ...termsVersion(), contentEn: 'Saved text', revision: 'b'.repeat(64) }
      );
    }
    return reply([item(domain)], fail ? 503 : 200);
  });
  await click(edit(domain));
  await fill(input(domain), 'Saved text');
  await submit();
  expect(host.querySelector('form')).toBeNull();
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.querySelector('table')).not.toBeNull();
});
it.each(domains)('%s works under React strict effect replay', async (domain) => {
  await render(domain, () => reply([item(domain)]), true);
  expect(host.textContent).toContain(domain === 'templates' ? 'Recovery subject' : 'v2');
});
it('template recovery preserves password and frozen proposal then clears changed review', async () => {
  let failed = false,
    changed = false;
  await render('templates', (_path, init) =>
    init?.method
      ? reply({ requiresStepUp: true }, 403)
      : reply(
          [
            changed
              ? { ...notificationTemplate(), updatedAt: '2026-10-01T01:00:00Z' }
              : notificationTemplate(),
          ],
          failed ? 503 : 200
        )
  );
  await click('Edit');
  await fill(input('templates'), 'Local text');
  await submit();
  const password = document.querySelector<HTMLInputElement>('[role=dialog] input[type=password]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      password,
      'synthetic-password'
    );
    password.dispatchEvent(new Event('input', { bubbles: true }));
  });
  failed = true;
  await click('Refresh templates', true);
  expect(password.value).toBe('synthetic-password');
  expect(
    document.querySelector<HTMLButtonElement>('[role=dialog] button[type=submit]')!.disabled
  ).toBe(true);
  failed = false;
  await click('Refresh templates', true);
  expect(
    document.querySelector<HTMLButtonElement>('[role=dialog] button[type=submit]')!.disabled
  ).toBe(false);
  changed = true;
  await click('Refresh templates', true);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>(input('templates'))!.value).toBe('Local text');
});
it.each([200, 204])('password-protected delete requires HTTP 204, received %i', async (status) => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  let verified = false,
    deleted = false;
  await render('templates', (path, init) => {
    if (path.endsWith('/auth/step-up')) {
      verified = true;
      return reply({ ok: true });
    }
    if (init?.method) {
      if (!verified) return reply({ requiresStepUp: true }, 403);
      if (status === 204) deleted = true;
      return reply(null, status);
    }
    return reply(deleted ? [] : [notificationTemplate()]);
  });
  await click('Delete');
  const password = document.querySelector<HTMLInputElement>('[role=dialog] input[type=password]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      password,
      'synthetic-password'
    );
    password.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await submit(true);
  expect(document.querySelector('[role=dialog]') !== null).toBe(status === 200);
  expect(host.textContent?.includes('Recovery subject')).toBe(status === 200);
  vi.restoreAllMocks();
});
it('fresh terms invalidate a preview when its published comparison changes', async () => {
  let changed = false;
  const published = {
    ...termsVersion(),
    id: 'published-one',
    versionId: 'v1',
    status: 'published',
    isActive: true,
    publishedAt: '2026-10-01T00:00:00Z',
    revision: 'c'.repeat(64),
  };
  await render('terms', () =>
    reply([
      termsVersion(),
      { ...published, revision: changed ? 'd'.repeat(64) : published.revision },
    ])
  );
  await click('Publish');
  expect(host.querySelector('[role=region][aria-label="Publish TOS Version"]')).not.toBeNull();
  changed = true;
  await click('Refresh versions');
  expect(host.querySelector('[aria-label="Publish TOS Version"]')).toBeNull();
});
it('template filtering clears replaced work and discards older pages', async () => {
  let resolve!: (v: Response) => void,
    delayed = false;
  await render('templates', (path) =>
    path.includes('status=archived')
      ? reply([{ ...notificationTemplate(), status: 'archived' }])
      : delayed
        ? new Promise((done) => {
            resolve = done;
          })
        : reply([notificationTemplate()])
  );
  await click('Edit');
  await fill(input('templates'), 'Local text');
  delayed = true;
  await click('Refresh templates');
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="All Status"]')!;
    select.value = 'archived';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => resolve(reply([notificationTemplate()])));
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).toContain('Archived');
});
it.each(domains)('%s old command cannot block or unlock recovered editor work', async (domain) => {
  let denied = false;
  const pending: ((response: Response) => void)[] = [];
  await render(domain, (_path, init) => {
    if (init?.method) return new Promise<Response>((resolve) => pending.push(resolve));
    return reply([item(domain)], denied ? 403 : 200);
  });
  await click('Edit');
  await fill(input(domain), 'Old text');
  await submit();
  if (domain === 'templates') await vi.waitFor(() => expect(pending).toHaveLength(1));
  denied = true;
  await click(refresh(domain));
  denied = false;
  await click(refresh(domain));
  await click('Edit');
  await fill(input(domain), 'New text');
  await submit();
  await vi.waitFor(() => expect(pending).toHaveLength(2));
  const receipt = (content: string) =>
    reply(
      domain === 'templates'
        ? { ...notificationTemplate(), bodyTemplate: content }
        : { ...termsVersion(), contentEn: content, revision: 'b'.repeat(64) }
    );
  await act(async () => pending[0]!(receipt('Old text')));
  expect(host.querySelector<HTMLInputElement>(input(domain))!.value).toBe('New text');
  expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled).toBe(true);
  await act(async () => pending[1]!(receipt('New text')));
  expect(host.querySelector('form')).toBeNull();
});
it('old template test-send cannot unlock a replacement editor request', async () => {
  const pending: ((response: Response) => void)[] = [];
  await render('templates', (_path, init) =>
    init?.method
      ? new Promise<Response>((resolve) => pending.push(resolve))
      : reply([notificationTemplate()])
  );
  await click('Edit');
  await click('Test Send');
  await click('Cancel');
  await click('Edit');
  await click('Test Send');
  expect(pending).toHaveLength(2);
  const receipt = () => reply({ ok: true, destination: 'email', lastTestStatus: 'delivered' });
  await act(async () => pending[0]!(receipt()));
  const testButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes('Sending')
  );
  expect(testButton?.disabled).toBe(true);
  await act(async () => pending[1]!(receipt()));
  expect(host.textContent).toContain('Test email sent');
});
