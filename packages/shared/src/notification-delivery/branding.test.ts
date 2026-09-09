import { describe, expect, it, vi } from 'vitest';
import { loadEmailBranding, normalizeEmailBranding, renderBrandedEmail } from './branding.js';

describe('email branding', () => {
  it('removes controls before brand names reach email subjects', () => {
    expect(normalizeEmailBranding({ appTitle: 'Brand\r\n\u0000name' }).appTitle).toBe(
      'Brand   name'
    );
  });
  for (const locale of ['fa', 'en'] as const) {
    for (const darkMode of [true, false]) {
      it(`renders ${locale} ${darkMode ? 'dark' : 'light'} branding without changing escaped content`, () => {
        const brand = normalizeEmailBranding({
          appTitle: 'A&B <Energy>',
          slogan: 'Power "now"',
          primaryColor: '#123456',
          secondaryColor: '#345678',
          accentColor: '#567890',
          logoUrl: 'https://assets.example.test/logo.png',
          darkMode,
        });
        const html = renderBrandedEmail('<p>Client &amp; company</p>', brand, locale);
        expect(html).toContain(`lang="${locale}" dir="${locale === 'fa' ? 'rtl' : 'ltr'}"`);
        expect(html).toContain(`background:${darkMode ? '#0f172a' : '#ffffff'}`);
        expect(html).toContain('A&amp;B &lt;Energy&gt;');
        expect(html).toContain('Power &quot;now&quot;');
        expect(html).toContain('<p>Client &amp; company</p>');
        expect(html).not.toContain('&amp;amp;');
        for (const color of ['#123456', '#345678', '#567890']) expect(html).toContain(color);
        expect(html).toContain('src="https://assets.example.test/logo.png"');
      });
    }
  }
  for (const logoUrl of [
    'javascript:alert(1)',
    'data:image/svg+xml,<svg/>',
    'https://user:pass@assets.example.test/logo',
    '//assets.example.test/logo',
    'http://assets.example.test/logo',
  ]) {
    it(`rejects unsafe logo ${logoUrl}`, () => {
      const brand = normalizeEmailBranding({
        logoUrl,
        primaryColor: '#123456; background:url(evil)',
        appTitle: '<script>alert(1)</script>',
      });
      expect(brand.logoUrl).toBeNull();
      const html = renderBrandedEmail('Body', brand, 'en');
      expect(html).not.toMatch(/<img|<script>|url\(evil\)/);
      expect(html).toContain('#2563eb');
    });
  }
  it('resolves owned logo paths against the configured HTTPS public origin', () => {
    const logo =
      '/api/public/branding/assets/00000000-0000-4000-8000-000000000001/' + 'a'.repeat(64);
    expect(normalizeEmailBranding({ logoUrl: logo }, 'https://app.example.test').logoUrl).toBe(
      'https://app.example.test' + logo
    );
    expect(normalizeEmailBranding({ logoUrl: logo }).logoUrl).toBeNull();
    expect(normalizeEmailBranding({ logoUrl: logo }, 'http://app.example.test').logoUrl).toBeNull();
  });
  it('reads active configuration only and uses defaults when no brand was published', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ config: { appTitle: 'Published' } }] })
      .mockResolvedValueOnce({ rows: [] });
    expect((await loadEmailBranding({ query })).appTitle).toBe('Published');
    expect(query).toHaveBeenCalledWith("SELECT config FROM brand_config WHERE status='active'");
    expect((await loadEmailBranding({ query })).appTitle).toBe('Barghsa');
  });
});
