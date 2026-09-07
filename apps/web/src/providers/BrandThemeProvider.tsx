import type { NumberStyle } from '@barghsa/i18n/numbers';
import { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrandConfig {
  appTitle: string;
  slogan: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  darkMode: boolean;
  numberStyle: NumberStyle;
}

const DEFAULT_BRAND_CONFIG: BrandConfig = {
  appTitle: 'Barghsa',
  slogan: '',
  primaryColor: '#2563eb',
  secondaryColor: '#64748b',
  accentColor: '#f59e0b',
  logoUrl: null,
  faviconUrl: null,
  darkMode: false,
  numberStyle: 'locale',
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface BrandThemeContextValue {
  brandConfig: BrandConfig;
  loading: boolean;
}

const BrandThemeContext = createContext<BrandThemeContextValue>({
  brandConfig: DEFAULT_BRAND_CONFIG,
  loading: true,
});

/**
 * Hook to read the current brand config from context.
 * Components calling this will re-render when brand config changes.
 */
export function useBrandConfig(): BrandThemeContextValue {
  return useContext(BrandThemeContext);
}

/** Pick the higher WCAG contrast ratio against the configured sRGB background. */
function getContrastForeground(hex: string): string {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}

function validAsset(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 2048) return false;
  if (/^\/api\/public\/branding\/assets\/[a-f0-9-]{36}\/[a-f0-9]{64}$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
function parseBrand(value: unknown): BrandConfig | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.appTitle !== 'string' ||
    !data.appTitle.length ||
    data.appTitle.length > 100 ||
    typeof data.slogan !== 'string' ||
    data.slogan.length > 200 ||
    typeof data.darkMode !== 'boolean'
  )
    return null;
  for (const field of ['primaryColor', 'secondaryColor', 'accentColor'])
    if (typeof data[field] !== 'string' || !/^#[a-f0-9]{6}$/i.test(data[field])) return null;
  if (!validAsset(data.logoUrl) || !validAsset(data.faviconUrl)) return null;
  const numberStyle = data.numberStyle ?? 'locale';
  if (typeof numberStyle !== 'string' || !['locale', 'persian', 'western'].includes(numberStyle))
    return null;
  return { ...data, numberStyle } as unknown as BrandConfig;
}

/** Apply validated active branding and restore document ownership on unmount. */
export function BrandThemeProvider({ children }: { children: ReactNode }) {
  const [brandConfig, setBrandConfig] = useState<BrandConfig>(DEFAULT_BRAND_CONFIG);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const root = document.documentElement;
    const colors = ['primary', 'secondary', 'accent'] as const;
    const properties = colors.flatMap((color) => [
      `--brand-${color}`,
      `--brand-${color}-foreground`,
      `--${color}`,
      `--${color}-foreground`,
    ]);
    const previous = properties.map((name) => ({
      name,
      value: root.style.getPropertyValue(name),
      priority: root.style.getPropertyPriority(name),
    }));
    const title = document.title,
      dark = root.classList.contains('dark');
    const originalIcon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const originalHref = originalIcon?.getAttribute('href') ?? null;
    let icon = originalIcon,
      request: AbortController | null = null;
    const resetIcon = () => {
      if (originalIcon) {
        if (originalHref === null) originalIcon.removeAttribute('href');
        else originalIcon.setAttribute('href', originalHref);
      } else {
        icon?.remove();
        icon = null;
      }
    };
    const apply = (config: BrandConfig) => {
      for (const color of colors) {
        const background = config[`${color}Color`],
          foreground = getContrastForeground(background);
        root.style.setProperty(`--brand-${color}`, background);
        root.style.setProperty(`--brand-${color}-foreground`, foreground);
        root.style.setProperty(`--${color}`, background);
        root.style.setProperty(`--${color}-foreground`, foreground);
      }
      root.classList.toggle('dark', config.darkMode);
      document.title = config.appTitle;
      if (config.faviconUrl) {
        if (!icon) {
          icon = document.createElement('link');
          icon.rel = 'icon';
          document.head.append(icon);
        }
        icon.href = config.faviconUrl;
      } else resetIcon();
    };
    const load = async () => {
      request?.abort();
      const current = new AbortController();
      request = current;
      setLoading(true);
      try {
        const response = await fetch('/api/public/branding/config', { signal: current.signal });
        if (!response.ok) return;
        const config = parseBrand(await response.json());
        if (!config || current.signal.aborted) return;
        apply(config);
        setBrandConfig(config);
      } catch {
        // Keep the last valid branding, or the initial defaults before the first successful read.
      } finally {
        if (!current.signal.aborted) setLoading(false);
      }
    };
    const refresh = () => {
      void load();
    };
    refresh();
    window.addEventListener('barghsa:branding-activated', refresh);
    return () => {
      request?.abort();
      window.removeEventListener('barghsa:branding-activated', refresh);
      for (const { name, value, priority } of previous) {
        if (value) root.style.setProperty(name, value, priority);
        else root.style.removeProperty(name);
      }
      document.title = title;
      root.classList.toggle('dark', dark);
      resetIcon();
    };
  }, []);
  const value = useMemo(() => ({ brandConfig, loading }), [brandConfig, loading]);
  return <BrandThemeContext.Provider value={value}>{children}</BrandThemeContext.Provider>;
}
