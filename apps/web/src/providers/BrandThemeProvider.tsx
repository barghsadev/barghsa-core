import { readWithDeadline } from '../lib/server-query-client.js';
import {
  DEFAULT_BRAND_CONFIG,
  BRAND_SURFACES,
  MUTED_TEXT_COLORS,
  brandName,
  brandColor,
  getContrastForeground,
  getBrandTextColor,
  parseBrandConfig,
  type BrandConfig,
} from '../lib/brand-config.js';
export {
  brandName,
  brandColor,
  getContrastForeground,
  getBrandTextColor,
  parseBrandConfig,
  type BrandConfig,
} from '../lib/brand-config.js';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';
import {
  isThemeMode,
  readTheme,
  resolveTheme,
  storeTheme,
  THEME_DEFAULT_STORAGE_KEY,
  THEME_STORAGE_KEY,
  THEME_POLICY_STORAGE_KEY,
  type ThemeMode,
  type ResolvedTheme,
} from '../lib/theme.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface BrandThemeContextValue {
  brandConfig: BrandConfig;
  loading: boolean;
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  resolvedTheme: ResolvedTheme;
  themePolicy: ThemeMode;
  systemTheme: ResolvedTheme;
}

const BrandThemeContext = createContext<BrandThemeContextValue>({
  brandConfig: DEFAULT_BRAND_CONFIG,
  loading: true,
  theme: 'system',
  setTheme: () => {},
  resolvedTheme: 'light',
  themePolicy: 'system',
  systemTheme: 'light',
});

/**
 * Hook to read the current brand config from context.
 * Components calling this will re-render when brand config changes.
 */
export function useBrandConfig(): BrandThemeContextValue {
  return useContext(BrandThemeContext);
}

export function useTheme() {
  const { theme, setTheme, resolvedTheme } = useBrandConfig();
  return { theme, setTheme, resolvedTheme };
}

