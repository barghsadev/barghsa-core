export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = Exclude<ThemeMode, 'system'>;
export const THEME_STORAGE_KEY = 'barghsa.theme.v1';
export const THEME_POLICY_STORAGE_KEY = 'barghsa.theme-policy.v1';
export const THEME_DEFAULT_STORAGE_KEY = 'barghsa.theme-default.v1';

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function readTheme(key: string): ThemeMode {
  try {
    const value = localStorage.getItem(key);
    if (isThemeMode(value)) return value;
  } catch {
    // Browser storage can be unavailable; the system preference still works.
  }
  return 'system';
}

export function storeTheme(key: string, value: ThemeMode): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Keep the current in-memory preference when storage is unavailable.
  }
}

export function resolveTheme(
  policy: ThemeMode,
  preference: ThemeMode,
  systemDark: boolean,
  themeDefault: ThemeMode = 'system'
): ResolvedTheme {
  if (policy !== 'system') return policy;
  if (preference !== 'system') return preference;
  if (themeDefault !== 'system') return themeDefault;
  return systemDark ? 'dark' : 'light';
}
