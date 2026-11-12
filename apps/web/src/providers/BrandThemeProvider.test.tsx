import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTheme } from '../hooks/useTheme.js';
import {
  THEME_DEFAULT_STORAGE_KEY,
  THEME_STORAGE_KEY,
  THEME_POLICY_STORAGE_KEY,
} from '../lib/theme.js';
import { BrandThemeProvider, getBrandTextColor, useBrandConfig } from './BrandThemeProvider.js';
import { BrandMark } from '../components/BrandMark.js';
let root: Root, host: HTMLDivElement;
const config = {
  appTitle: 'Saved brand',
  appTitleFa: 'نام ذخیره‌شده',
  supportEmail: 'help@example.com',
  supportPhone: '021-12345678',
  supportMobile: '09121234567',
  slogan: 'Saved slogan',
  primaryColor: '#777777',
  secondaryColor: '#ffffff',
  accentColor: '#000000',
  backgroundColor: '#eef2e8',
  darkBackgroundColor: '#101b17',
  fontFamily: 'tahoma',
  borderRadiusRem: 1,
  spacingScale: 1.125,
  logoUrl: null,
  faviconUrl: 'https://example.test/brand.ico',
  darkMode: true,
};

it('preserves readable brand text and falls back for insufficient surface contrast', () => {
  expect(getBrandTextColor('#176b5b', ['#f6f7f4', '#fdfefb', '#edf0eb'])).toBe('#176b5b');
  expect(getBrandTextColor('#777777', ['#f6f7f4', '#fdfefb', '#edf0eb'])).toBe('var(--foreground)');
  expect(getBrandTextColor('#777777', ['#15201c', '#1d2c25', '#293a30'])).toBe('var(--foreground)');
  expect(getBrandTextColor('#ffffff', ['#15201c', '#1d2c25', '#293a30'])).toBe('#ffffff');
});
function Consumer() {
  const { brandConfig, loading } = useBrandConfig();
  return (
    <p data-number-style={brandConfig.numberStyle}>{loading ? 'Loading' : brandConfig.appTitle}</p>
  );
}

it('changes palette and logo together on a live theme change while retaining existing input', async () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'dark');
  const dark = {
    ...config,
    themeMode: 'system',
    darkPrimaryColor: '#abcdef',
    darkSecondaryColor: '#fedcba',
    darkAccentColor: '#567890',
    logoUrl: 'https://assets.example.test/light.png',
    logoDarkUrl: 'https://assets.example.test/dark.png',
  };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(dark)));
  vi.stubGlobal('fetch', fetcher);
  function Live() {
    const { setTheme } = useTheme();
    return (
      <>
        <BrandMark />
        <input aria-label="Draft" defaultValue="captured" />
        <button onClick={() => setTheme('light')}>Light</button>
      </>
    );
  }
  await act(async () =>
    root.render(
      <BrandThemeProvider>
        <Live />
      </BrandThemeProvider>
    )
  );
  expect(host.querySelector('img')?.src).toBe(dark.logoDarkUrl);
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#abcdef');
  await act(async () => host.querySelector('button')!.click());
  expect(host.querySelector('img')?.src).toBe(dark.logoUrl);
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe(config.primaryColor);
  expect(host.querySelector('input')?.value).toBe('captured');
  expect(fetcher).toHaveBeenCalledOnce();
});
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
  localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'fa';
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
  expect(document.documentElement.style.getPropertyValue('--brand-light-background')).toBe(
    '#eef2e8'
  );
  expect(document.documentElement.style.getPropertyValue('--brand-dark-background')).toBe(
    '#101b17'
  );
  expect(document.documentElement.style.getPropertyValue('--app-font')).toBe('Tahoma');
  expect(document.documentElement.style.getPropertyValue('--radius')).toBe('1rem');
  expect(document.documentElement.style.getPropertyValue('--spacing')).toBe('0.28125rem');
  expect(document.title).toBe('نام ذخیره‌شده');
  await act(async () => {
    document.documentElement.lang = 'en';
  });
  expect(document.title).toBe('Saved brand');
});
it('refreshes after publication and restores the default favicon when removed', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(config)))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...config,
          appTitle: 'New brand',
          appTitleFa: 'نام جدید',
          faviconUrl: null,
          darkMode: false,
        })
      )
    );
  vi.stubGlobal('fetch', request);
  await mount();
  await act(async () => {
    window.dispatchEvent(new Event('barghsa:branding-activated'));
  });
  expect(document.title).toBe('نام جدید');
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
it('keeps the default dark text readable before branding is available', async () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'dark');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  await mount();
  const { style, classList } = document.documentElement;
  expect(classList.contains('dark')).toBe(true);
  expect(host.textContent).toBe('Barghsa');
  expect(style.getPropertyValue('--primary')).toBe('#176b5b');
  expect(style.getPropertyValue('--brand-primary-text-dark')).toBe('var(--foreground)');
  expect(style.getPropertyValue('--brand-primary-text-light')).toBe('#176b5b');
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
  expect(document.documentElement.style.getPropertyValue('--brand-light-background')).toBe('');
  expect(document.documentElement.style.getPropertyValue('--spacing')).toBe('');
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
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ...config, appTitle: 'Latest brand', appTitleFa: 'آخرین نام' }))
    )
    .mockRejectedValueOnce(new Error('Offline'));
  vi.stubGlobal('fetch', request);
  await mount();
  await act(async () => {
    window.dispatchEvent(new Event('barghsa:branding-activated'));
  });
  await act(async () => old(new Response(JSON.stringify(config))));
  expect(document.title).toBe('آخرین نام');
  await act(async () => {
    window.dispatchEvent(new Event('barghsa:branding-activated'));
  });
  expect(document.title).toBe('آخرین نام');
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

