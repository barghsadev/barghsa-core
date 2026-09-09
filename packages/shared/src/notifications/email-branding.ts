import { escapeHtml } from './template-engine.js';

export interface EmailBranding {
  appTitle: string;
  slogan: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  darkMode: boolean;
}

/** Resolve only persistent HTTPS assets; never embed credentials or executable URLs. */
function logoUrl(value: unknown, publicUrl?: string): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const relative = /^\/api\/public\/branding\/assets\/[a-f0-9-]{36}\/[a-f0-9]{64}$/.test(value);
    const url = relative ? new URL(value, publicUrl) : new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** Defensive normalization also protects delivery from malformed historical config. */
export function normalizeEmailBranding(value: unknown, publicUrl?: string): EmailBranding {
  const config = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const text = (name: string, fallback: string, limit: number): string =>
    typeof config[name] === 'string' && config[name].trim()
      ? config[name]
          .replace(/\p{Cc}/gu, ' ')
          .trim()
          .slice(0, limit)
      : fallback;
  const color = (name: string, fallback: string): string =>
    typeof config[name] === 'string' && /^#[0-9a-f]{6}$/i.test(config[name])
      ? config[name]
      : fallback;
  return {
    appTitle: text('appTitle', 'Barghsa', 100),
    slogan: text('slogan', '', 200),
    primaryColor: color('primaryColor', '#2563eb'),
    secondaryColor: color('secondaryColor', '#64748b'),
    accentColor: color('accentColor', '#f59e0b'),
    logoUrl: logoUrl(config.logoUrl, publicUrl),
    darkMode: config.darkMode === true,
  };
}

/** The body is already rendered and escaped by the restricted template engine. */
export function renderBrandedEmail(
  body: string,
  branding: EmailBranding,
  locale: 'fa' | 'en'
): string {
  const brand = normalizeEmailBranding(branding);
  const title = escapeHtml(brand.appTitle),
    slogan = escapeHtml(brand.slogan);
  const background = brand.darkMode ? '#0f172a' : '#ffffff';
  const foreground = brand.darkMode ? '#f8fafc' : '#111827';
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${title}" width="160" style="max-width:160px;height:auto;border:0">`
    : '';
  // Colors decorate borders, not text, so arbitrary brand colors cannot erase labels.
  return `<div lang="${locale}" dir="${locale === 'fa' ? 'rtl' : 'ltr'}" style="background:${background};color:${foreground};font-family:Arial,sans-serif;line-height:1.6;padding:24px">
<table role="presentation" style="width:100%;max-width:640px;margin:0 auto;border-collapse:collapse;border-top:6px solid ${brand.primaryColor};border-bottom:3px solid ${brand.accentColor}"><tbody>
<tr><td style="padding:20px;border-bottom:1px solid ${brand.secondaryColor}">${logo}<p style="font-size:22px;font-weight:bold;margin:8px 0">${title}</p>${slogan ? `<p style="margin:0">${slogan}</p>` : ''}</td></tr>
<tr><td style="padding:20px">${body}</td></tr>
</tbody></table></div>`;
}
