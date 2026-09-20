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
])('rejects invalid %s without issuing a write', async (field, value) => {
  await render();
  await change(field, value);
  await submit();
  expect(host.querySelector(`[id$="-${field}"]`)?.getAttribute('aria-invalid')).toBe('true');
  expect(host.querySelector('[role=alert]')).not.toBeNull();
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
