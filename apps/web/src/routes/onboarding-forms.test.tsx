import { act, type ComponentType, type ReactNode } from 'react';
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Route as IndividualRoute } from './onboarding/individual/$profileId.js';
import { Route as LegalRoute } from './onboarding/legal/$profileId.js';
import { THEME_POLICY_STORAGE_KEY } from '../lib/theme.js';
import { brandSettings } from '../test/branding-settings-fixtures.js';
import { renderWorkspace } from '../test/render-workspace.js';

const profileId = '11111111-1111-4111-8111-111111111111';
const accountId = 'onboarding-owner';
const routing = vi.hoisted(() => ({ step: 1, navigate: vi.fn(async () => {}) }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({ onboardingUserId: accountId }),
    useSearch: () => ({ step: routing.step }),
  }),
  useBlocker: () => ({ status: 'idle' }),
  useParams: () => ({ profileId }),
  useRouter: () => routing,
  Link: ({ children }: { children: ReactNode }) => children,
}));

const provinces = [
  { id: 'tehran', nameFa: 'تهران', nameEn: 'Tehran' },
  { id: 'fars', nameFa: 'فارس', nameEn: 'Fars' },
];
const cities = {
  tehran: [{ id: 'rey', provinceId: 'tehran', nameFa: 'ری', nameEn: 'Rey' }],
  fars: [{ id: 'shiraz', provinceId: 'fars', nameFa: 'شیراز', nameEn: 'Shiraz' }],
};
const scenarios = [
  {
    type: 'individual',
    route: IndividualRoute,
    step: 2,
    province: 'provinceId',
    city: 'cityId',
    postalCode: 'postalCode',
    draft: {
      firstName: 'Person',
      lastName: 'Owner',
      nationalId: '1234567891',
      provinceId: 'tehran',
      cityId: 'rey',
      fullAddress: 'Personal Street',
      postalCode: '1234567890',
    },
  },
  {
    type: 'legal',
    route: LegalRoute,
    step: 3,
    province: 'officialProvinceId',
    city: 'officialCityId',
    postalCode: 'officialPostalCode',
    draft: {
      representativeFirstName: 'Person',
      representativeLastName: 'Owner',
      representativeNationalId: '1234567891',
      legalName: 'Test Company',
      officialProvinceId: 'tehran',
      officialCityId: 'rey',
      officialFullAddress: 'Company Street',
      officialPostalCode: '1234567890',
    },
  },
] as const;

let host: HTMLDivElement;
let previousLocale: string, previousDirection: string, previousThemePolicy: string | null;
beforeEach(() => {
  routing.navigate.mockClear();
  previousLocale = document.documentElement.lang;
  previousDirection = document.documentElement.dir;
  previousThemePolicy = localStorage.getItem(THEME_POLICY_STORAGE_KEY);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.lang = previousLocale;
  document.documentElement.dir = previousDirection;
  if (previousThemePolicy === null) localStorage.removeItem(THEME_POLICY_STORAGE_KEY);
  else localStorage.setItem(THEME_POLICY_STORAGE_KEY, previousThemePolicy);
});

function fixture(data: Record<string, string>) {
  const writes: { expectedVersion: number; data: Record<string, string> }[] = [];
  const paths: string[] = [];
  let draft = { version: 4, data };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      paths.push(path);
      if (path === '/api/public/branding/config') return Response.json(brandSettings);
      if (path === '/api/geography/provinces') return Response.json(provinces);
      if (path === '/api/geography/provinces/tehran/cities') return Response.json(cities.tehran);
      if (path === '/api/geography/provinces/fars/cities') return Response.json(cities.fars);
      if (path === '/api/geography/company-types')
        return Response.json([{ id: 'limited', nameFa: 'محدود', nameEn: 'Limited' }]);
      if (path === '/api/user/settings/timezone') return Response.json({ timezone: 'Asia/Tehran' });
      if (path === `/api/onboarding/draft/${profileId}`) {
        if (init?.method === 'PUT') {
          const command = JSON.parse(String(init.body)) as (typeof writes)[number];
          expect(init.credentials).toBe('include');
          expect(command.expectedVersion).toBe(draft.version);
          writes.push(command);
          draft = { version: draft.version + 1, data: command.data };
        }
        return Response.json(draft);
      }
      return Response.json({}, { status: 404 });
    })
  );
  return { paths, writes };
}

it.each(scenarios)('validates and saves the $type address through the wizard', async (scenario) => {
  routing.step = scenario.step;
  const state = fixture(scenario.draft);
  const Page = scenario.route.options.component as ComponentType;
  const view = renderWorkspace(<Page />, host, accountId);
  const province = (await view.findByRole('combobox', { name: 'Province' })) as HTMLSelectElement;
  const city = view.getByRole('combobox', { name: 'City' }) as HTMLSelectElement;
  await waitFor(() => expect(city.value).toBe('rey'));
  expect(province.value).toBe('tehran');

  fireEvent.change(province, { target: { value: 'fars' } });
  expect(city.value).toBe('');
  await view.findByRole('option', { name: 'Shiraz' });
  expect(view.queryByRole('option', { name: 'Rey' })).toBeNull();
  fireEvent.change(city, { target: { value: 'shiraz' } });

  const postalCode = view.getByRole('textbox', { name: 'Postal Code' });
  const next = view.getByRole('button', { name: 'Save and continue' });
  fireEvent.change(postalCode, { target: { value: '12' } });
  await act(async () => fireEvent.click(next));
  await waitFor(() => expect(postalCode.getAttribute('aria-invalid')).toBe('true'));
  const error = document.getElementById(postalCode.getAttribute('aria-describedby') ?? '');
  expect(error?.getAttribute('role')).toBe('alert');
  expect(error?.textContent).toMatch(/postal code/i);
  expect(routing.navigate).not.toHaveBeenCalled();

  fireEvent.change(postalCode, { target: { value: '1234567890' } });
  await act(async () => fireEvent.click(next));
  await waitFor(() =>
    expect(routing.navigate).toHaveBeenCalledExactlyOnceWith({
      to: `/onboarding/${scenario.type}/$profileId`,
      params: { profileId },
      search: { step: scenario.step + 1 },
    })
  );
  expect(state.writes.at(-1)?.data).toMatchObject({
    [scenario.province]: 'fars',
    [scenario.city]: 'shiraz',
    [scenario.postalCode]: '1234567890',
  });
  expect(state.paths).toContain('/api/geography/provinces/fars/cities');
  expect(state.paths).not.toContain(`/api/onboarding/${scenario.type}/${profileId}`);
});
