import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CrmLegalEditor } from './CrmLegalEditor.js';
import type { LegalInfo } from '../pages/CrmProfileDetail.js';

let host: HTMLDivElement, root: Root;
const onSaved = vi.fn(),
  onCancel = vi.fn();
const legal: LegalInfo = {
  legalName: 'Company',
  nationalIdentifier: '12345678901',
  registrationNumber: '123',
  companyTypeId: null,
  companyTypeName: null,
  registrationDate: '2025-01-01',
  economicCode: '123',
  officialPhone: '123',
  officialEmail: 'old@example.com',
  officialProvinceId: null,
  officialCityId: null,
  officialFullAddress: 'Address',
  officialPostalCode: '1234567891',
  officialProvinceName: null,
  officialCityName: null,
  representativeHonorific: null,
  representativeFirstName: 'First',
  representativeLastName: 'Last',
  representativeNationalId: '0013547890',
  representativeProvinceId: null,
  representativeCityId: null,
  representativeProvinceName: null,
  representativeCityName: null,
  representativeFullAddress: 'Address',
  representativePostalCode: '1234567891',
  createdAt: '2026-09-01T00:00:00.000000Z',
  updatedAt: '2026-09-01T00:00:00.000000Z',
  representativeTitle: 'Director',
  representativeRelationship: 'Employee',
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]'))
  );
  onSaved.mockReset();
  onCancel.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  document.documentElement.lang = 'en';
});
async function render(info = legal) {
  await act(async () =>
    root.render(
      <CrmLegalEditor
        profileId="profile-one"
        legalInfo={info}
        onSaved={onSaved}
        onCancel={onCancel}
        returnFocus={createRef()}
      />
    )
  );
}
async function change(field: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    `[id$="-${field}"]`
  )!;
  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : input instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
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
  ['registrationNumber', ''],
  ['registrationNumber', 'x'.repeat(51)],
  ['officialEmail', 'broken'],
  ['officialPostalCode', '0000000000'],
  ['representativeNationalId', '1111111111'],
  ['representativeFirstName', ' '],
  ['representativeFullAddress', 'x'.repeat(501)],
  ['officialEmail', 'a @example.com'],
  ['officialEmail', 'a..b@example.com'],
])('rejects invalid %s without issuing a write', async (field, value) => {
  await render();
  await change(field, value);
  await submit();
  expect(host.querySelector(`[id$="-${field}"]`)?.getAttribute('aria-invalid')).toBe('true');
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  await act(
    async () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
      )
  );
  expect(document.activeElement).toBe(host.querySelector(`[id$="-${field}"]`));
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(onSaved).not.toHaveBeenCalled();
  for (const [, init] of vi.mocked(fetch).mock.calls) expect(init?.method ?? 'GET').toBe('GET');
});
it.each(['en', 'fa'])(
  'normalizes changed email and requires confirmation before writing (%s)',
  async (locale) => {
    document.documentElement.lang = locale;
    await render();
    await change('officialEmail', ' NEW@EXAMPLE.COM ');
    await submit();
    const dialog = document.querySelector('[role=dialog]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain('new@example.com');
    expect(host.querySelector('fieldset')?.disabled).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    for (const [, init] of vi.mocked(fetch).mock.calls) expect(init?.method ?? 'GET').toBe('GET');
  }
);
it('does not propose an unchanged or whitespace-only normalized change', async () => {
  await render();
  await submit();
  expect(document.querySelector('[role=dialog]')).toBeNull();
  await change('registrationNumber', ' 123 ');
  await submit();
  expect(document.querySelector('[role=dialog]')).toBeNull();
});
it('allows explicitly clearing a nullable contact field', async () => {
  await render();
  await change('officialPhone', '');
  await submit();
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('→ —');
  expect(onSaved).not.toHaveBeenCalled();
});
it('retains unknown current geography and exposes failed option loads', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 503 }))
  );
  await render({
    ...legal,
    companyTypeId: 'old-type',
    companyTypeName: { nameEn: 'Retired company', nameFa: 'شرکت' },
  });
  expect(host.querySelector('select')?.textContent).toContain('Retired company');
  expect(host.querySelector('select')?.disabled).toBe(true);
  expect(host.querySelector('[role=alert]')).not.toBeNull();
});

it('revalidates a touched field while retaining other company changes', async () => {
  await render();
  await change('registrationNumber', 'NEW-REG');
  await change('officialEmail', 'broken');
  const email = host.querySelector<HTMLInputElement>('[id$="-officialEmail"]')!;
  await act(async () => email.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  expect(email.getAttribute('aria-invalid')).toBe('true');
  expect(document.getElementById(email.getAttribute('aria-describedby')!)?.textContent).toContain(
    'valid'
  );
  await change('officialEmail', 'fixed@example.test');
  expect(email.getAttribute('aria-invalid')).not.toBe('true');
  expect(host.querySelector<HTMLInputElement>('[id$="-registrationNumber"]')!.value).toBe(
    'NEW-REG'
  );
  await submit();
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('fixed@example.test');
});
it.each(['en', 'fa'])(
  'returns public server errors to the retained company draft (%s)',
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
                  fields: ['officialEmail'],
                  message: 'private database detail',
                },
              }),
              { status: 400 }
            )
          : new Response('[]')
      )
    );
    await render();
    await change('registrationNumber', 'NEW-REG');
    await change('officialEmail', 'draft@example.test');
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
    const email = host.querySelector<HTMLInputElement>('[id$="-officialEmail"]')!;
    expect(email.value).toBe('draft@example.test');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(email);
    expect(host.querySelector('fieldset')?.disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>('[id$="-registrationNumber"]')!.value).toBe(
      'NEW-REG'
    );
    expect(host.textContent).not.toContain('private database detail');
    expect(onSaved).not.toHaveBeenCalled();
    await change('officialEmail', 'corrected@example.test');
    expect(email.getAttribute('aria-invalid')).not.toBe('true');
  }
);

it('keeps unknown or protected server fields in generic confirmation feedback', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Response(
            JSON.stringify({
              error: {
                code: 'VALIDATION:INPUT:INVALID',
                fields: ['officialEmail', 'nationalIdentifier'],
                message: 'private detail',
              },
            }),
            { status: 400 }
          )
        : new Response('[]')
    )
  );
  await render();
  await change('officialEmail', 'draft@example.test');
  await submit();
  await act(async () =>
    document
      .querySelector('[role=dialog] form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(document.querySelector('[role=dialog] [role=alert]')?.textContent).toContain(
    'could not be completed'
  );
  expect(host.querySelector<HTMLInputElement>('[id$="-officialEmail"]')!.value).toBe(
    'draft@example.test'
  );
  expect(
    host.querySelector<HTMLInputElement>('[id$="-officialEmail"]')!.getAttribute('aria-invalid')
  ).not.toBe('true');
  expect(document.body.textContent).not.toContain('private detail');
  expect(onSaved).not.toHaveBeenCalled();
});
