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
  backgroundColor: string;
  darkBackgroundColor: string;
  fontFamily: 'vazirmatn' | 'tahoma';
  borderRadiusRem: number;
  spacingScale: number;
  logoUrl: string | null;
  faviconUrl: string | null;
  darkMode: boolean;
  numberStyle: NumberStyle;
}

const DEFAULT_BRAND_CONFIG: BrandConfig = {
  appTitle: 'Barghsa',
  slogan: '',
  primaryColor: '#176b5b',
  secondaryColor: '#547467',
  accentColor: '#d6a74e',
  backgroundColor: '#f6f7f4',
  darkBackgroundColor: '#15201c',
  fontFamily: 'vazirmatn',
  borderRadiusRem: 0.75,
  spacingScale: 1,
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
  userMode: 'light' | 'dark' | null;
  setUserMode: (mode: 'light' | 'dark' | null) => void;
}

const BrandThemeContext = createContext<BrandThemeContextValue>({
  brandConfig: DEFAULT_BRAND_CONFIG,
  loading: true,
  userMode: null,
  setUserMode: () => {},
});

/**
 * Hook to read the current brand config from context.
 * Components calling this will re-render when brand config changes.
 */
export function useBrandConfig(): BrandThemeContextValue {
  return useContext(BrandThemeContext);
}

/** Pick the higher WCAG contrast ratio against the configured sRGB background. */
export function getContrastForeground(hex: string): string {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}

function contrastWith(hex: string, foreground: string): number {
  const luminance = (color: string) => {
    const channels = [1, 3, 5].map((start) => {
      const value = Number.parseInt(color.slice(start, start + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const first = luminance(hex),
    second = luminance(foreground);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
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
export function parseBrandConfig(value: unknown): BrandConfig | null {
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
  const backgroundColor = data.backgroundColor ?? DEFAULT_BRAND_CONFIG.backgroundColor;
  const darkBackgroundColor = data.darkBackgroundColor ?? DEFAULT_BRAND_CONFIG.darkBackgroundColor;
  if (
    typeof backgroundColor !== 'string' ||
    !/^#[a-f0-9]{6}$/i.test(backgroundColor) ||
    contrastWith(backgroundColor, '#203631') < 4.5 ||
    typeof darkBackgroundColor !== 'string' ||
    !/^#[a-f0-9]{6}$/i.test(darkBackgroundColor) ||
    contrastWith(darkBackgroundColor, '#e7eee6') < 4.5
  )
    return null;
  const fontFamily = data.fontFamily ?? DEFAULT_BRAND_CONFIG.fontFamily;
  const borderRadiusRem = data.borderRadiusRem ?? DEFAULT_BRAND_CONFIG.borderRadiusRem;
  const spacingScale = data.spacingScale ?? DEFAULT_BRAND_CONFIG.spacingScale;
  if (
    (fontFamily !== 'vazirmatn' && fontFamily !== 'tahoma') ||
    typeof borderRadiusRem !== 'number' ||
    !Number.isFinite(borderRadiusRem) ||
    borderRadiusRem < 0 ||
    borderRadiusRem > 1.5 ||
    typeof spacingScale !== 'number' ||
    !Number.isFinite(spacingScale) ||
    spacingScale < 0.875 ||
    spacingScale > 1.25
  )
    return null;
  if (!validAsset(data.logoUrl) || !validAsset(data.faviconUrl)) return null;
  const numberStyle = data.numberStyle ?? 'locale';
  if (typeof numberStyle !== 'string' || !['locale', 'persian', 'western'].includes(numberStyle))
    return null;
  return {
    ...data,
    backgroundColor,
    darkBackgroundColor,
    fontFamily,
    borderRadiusRem,
    spacingScale,
    numberStyle,
  } as BrandConfig;
}

/** Apply validated active branding and restore document ownership on unmount. */
export function BrandThemeProvider({ children }: { children: ReactNode }) {
  const [brandConfig, setBrandConfig] = useState<BrandConfig>(DEFAULT_BRAND_CONFIG);
  const [loading, setLoading] = useState(true);
  const [userMode, setUserMode] = useState<'light' | 'dark' | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const colors = ['primary', 'secondary', 'accent'] as const;
    const properties = [
      ...colors.flatMap((color) => [
        `--brand-${color}`,
        `--brand-${color}-foreground`,
        `--${color}`,
        `--${color}-foreground`,
      ]),
      '--brand-light-background',
      '--brand-dark-background',
      '--app-font',
      '--radius',
      '--spacing',
    ];
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
      root.style.setProperty('--brand-light-background', config.backgroundColor);
      root.style.setProperty('--brand-dark-background', config.darkBackgroundColor);
      root.style.setProperty(
        '--app-font',
        config.fontFamily === 'tahoma' ? 'Tahoma' : "'Vazirmatn'"
      );
      root.style.setProperty('--radius', `${config.borderRadiusRem}rem`);
      root.style.setProperty('--spacing', `${0.25 * config.spacingScale}rem`);
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
        const config = parseBrandConfig(await response.json());
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
  useEffect(() => {
    document.documentElement.classList.toggle(
      'dark',
      userMode === null ? brandConfig.darkMode : userMode === 'dark'
    );
  }, [brandConfig.darkMode, userMode]);
  const value = useMemo(
    () => ({ brandConfig, loading, userMode, setUserMode }),
    [brandConfig, loading, userMode]
  );
  return <BrandThemeContext.Provider value={value}>{children}</BrandThemeContext.Provider>;
}
