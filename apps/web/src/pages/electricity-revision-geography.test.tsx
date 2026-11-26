import { approveVisibleConfirmation } from '../test/confirmation.js';
import { fireEvent, within } from '@testing-library/dom';
import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ElectricityOrderRevisionForm } from './ElectricityOrderRevisionForm.js';
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, irrDigits: String }),
}));
let host: HTMLDivElement, root: Root;
const order = {
  orderId: 'order-1',
  profileId: 'profile-1',
  mode: 'simple',
  versionId: 'version-1',
  periodStart: '2026-10-04T00:00:00Z',
  periodEnd: '2026-10-11T00:00:00Z',
  totalKwh: '10',
  totalIrR: '100',
  provinceId: 'p1',
  cityId: 'c1',
  fullAddress: 'Retained address',
  postalCode: '1234567890',
};
const provinces = [
  { id: 'p1', nameFa: 'استان یک', nameEn: 'One' },
  { id: 'p2', nameFa: 'استان دو', nameEn: 'Two' },
];
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const city = () => host.querySelector<HTMLInputElement>('#revision-city')!;
const responseNote = () => host.querySelector<HTMLTextAreaElement>('#revision-note')!;
async function select(id: string, name: string) {
  const input = host.querySelector<HTMLInputElement>(id)!;
  await act(async () => input.focus());
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  const option = await within(document.body).findByRole('option', { name });
  await act(async () => fireEvent.click(option));
}
async function note() {
  const element = responseNote();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      element,
      'Reviewed correction'
    );
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const preview = () => host.querySelector<HTMLButtonElement>('button[type=submit]')!;
it('blocks a changed province until its bound city list recovers and preserves all other terms', async () => {
  let valid = false;
  const requests = vi.fn(async (path: string) => {
    if (path.includes('/periods/'))
      return Response.json({
        periods: [{ key: 'next_week', start: order.periodStart, end: order.periodEnd }],
      });
    if (path.endsWith('/provinces')) return Response.json(provinces);
    if (path.endsWith('/p1/cities'))
      return Response.json([{ id: 'c1', provinceId: 'p1', nameFa: 'شهر یک', nameEn: 'City one' }]);
    if (path.endsWith('/p2/cities'))
      return Response.json([
        { id: 'c2', provinceId: valid ? 'p2' : 'p1', nameFa: 'شهر دو', nameEn: 'City two' },
      ]);
    return Response.json({
      reviewDigest: 'a'.repeat(64),
      totalIrR: '100',
      totalKwh: '10',
      subtotalIrR: '100',
      discountIrR: '0',
      vatIrR: '0',
      lines: [],
    });
  });
  vi.stubGlobal('fetch', requests);
  await act(async () =>
    root.render(
      <QueryProvider>
        <ElectricityOrderRevisionForm order={order} onComplete={() => {}} />
      </QueryProvider>
    )
  );
  await note();
  await select('#revision-province', 'Two');
  expect(city().disabled).toBe(true);
  expect(preview().disabled).toBe(true);
  await approveVisibleConfirmation();
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(requests.mock.calls.some(([path]) => path.endsWith('/revision-preview'))).toBe(false);
  valid = true;
  await approveVisibleConfirmation();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid=electricity-revision-city-retry]')!.click()
  );
  await select('#revision-city', 'City two');
  expect(preview().disabled).toBe(false);
  expect(host.querySelector<HTMLTextAreaElement>('#revision-address')!.value).toBe(
    'Retained address'
  );
  expect(responseNote().value).toBe('Reviewed correction');
  await approveVisibleConfirmation();
  await act(async () => preview().click());
  await vi.waitFor(() =>
    expect(requests.mock.calls.filter(([path]) => path.endsWith('/revision-preview'))).toHaveLength(
      1
    )
  );
});
it('allows review of an unchanged historical address while geography is unavailable', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      path.includes('/periods/')
        ? Response.json({
            periods: [{ key: 'next_week', start: order.periodStart, end: order.periodEnd }],
          })
        : Response.json({}, { status: 503 })
    )
  );
  await act(async () =>
    root.render(
      <QueryProvider>
        <ElectricityOrderRevisionForm order={order} onComplete={() => {}} />
      </QueryProvider>
    )
  );
  await note();
  expect(city().value).toBe('Current city');
  expect(preview().disabled).toBe(false);
});
