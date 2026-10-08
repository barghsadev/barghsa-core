import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Terms from './AdminTosPage.js';
import Templates from './AdminContractTemplatesPage.js';
import { termsVersion } from '../test/content-catalogue-fixtures.js';
import { contractTemplate, contractTemplateDetail } from '../test/contract-settings-fixtures.js';
import type { WizardFieldBinding } from '../hooks/useWizardForm.js';
const validation = vi.hoisted(() => ({
  fail: false,
  hold: false,
  release: null as (() => void) | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('./TosRichText.js', () => ({
  default: ({
    value,
    onChange,
    label,
    disabled,
    binding,
  }: {
    value: string;
    onChange: (v: string) => void;
    label: string;
    disabled: boolean;
    binding: WizardFieldBinding;
  }) => (
    <textarea
      {...binding}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  ),
}));
vi.mock('../lib/catalogue-form-schemas.js', async (original) => {
  const actual = await original<SchemaModule>();
  return {
    ...actual,
    contentFormSchema: (...args: Parameters<typeof actual.contentFormSchema>) => {
      if (validation.fail) throw new Error('Missing module');
      if (validation.hold)
        return new Promise((resolve) => {
          validation.release = () => resolve(actual.contentFormSchema(...args));
        });
      return actual.contentFormSchema(...args);
    },
  };
});
type SchemaModule = typeof import('../lib/catalogue-form-schemas.js');
let host: HTMLDivElement,
  root: Root,
  rows: unknown,
  detail: unknown,
  result: unknown,
  status: number;
let kind: 'terms' | 'templates';
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  validation.fail = validation.hold = false;
  validation.release = null;
  status = 200;
  result = {};
  kind = 'terms';
  rows = [];
  detail = contractTemplateDetail;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) =>
      Response.json(init?.method ? result : path.endsWith(contractTemplate.id) ? detail : rows, {
        status: init?.method ? status : 200,
      })
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}
async function mount(domain: typeof kind) {
  kind = domain;
  rows = domain === 'terms' ? [] : [contractTemplate];
  await act(async () =>
    root.render(<QueryProvider>{domain === 'terms' ? <Terms /> : <Templates />}</QueryProvider>)
  );
  await click(domain === 'terms' ? 'New Draft' : 'Open');
}
function field(name: string) {
  return (
    kind === 'templates'
      ? host.querySelector(`#template-${name}`)
      : name === 'versionId'
        ? host.querySelector('#admintospage-field-1')
        : host.querySelector(
            `textarea[aria-label="${name === 'contentFa' ? 'Persian' : 'English'} content"]`
          )
  ) as HTMLInputElement | HTMLTextAreaElement;
}
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
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
const writes = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method);
async function validTerms() {
  await fill('versionId', 'v2');
  await fill('contentFa', 'شرایط');
  await fill('contentEn', 'Terms');
}
it.each(['terms', 'templates'] as const)(
  '%s validates on touch, links errors and focuses without losing companion input',
  async (domain) => {
    await mount(domain);
    if (domain === 'terms') await fill('contentEn', 'Retained text');
    else await fill('description', 'Retained text');
    const first = domain === 'terms' ? 'versionId' : 'name';
    await fill(first, ' ');
    await act(async () => field(first).dispatchEvent(new Event('blur')));
    await submit();
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.activeElement).toBe(field(first));
    });
    expect(field(first).getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(field(first).getAttribute('aria-describedby')!)).not.toBeNull();
    expect(field(domain === 'terms' ? 'contentEn' : 'description').value).toBe('Retained text');
    expect(writes()).toHaveLength(0);
  }
);
it.each(['terms', 'templates'] as const)(
  '%s retains drafts when its validator is unavailable and retries',
  async (domain) => {
    await mount(domain);
    if (domain === 'terms') await validTerms();
    else await fill('name', 'Local name');
    validation.fail = true;
    await submit();
    await vi.waitFor(() => expect(host.textContent).toContain('Validation could not load'));
    expect(writes()).toHaveLength(0);
    validation.fail = false;
    result = termsVersion();
    await submit();
    await vi.waitFor(() =>
      domain === 'terms'
        ? expect(host.querySelector('form')).toBeNull()
        : expect(document.querySelector('[role=dialog]')).not.toBeNull()
    );
  }
);
it('registers rich-text content feedback and never clears the other language', async () => {
  await mount('terms');
  await fill('versionId', 'v2');
  await fill('contentEn', 'Terms');
  await submit();
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.activeElement).toBe(field('contentFa'));
  });
  expect(field('contentEn').value).toBe('Terms');
  expect(writes()).toHaveLength(0);
});
it.each(['terms', 'templates'] as const)(
  '%s locks before delayed validation and cancels when work is replaced',
  async (domain) => {
    await mount(domain);
    if (domain === 'terms') await validTerms();
    else await fill('name', 'Local name');
    validation.hold = true;
    await submit();
    await vi.waitFor(() => expect(validation.release).toBeTypeOf('function'));
    expect(field(domain === 'terms' ? 'versionId' : 'name').matches(':disabled')).toBe(true);
    await submit();
    expect(writes()).toHaveLength(0);
    if (domain === 'terms') await act(async () => root.unmount());
    else await click('Refresh');
    await act(async () => validation.release!());
    expect(writes()).toHaveLength(0);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    if (domain === 'terms') root = createRoot(host);
  }
);
it.each(['terms', 'templates'] as const)(
  '%s maps owned server fields using local copy and retains all content',
  async (domain) => {
    await mount(domain);
    if (domain === 'terms') await validTerms();
    else await fill('name', 'Local name');
    status = 400;
    const name = domain === 'terms' ? 'contentFa' : 'description';
    result = {
      error: { code: 'VALIDATION:INPUT:INVALID', fields: [name], message: 'secret-untrusted' },
    };
    await submit();
    if (domain === 'templates') {
      await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).not.toBeNull());
      await click('Confirm');
    }
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.activeElement).toBe(field(name));
    });
    expect(field(name).getAttribute('aria-invalid')).toBe('true');
    expect(host.textContent).not.toContain('secret-untrusted');
    expect(field(domain === 'terms' ? 'contentEn' : 'name').value).toBe(
      domain === 'terms' ? 'Terms' : 'Local name'
    );
  }
);
it('keeps local template text when saved metadata changes, until explicit reset', async () => {
  await mount('templates');
  await fill('name', 'Local name');
  rows = [{ ...contractTemplate, name: 'Server changed' }];
  detail = { ...contractTemplateDetail, name: 'Server changed' };
  await click('Refresh');
  await vi.waitFor(() => expect(host.textContent).toContain('saved template changed'));
  expect(field('name').value).toBe('Local name');
  await submit();
  expect(writes()).toHaveLength(0);
  await click('Reset to saved content');
  expect(field('name').value).toBe('Server changed');
});
it.each(['terms', 'templates'] as const)(
  '%s blocks duplicate commands after unknown receipts until authoritative recovery',
  async (domain) => {
    await mount(domain);
    if (domain === 'terms') await validTerms();
    else await fill('name', 'Local name');
    await submit();
    if (domain === 'templates') {
      await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).not.toBeNull());
      await click('Confirm');
    }
    await vi.waitFor(() => expect(host.textContent).toContain('could not be verified'));
    await submit();
    expect(writes()).toHaveLength(1);
    if (domain === 'templates') {
      expect(
        document.querySelector<HTMLButtonElement>('[role=dialog] button[type=submit]')!.disabled
      ).toBe(true);
      await click('Refresh');
    } else await click('Refresh versions');
    await click('Reset to saved content');
    expect(field(domain === 'terms' ? 'versionId' : 'name').value).toBe(
      domain === 'terms' ? '' : contractTemplate.name
    );
  }
);
it.each(['terms', 'templates'] as const)(
  '%s treats a lost mutation response as unverified',
  async (domain) => {
    await mount(domain);
    if (domain === 'terms') await validTerms();
    else await fill('name', 'Local name');
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (path, init) => {
      if (init?.method) throw new Error('Disconnected');
      return original(path, init);
    });
    await submit();
    if (domain === 'templates') {
      await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).not.toBeNull());
      await click('Confirm');
    }
    await vi.waitFor(() => expect(host.textContent).toContain('could not be verified'));
    await submit();
    expect(writes()).toHaveLength(1);
  }
);
