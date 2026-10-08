import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CrmAddressEditor, type EditableCrmAddress } from './CrmAddressEditor.js';

const address: EditableCrmAddress = {
  id: 'address-one',
  provinceId: 'province-one',
  cityId: 'city-one',
  fullAddress: 'Original street',
  postalCode: '1234567890',
  mainAddress: true,
  provinceName: { nameFa: 'استان قبلی', nameEn: 'Original province' },
  cityName: { nameFa: 'شهر قبلی', nameEn: 'Original city' },
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00.123456Z',
};
let host: HTMLDivElement, root: Root;
const onSaved = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  onSaved.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]'))
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  document.documentElement.lang = 'en';
});
async function render() {
  await act(async () =>
    root.render(
      <QueryProvider>
        <CrmAddressEditor
          profileId="profile-one"
          address={address}
          onCancel={vi.fn()}
          onSaved={onSaved}
        />
      </QueryProvider>
    )
  );
}
const field = (name: string) =>
  host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
async function change(name: string, value: string) {
  const input = field(name);
  await act(async () => {
    const proto =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
it.each([
  ['fullAddress', ' '],
  ['fullAddress', 'x'.repeat(501)],
  ['postalCode', '0123456789'],
  ['postalCode', '123'],
])('rejects and focuses invalid %s before confirmation', async (name, value) => {
  await render();
  await change(name, value);
  await submit();
  expect(field(name).getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(field(name).getAttribute('aria-describedby')!)).not.toBeNull();
  await act(
    async () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
      )
  );
  expect(document.activeElement).toBe(field(name));
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(onSaved).not.toHaveBeenCalled();
});
it('allows text repair at a historical location while catalogues are unavailable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 503 }))
  );
  await render();
  await change('fullAddress', 'Repaired street');
  await submit();
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('Repaired street');
  expect(host.querySelector('fieldset')?.disabled).toBe(true);
});
it.each(['en', 'fa'])(
  'retains and focuses the address after a public server rejection (%s)',
  async (locale) => {
    document.documentElement.lang = locale;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'PUT'
          ? new Response(
              JSON.stringify({
                error: {
                  code: 'VALIDATION:INPUT:INVALID',
                  fields: ['postalCode'],
                  message: 'private detail',
                },
              }),
              { status: 400 }
            )
          : new Response('[]')
      )
    );
    await render();
    await change('fullAddress', 'Draft street');
    await change('postalCode', '2345678901');
    await submit();
    await act(async () =>
      document
        .querySelector('[role=dialog] form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    await act(
      async () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(field('fullAddress').value).toBe('Draft street');
    expect(field('postalCode').value).toBe('2345678901');
    expect(field('postalCode').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field('postalCode'));
    expect(host.querySelector('fieldset')?.disabled).toBe(false);
    expect(host.textContent).not.toContain('private detail');
    expect(onSaved).not.toHaveBeenCalled();
    await change('postalCode', '3456789012');
    expect(field('postalCode').getAttribute('aria-invalid')).not.toBe('true');
  }
);
