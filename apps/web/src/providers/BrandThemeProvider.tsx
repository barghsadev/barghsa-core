import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrandConfig {
  appTitle: string
  slogan: string
  primaryColor: string
  secondaryColor: string
  accentColor: string
  logoUrl: string | null
  faviconUrl: string | null
  darkMode: boolean
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
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface BrandThemeContextValue {
  brandConfig: BrandConfig
  loading: boolean
}

const BrandThemeContext = createContext<BrandThemeContextValue>({
  brandConfig: DEFAULT_BRAND_CONFIG,
  loading: true,
})

/**
 * Hook to read the current brand config from context.
 * Components calling this will re-render when brand config changes.
 */
export function useBrandConfig(): BrandThemeContextValue {
  return useContext(BrandThemeContext)
}

// ---------------------------------------------------------------------------
// CSS variable injection helpers
// ---------------------------------------------------------------------------

/**
 * Convert a hex color (e.g. #2563eb) to a CSS usage-appropriate format.
 * Currently returns the hex as-is; extend this for HSL/OKLCH conversion if needed.
 */
function hexToCssValue(hex: string): string {
  return hex
}

/**
 * Set CSS custom properties on the document root element.
 * Removes previously set brand properties first to avoid stale variables.
 */
function applyBrandCssVars(config: BrandConfig): void {
  const root = document.documentElement

  // Remove old brand CSS vars
  const brandVars = [
    '--brand-primary',
    '--brand-secondary',
    '--brand-accent',
    '--brand-primary-foreground',
    '--brand-secondary-foreground',
    '--brand-accent-foreground',
  ]
  for (const v of brandVars) {
    root.style.removeProperty(v)
  }

  // Set new brand CSS vars
  root.style.setProperty('--brand-primary', hexToCssValue(config.primaryColor))
  root.style.setProperty('--brand-secondary', hexToCssValue(config.secondaryColor))
  root.style.setProperty('--brand-accent', hexToCssValue(config.accentColor))

  // Compute foreground colors based on luminance for readable text on brand colors
  root.style.setProperty('--brand-primary-foreground', getContrastForeground(config.primaryColor))
  root.style.setProperty('--brand-secondary-foreground', getContrastForeground(config.secondaryColor))
  root.style.setProperty('--brand-accent-foreground', getContrastForeground(config.accentColor))
}

/**
 * Determine whether a hex color is "light" or "dark" and return the
 * contrasting text color (#ffffff for dark backgrounds, #000000 for light).
 */
function getContrastForeground(hex: string): string {
  // Remove #
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return '#ffffff'

  const r = Number.parseInt(clean.substring(0, 2), 16)
  const g = Number.parseInt(clean.substring(2, 4), 16)
  const b = Number.parseInt(clean.substring(4, 6), 16)

  // Relative luminance (W3C formula)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5 ? '#000000' : '#ffffff'
}

/**
 * Apply or remove the dark class on the document root.
 */
function applyDarkMode(dark: boolean): void {
  const root = document.documentElement
  if (dark) {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

/**
 * Set the favicon dynamically from the brand config URL.
 */
function applyFavicon(faviconUrl: string | null): void {
  if (!faviconUrl) return

  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = faviconUrl
}

/**
 * Set the document title from the brand config.
 */
function applyDocumentTitle(title: string): void {
  document.title = title
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface BrandThemeProviderProps {
  children: ReactNode
}

/**
 * BrandThemeProvider (T-09.01.02).
 *
 * Fetches the active brand configuration from /api/public/branding/config
 * and injects it as CSS custom properties on the document root, enabling
 * dynamic theming across all pages including auth pages.
 *
 * Also applies:
 * - Dark mode class on <html>
 * - Dynamic favicon
 * - Document title
 */
export function BrandThemeProvider({ children }: BrandThemeProviderProps) {
  const [brandConfig, setBrandConfig] = useState<BrandConfig>(DEFAULT_BRAND_CONFIG)
  const [loading, setLoading] = useState(true)

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/public/branding/config')
      if (!res.ok) {
        console.warn('[BrandThemeProvider] Failed to fetch brand config:', res.statusText)
        // Fall through to default config
        return
      }
      const data: BrandConfig = await res.json()
      setBrandConfig(data)

      // Apply theme
      applyBrandCssVars(data)
      applyDarkMode(data.darkMode)
      if (data.faviconUrl) applyFavicon(data.faviconUrl)
      if (data.appTitle) applyDocumentTitle(data.appTitle)
    } catch (err) {
      console.warn('[BrandThemeProvider] Error fetching brand config:', err)
      // Fall through to default
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  return (
    <BrandThemeContext.Provider value={{ brandConfig, loading }}>
      {children}
    </BrandThemeContext.Provider>
  )
}