it('keeps the last validated number preference and accepts legacy locale defaults', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(config)))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...config, numberStyle: 'western' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...config, numberStyle: ['persian'] })));
  vi.stubGlobal('fetch', request);
  await mount();
  expect(host.querySelector('p')?.dataset.numberStyle).toBe('locale');
  await act(async () => window.dispatchEvent(new Event('barghsa:branding-activated')));
  expect(host.querySelector('p')?.dataset.numberStyle).toBe('western');
  await act(async () => window.dispatchEvent(new Event('barghsa:branding-activated')));
  expect(host.querySelector('p')?.dataset.numberStyle).toBe('western');
});

it('uses layout defaults for older published branding and rejects unreadable backgrounds', async () => {
  const legacy = { ...config } as Record<string, unknown>;
  for (const key of [
    'backgroundColor',
    'darkBackgroundColor',
    'fontFamily',
    'borderRadiusRem',
    'spacingScale',
  ])
    delete legacy[key];
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(legacy)))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...config, backgroundColor: '#15201c' })));
  vi.stubGlobal('fetch', request);
  await mount();
  expect(document.documentElement.style.getPropertyValue('--brand-light-background')).toBe(
    '#f6f7f4'
  );
  expect(document.documentElement.style.getPropertyValue('--app-font')).toBe("'Vazirmatn'");
  await act(async () => window.dispatchEvent(new Event('barghsa:branding-activated')));
  expect(document.documentElement.style.getPropertyValue('--brand-light-background')).toBe(
    '#f6f7f4'
  );
});

