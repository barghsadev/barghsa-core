import { describe, expect, it, vi } from 'vitest';
import { loadEmailBranding, normalizeEmailBranding, renderBrandedEmail } from './branding.js';

describe('email branding', () => {
  it.each(['fa', 'en'] as const)(
    'uses the configured %s title without HTML or subject injection',
    (locale) => {
      const brand = normalizeEmailBranding({
        appTitle: 'English & Energy',
        appTitleFa: 'برق <آزمایش>\r\n\u0000',
      });
      expect(brand.appTitleFa).toBe('برق <آزمایش>');
      const html = renderBrandedEmail('<p>Body</p>', brand, locale);
      expect(html).toContain(locale === 'fa' ? 'برق &lt;آزمایش&gt;' : 'English &amp; Energy');
      expect(html).not.toContain('<آزمایش>');
      expect(html).toContain('<p>Body</p>');
    }
  );
  it.each([
    [false, '#000000', '#ffffff'],
    [false, '#777777', '#000000'],
    [true, '#ffffff', '#000000'],
    [true, '#000000', '#ffffff'],
  ] as const)(
    'uses the configured background with readable text (dark=%s, %s)',
    (darkMode, background, foreground) => {
      const brand = normalizeEmailBranding({
        darkMode,
        backgroundColor: darkMode ? '#abcdef' : background,
        darkBackgroundColor: darkMode ? background : '#abcdef',
      });
      expect(renderBrandedEmail('Message', brand, 'fa')).toContain(
        `background:${background};color:${foreground}`
      );
    }
  );
  it('rejects executable background values and preserves legacy rendering defaults', () => {
    const brand = normalizeEmailBranding({
      appTitle: 'Legacy',
      appTitleFa: '',
      backgroundColor: '#fff; background:url(evil)',
      darkBackgroundColor: 'url(javascript:alert(1))',
    });
    const light = renderBrandedEmail('Body', brand, 'fa');
    const dark = renderBrandedEmail('Body', { ...brand, darkMode: true }, 'en');
    expect(light).toContain('background:#ffffff;color:#111827');
    expect(dark).toContain('background:#0f172a;color:#f8fafc');
    expect(light).toContain('Legacy');
    expect(light + dark).not.toMatch(/url\(|javascript:/);
  });
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