/** Apply validated active branding and restore document ownership on unmount. */
export function BrandThemeProvider({ children }: { children: ReactNode }) {
  const [brandConfig, setBrandConfig] = useState<BrandConfig>(DEFAULT_BRAND_CONFIG);
  const [loading, setLoading] = useState(true);
  const [theme, setThemeState] = useState<ThemeMode>(() => readTheme(THEME_STORAGE_KEY));
  const [themePolicy, setThemePolicy] = useState<ThemeMode>(() =>
    readTheme(THEME_POLICY_STORAGE_KEY)
  );
  const [themeDefault, setThemeDefault] = useState<ThemeMode>(() =>
    readTheme(THEME_DEFAULT_STORAGE_KEY)
  );
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  );
  const setTheme = useCallback((mode: ThemeMode) => {
    if (!isThemeMode(mode)) return;
    storeTheme(THEME_STORAGE_KEY, mode);
    setThemeState(mode);
  }, []);
  const resolvedTheme = resolveTheme(themePolicy, theme, systemDark, themeDefault);
  const systemTheme: ResolvedTheme = systemDark ? 'dark' : 'light';
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const updateSystem = () => setSystemDark(media?.matches ?? false);
    const updateStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null)
        setThemeState(readTheme(THEME_STORAGE_KEY));
    };
    media?.addEventListener('change', updateSystem);
    window.addEventListener('storage', updateStorage);
    updateSystem();
    return () => {
      media?.removeEventListener('change', updateSystem);
      window.removeEventListener('storage', updateStorage);
    };
  }, []);
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
      '--brand-canvas-text',
      '--brand-primary-text-light',
      '--brand-primary-text-dark',
      '--app-font',
      '--radius',
      '--spacing',
    ];
    const previous = properties.map(
      (name) =>
        [name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name)] as const
    );
    const title = document.title,
      dark = root.classList.contains('dark');
    const originalIcon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const originalHref = originalIcon?.getAttribute('href') ?? null;
    let activeConfig: BrandConfig | null = null;
    const updateTitle = () => {
      if (activeConfig) document.title = brandName(activeConfig, root.lang === 'en' ? 'en' : 'fa');
    };
    const localeObserver = new MutationObserver(updateTitle);
    localeObserver.observe(root, { attributes: true, attributeFilter: ['lang'] });
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
      activeConfig = config;
      const policy = config.themeMode ?? (config.darkMode ? 'dark' : 'light');
      storeTheme(THEME_POLICY_STORAGE_KEY, policy);
      setThemePolicy(policy);
      const defaultMode = config.themeDefault ?? 'system';
      storeTheme(THEME_DEFAULT_STORAGE_KEY, defaultMode);
      setThemeDefault(defaultMode);
      root.style.setProperty('--brand-light-background', config.backgroundColor);
      root.style.setProperty('--brand-dark-background', config.darkBackgroundColor);
      root.style.setProperty(
        '--app-font',
        config.fontFamily === 'tahoma' ? 'Tahoma' : "'Vazirmatn'"
      );
      root.style.setProperty('--radius', `${config.borderRadiusRem}rem`);
      root.style.setProperty('--spacing', `${0.25 * config.spacingScale}rem`);
      updateTitle();
      // The document's image policy permits same-origin branding assets.
      if (
        config.faviconUrl &&
        new URL(config.faviconUrl, location.origin).origin === location.origin
      ) {
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
        const config = await readWithDeadline(current.signal, async (signal) => {
          const response = await fetch('/api/public/branding/config', { signal });
          if (!response.ok) return null;
          return parseBrandConfig(await response.json());
        });
        if (!config || current.signal.aborted) return;
        apply(config);
        setBrandConfig(config);
      } catch {
        // Keep the last valid branding, or the initial defaults before the first successful read.
      } finally {
        if (!current.signal.aborted) setLoading(false);
      }
    };
    void load();
    window.addEventListener('barghsa:branding-activated', load);
    return () => {
      request?.abort();
      localeObserver.disconnect();
      window.removeEventListener('barghsa:branding-activated', load);
      for (const [name, value, priority] of previous) root.style.setProperty(name, value, priority);
      document.title = title;
      root.classList.toggle('dark', dark);
      resetIcon();
    };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const dark = resolvedTheme === 'dark';
    root.classList.toggle('dark', dark);
    const muted = MUTED_TEXT_COLORS[dark ? 1 : 0];
    const canvas = dark ? brandConfig.darkBackgroundColor : brandConfig.backgroundColor;
    root.style.setProperty(
      '--brand-canvas-text',
      getBrandTextColor(muted, [canvas]) === muted ? '' : 'var(--foreground)'
    );
    for (const [mode, background] of [
      ['light', brandConfig.backgroundColor],
      ['dark', brandConfig.darkBackgroundColor],
    ] as const) {
      root.style.setProperty(
        `--brand-primary-text-${mode}`,
        getBrandTextColor(brandColor(brandConfig, 'primary', mode), [
          background,
          ...BRAND_SURFACES[mode],
        ])
      );
    }
    for (const color of ['primary', 'secondary', 'accent'] as const) {
      const background = brandColor(brandConfig, color, resolvedTheme);
      const foreground = getContrastForeground(background);
      root.style.setProperty(`--brand-${color}`, background);
      root.style.setProperty(`--brand-${color}-foreground`, foreground);
      root.style.setProperty(`--${color}`, background);
      root.style.setProperty(`--${color}-foreground`, foreground);
    }
  }, [resolvedTheme, brandConfig]);
  const value = useMemo(
    () => ({
      brandConfig,
      loading,
      theme,
      setTheme,
      resolvedTheme,
      themePolicy,
      systemTheme,
    }),
    [brandConfig, loading, theme, setTheme, resolvedTheme, themePolicy, systemTheme]
  );
  return <BrandThemeContext.Provider value={value}>{children}</BrandThemeContext.Provider>;
}