function ThemeControls() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  return (
    <>
      <output data-theme={theme} data-resolved={resolvedTheme} />
      {(['light', 'dark', 'system'] as const).map((mode) => (
        <button key={mode} onClick={() => setTheme(mode)}>
          {mode}
        </button>
      ))}
    </>
  );
}
async function themeControls(policy: 'light' | 'dark' | 'system') {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ ...config, themeMode: policy }))
      )
  );
  await act(async () =>
    root.render(
      <BrandThemeProvider>
        <ThemeControls />
      </BrandThemeProvider>
    )
  );
}
function deviceTheme(dark: boolean) {
  const media = Object.assign(new EventTarget(), { matches: dark });
  vi.stubGlobal('matchMedia', () => media);
  return media;
}
const currentTheme = () => host.querySelector('output')!.dataset.resolved;
async function choose(mode: string) {
  await act(async () =>
    [...host.querySelectorAll('button')].find((node) => node.textContent === mode)!.click()
  );
}
it('follows device changes, persists explicit choice and resumes device mode', async () => {
  const media = deviceTheme(true);
  await themeControls('system');
  expect(currentTheme()).toBe('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  await act(async () => {
    media.matches = false;
    media.dispatchEvent(new Event('change'));
  });
  expect(currentTheme()).toBe('light');
  await choose('dark');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  await act(async () => media.dispatchEvent(new Event('change')));
  expect(currentTheme()).toBe('dark');
  await choose('system');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  expect(currentTheme()).toBe('light');
});
it('applies the published default when a user clears their preference', async () => {
  deviceTheme(false);
  await themeControls('system');
  expect(currentTheme()).toBe('light');
  await choose('light');
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ ...config, themeMode: 'system', themeDefault: 'dark' }))
  );
  await act(async () => window.dispatchEvent(new Event('barghsa:branding-activated')));
  expect(localStorage.getItem(THEME_DEFAULT_STORAGE_KEY)).toBe('dark');
  expect(currentTheme()).toBe('light');
  await choose('system');
  expect(currentTheme()).toBe('dark');
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ ...config, themeMode: 'system' }))
  );
  await act(async () => window.dispatchEvent(new Event('barghsa:branding-activated')));
  expect(currentTheme()).toBe('light');
  expect(localStorage.getItem(THEME_DEFAULT_STORAGE_KEY)).toBe('system');
});
it('restores a saved browser preference and synchronizes another tab without changing admin authority', async () => {
  deviceTheme(true);
  localStorage.setItem(THEME_STORAGE_KEY, 'light');
  await themeControls('system');
  expect(currentTheme()).toBe('light');
  await act(async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }));
  });
  expect(currentTheme()).toBe('dark');
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ ...config, themeMode: 'light' }))
  );
  await act(async () => window.dispatchEvent(new Event('barghsa:branding-activated')));
  expect(currentTheme()).toBe('light');
  expect(localStorage.getItem(THEME_POLICY_STORAGE_KEY)).toBe('light');
  await choose('dark');
  expect(currentTheme()).toBe('light');
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ ...config, themeMode: 'system' }))
  );
  await act(async () => window.dispatchEvent(new Event('barghsa:branding-activated')));
  expect(currentTheme()).toBe('dark');
});
it('keeps device and in-memory controls working when browser storage is unavailable', async () => {
  deviceTheme(true);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  await themeControls('system');
  expect(currentTheme()).toBe('dark');
  await choose('light');
  expect(currentTheme()).toBe('light');
  vi.restoreAllMocks();
});
it('retains a legacy forced policy and rejects invalid published policy without partial changes', async () => {
  deviceTheme(false);
  localStorage.setItem(THEME_STORAGE_KEY, 'light');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(config))));
  await act(async () =>
    root.render(
      <BrandThemeProvider>
        <ThemeControls />
      </BrandThemeProvider>
    )
  );
  expect(currentTheme()).toBe('dark');
  vi.mocked(fetch).mockResolvedValue(
    new Response(JSON.stringify({ ...config, themeMode: 'automatic', primaryColor: '#123456' }))
  );
  await act(async () => window.dispatchEvent(new Event('barghsa:branding-activated')));
  expect(currentTheme()).toBe('dark');
  expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#777777');
});

it('uses fallback branding after a stalled body and ignores a late brand receipt', async () => {
  vi.useFakeTimers();
  try {
    let signal!: AbortSignal;
    let resolveBody!: (value: unknown) => void;
    const fetcher = vi.fn((_url: string, options: RequestInit) => {
      signal = options.signal!;
      return Promise.resolve({
        ok: true,
        json: () =>
          new Promise((resolve) => {
            resolveBody = resolve;
          }),
      });
    });
    vi.stubGlobal('fetch', fetcher);
    await mount();
    expect(host.textContent).toBe('Loading');
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(signal.aborted).toBe(true);
    expect(host.textContent).not.toBe('Loading');
    await act(async () => resolveBody(config));
    expect(host.textContent).not.toBe(config.appTitle);
    expect(fetcher).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
