import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SolarRequestPage } from './SolarRequestPage.js';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => () => Promise.resolve(),
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
