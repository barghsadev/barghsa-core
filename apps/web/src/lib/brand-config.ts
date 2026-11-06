import type { NumberStyle } from '@barghsa/i18n/numbers';
import { isThemeMode, type ThemeMode } from './theme.js';

export interface BrandConfig {
  appTitle: string;
  appTitleFa: string;
  supportEmail: string;
  supportPhone: string;
  supportMobile: string;
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
  themeMode?: ThemeMode;
  numberStyle: NumberStyle;
}

export const DEFAULT_BRAND_CONFIG: BrandConfig = {
  appTitle: '',
  appTitleFa: '',
  supportEmail: '',
  supportPhone: '',
  supportMobile: '',
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
  themeMode: 'system',
  numberStyle: 'locale',
};

export const BRAND_SURFACES = {
  light: ['#fdfefb', '#edf0eb'],
  dark: ['#1d2c25', '#293a30'],
} as const;

/** Text colors are checked against active brand surfaces before becoming CSS tokens. */
export const DANGER_TEXT_COLORS = ['#a42c35', '#ffafb2'] as const;

export function brandName(config: BrandConfig, locale: 'fa' | 'en'): string {
  return locale === 'fa' ? config.appTitleFa : config.appTitle;
}

function colorLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}
/** Pick the higher WCAG contrast ratio against the configured sRGB background. */
export function getContrastForeground(hex: string): string {
  const luminance = colorLuminance(hex);
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff';
}
function contrastWith(hex: string, foreground: string): number {
  const first = colorLuminance(hex),
    second = colorLuminance(foreground);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** Brand fills keep their chosen color; small text needs contrast on every surface. */
export function getBrandTextColor(color: string, backgrounds: readonly string[]): string {
  return backgrounds.every((background) => contrastWith(color, background) >= 4.5)
    ? color
    : 'var(--foreground)';
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
function validPhone(value: unknown): value is string {
  return typeof value === 'string' && /^\+?[0-9 ()-]{7,25}$/.test(value);
}
function validColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value);
}
export function parseBrandConfig(value: unknown): BrandConfig | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.appTitle !== 'string' ||
    !data.appTitle.length ||
    data.appTitle.length > 100 ||
    typeof data.appTitleFa !== 'string' ||
    !data.appTitleFa.trim() ||
    data.appTitleFa.length > 100 ||
    typeof data.supportEmail !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.supportEmail) ||
    data.supportEmail.length > 254 ||
    !validPhone(data.supportPhone) ||
    !validPhone(data.supportMobile) ||
    typeof data.slogan !== 'string' ||
    data.slogan.length > 200 ||
    typeof data.darkMode !== 'boolean'
  )
    return null;
  for (const field of ['primaryColor', 'secondaryColor', 'accentColor'])
    if (!validColor(data[field])) return null;
  const backgroundColor = data.backgroundColor ?? DEFAULT_BRAND_CONFIG.backgroundColor;
  const darkBackgroundColor = data.darkBackgroundColor ?? DEFAULT_BRAND_CONFIG.darkBackgroundColor;
  if (
    !validColor(backgroundColor) ||
    contrastWith(backgroundColor, '#203631') < 4.5 ||
    !validColor(darkBackgroundColor) ||
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
  if (data.themeMode !== undefined && !isThemeMode(data.themeMode)) return null;
  return {
    ...data,
    backgroundColor,
    darkBackgroundColor,
    fontFamily,
    borderRadiusRem,
    spacingScale,
    numberStyle,
    themeMode: data.themeMode ?? (data.darkMode ? 'dark' : 'light'),
  } as BrandConfig;
}
