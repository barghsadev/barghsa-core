import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SolarRequestPage } from './SolarRequestPage.js';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => () => Promise.resolve(),
  Link: ({
    children,
    to,
    onClick,
  }: {
    children: React.ReactNode;
    to: string;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a href={to} onClick={onClick}>
      {children}
    </a>
  ),
}));

afterEach(() => vi.unstubAllGlobals());

it.each(['fa', 'en'] as const)(
  'shows conditional solar intake fields and stages in %s',
  async (locale) => {
    document.documentElement.lang = locale;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/solar/requests/draft?profileId=profile-1')
          return new Response(JSON.stringify({ currentStep: 1, data: null, updatedAt: null }));
        if (url === '/api/profiles')
          return new Response(
            JSON.stringify({ activeProfileId: 'profile-1', profiles: [{ id: 'profile-1' }] })
          );
        if (url === '/api/profiles/profile-1/addresses')
          return new Response(
            JSON.stringify({
              addresses: [{ id: 'address-1', fullAddress: 'Test site', postalCode: '1234567890' }],
            })
          );
        throw new Error(`Unexpected ${url}`);
      })
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<SolarRequestPage />));
      expect(container.textContent).toContain(
        locale === 'fa'
          ? 'نوع نیروگاه خورشیدی مورد نظر خودتان را انتخاب کنید.'
          : 'Choose the type of solar power station you want.'
      );
      expect(container.querySelector('#solar-bill')).not.toBeNull();
      expect(container.querySelector('#solar-units')).not.toBeNull();
      expect(container.querySelector('ol')?.children).toHaveLength(5);
      const submit = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      await act(async () =>
        (container.querySelector('input[value="non_household"]') as HTMLInputElement).click()
      );
      expect(container.querySelector('#solar-units')).toBeNull();
      expect(container.querySelector('#solar-area')).not.toBeNull();
      await act(async () =>
        (container.querySelector('input[value="off_grid"]') as HTMLInputElement).click()
      );
      expect(container.querySelector('#solar-bill')).toBeNull();
      expect(container.textContent).toContain(
        locale === 'fa' ? 'تجهیزات ذخیره‌سازی' : 'storage equipment'
      );
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  }
);

it('restores a solar draft before showing the form', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const data = {
    buildingType: 'non_household',
    propertyForm: 'apartment',
    structuralFrame: 'steel',
    buildingCompletionDate: '',
    totalUnits: '',
    siteCategory: 'industrial',
    installationSurface: 'rooftop',
    usableAreaSqm: '250',
    siteAddressId: 'address-1',
    siteRelationship: 'tenant',
    siteDescription: 'Roof survey pending',
    gridType: 'off_grid',
    billIdentifier: '',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/profiles')
        return new Response(
          JSON.stringify({ activeProfileId: 'profile-1', profiles: [{ id: 'profile-1' }] })
        );
      if (url === '/api/profiles/profile-1/addresses')
        return new Response(
          JSON.stringify({
            addresses: [{ id: 'address-1', fullAddress: 'Test site', postalCode: '1234567890' }],
          })
        );
      if (url === '/api/solar/requests/draft?profileId=profile-1')
        return new Response(
          JSON.stringify({ currentStep: 1, data, updatedAt: new Date().toISOString() })
        );
      throw new Error(`Unexpected ${url}`);
    })
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SolarRequestPage />));
    expect(container.querySelector('#solar-area')).not.toBeNull();
    expect((container.querySelector('#solar-area') as HTMLInputElement).value).toBe('250');
    expect(container.textContent).toContain('Roof survey pending');
    expect(container.querySelector('#solar-bill')).toBeNull();
    expect(container.querySelector('input[type="checkbox"]')?.hasAttribute('checked')).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('keeps entered solar details when draft saving fails', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/profiles')
        return new Response(
          JSON.stringify({ activeProfileId: 'profile-1', profiles: [{ id: 'profile-1' }] })
        );
      if (url === '/api/profiles/profile-1/addresses')
        return new Response(
          JSON.stringify({
            addresses: [{ id: 'address-1', fullAddress: 'Test site', postalCode: '1234567890' }],
          })
        );
      if (url === '/api/solar/requests/draft?profileId=profile-1')
        return options?.method === 'PUT'
          ? new Response(null, { status: 503 })
          : new Response(JSON.stringify({ currentStep: 1, data: null, updatedAt: null }));
      throw new Error(`Unexpected ${url}`);
    })
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SolarRequestPage />));
    await act(async () =>
      (container.querySelector('input[value="non_household"]') as HTMLInputElement).click()
    );
    await vi.waitFor(
      () => expect(container.textContent).toContain('Your progress could not be saved'),
      { timeout: 2500 }
    );
    expect(
      (container.querySelector('input[value="non_household"]') as HTMLInputElement).checked
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
