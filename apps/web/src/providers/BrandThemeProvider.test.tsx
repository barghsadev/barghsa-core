import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BrandThemeProvider, useBrandConfig } from './BrandThemeProvider.js';
let root: Root, host: HTMLDivElement;
const config = {
  appTitle: 'Saved brand',
  slogan: 'Saved slogan',
  primaryColor: '#777777',
  secondaryColor: '#ffffff',
  accentColor: '#000000',
  logoUrl: null,
  faviconUrl: 'https://example.test/brand.ico',
  darkMode: true,
};
function Consumer() {
  const { brandConfig, loading } = useBrandConfig();
  return <p>{loading ? 'Loading' : brandConfig.appTitle}</p>;
}
async function mount() {
  await act(async () => {
    root.render(
      <BrandThemeProvider>
        <Consumer />
      </BrandThemeProvider>
    );
  });
}
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  document.title = 'Original app';
  document.documentElement.style.setProperty('--primary', '#123456');
  const icon = document.createElement('link');
  icon.rel = 'icon';
  icon.href = '/original.ico';
  document.head.append(icon);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark');
  document.querySelectorAll('link[rel="icon"]').forEach((node) => node.remove());
});
it('connects published colors to component tokens and chooses readable foregrounds', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(config))));
  await mount();
  expect(host.textContent).toBe('Saved brand');
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#777777');
  expect(document.documentElement.style.getPropertyValue('--brand-primary-foreground')).toBe(
    '#000000'
  );
  expect(document.documentElement.style.getPropertyValue('--secondary-foreground')).toBe('#000000');
  expect(document.documentElement.style.getPropertyValue('--accent-foreground')).toBe('#ffffff');
});
it('refreshes after publication and restores the default favicon when removed', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(config)))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...config, appTitle: 'New brand', faviconUrl: null, darkMode: false })
      )
    );
  vi.stubGlobal('fetch', request);
  await mount();
  await act(async () => {
    window.dispatchEvent(new Event('barghsa:branding-activated'));
  });
  expect(document.title).toBe('New brand');
  expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/original.ico');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
});
it('restores document properties on unmount and ignores a late reply', async () => {
  let resolve!: (value: Response) => void;
  const request = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      })
  );
  vi.stubGlobal('fetch', request);
  await mount();
  await act(async () => root.unmount());
  await act(async () => resolve(new Response(JSON.stringify(config))));
  expect(document.title).toBe('Original app');
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#123456');
  expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/original.ico');
});
it('ignores malformed branding instead of partially applying it', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ...config, primaryColor: 'broken', logoUrl: 'javascript:alert(1)' })
        )
      )
  );
  await mount();
  expect(document.title).toBe('Original app');
  expect(host.textContent).toBe('Barghsa');
});

it('restores preexisting document styles, title and icon after a successful mount', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(config))));
  await mount();
  await act(async () => root.unmount());
  expect(document.title).toBe('Original app');
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#123456');
  expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBe('');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/original.ico');
});
it('ignores an older refresh reply and retains the last valid theme on network failure', async () => {
  let old!: (value: Response) => void;
  const request = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          old = done;
        })
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...config, appTitle: 'Latest brand' })))
    .mockRejectedValueOnce(new Error('Offline'));
  vi.stubGlobal('fetch', request);
  await mount();
  await act(async () => {
    window.dispatchEvent(new Event('barghsa:branding-activated'));
  });
  await act(async () => old(new Response(JSON.stringify(config))));
  expect(document.title).toBe('Latest brand');
  await act(async () => {
    window.dispatchEvent(new Event('barghsa:branding-activated'));
  });
  expect(document.title).toBe('Latest brand');
  expect(host.textContent).toBe('Latest brand');
});
it('removes a dynamically created icon when the next active config has no icon', async () => {
  document.querySelector('link[rel="icon"]')!.remove();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(config)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...config, faviconUrl: null })))
  );
  await mount();
  expect(document.querySelector('link[rel="icon"]')).not.toBeNull();
  await act(async () => {
    window.dispatchEvent(new Event('barghsa:branding-activated'));
  });
  expect(document.querySelector('link[rel="icon"]')).toBeNull();
});
