import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { Currency, type CurrencyProps } from './Currency.js';
import type { NumberStyle } from '@barghsa/i18n/numbers';

const settings = vi.hoisted(() => ({ numberStyle: 'locale' as NumberStyle }));
vi.mock('../providers/BrandThemeProvider.js', () => ({
  useBrandConfig: () => ({ brandConfig: settings }),
}));
beforeEach(() => {
  settings.numberStyle = 'locale';
});
const plain = (value: string) =>
  value
    .replace(/[\u200e\u200f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
function render(props: CurrencyProps) {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<Currency {...props} />);
  return host;
}
it.each([
  ['en', 'IRR 9,007,199,254,740,993 (900,719,925,474,099.3 Toman)'],
  ['fa', 'ریال ۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳ (۹۰۰٬۷۱۹٬۹۲۵٬۴۷۴٬۰۹۹٫۳ تومان)'],
] as const)('keeps exact rials and toman in %s', (locale, expected) => {
  const host = render({ amount: '9007199254740993', showToman: true, locale });
  expect(plain(host.textContent!)).toBe(expected);
  expect(host.firstElementChild?.getAttribute('dir')).toBe(locale === 'fa' ? 'rtl' : 'ltr');
  expect(host.querySelectorAll('bdi')).toHaveLength(2);
});
it.each(['default', 'large', 'small'] as const)(
  'supports the %s size without changing amounts',
  (variant) => {
    const host = render({ amount: 1234567n, showCurrencyCode: false, variant, locale: 'en' });
    expect(host.textContent).toBe('1,234,567');
    expect(host.firstElementChild?.className).toContain('tabular-nums');
    if (variant === 'large') expect(host.firstElementChild?.className).toContain('clamp');
    if (variant === 'small') expect(host.firstElementChild?.className).toContain('text-sm');
  }
);
it.each([
  ['en', '1,234,567 IRR'],
  ['fa', '۱٬۲۳۴٬۵۶۷ IRR'],
] as const)('can display the explicit IRR suffix in %s', (locale, expected) => {
  expect(plain(render({ amount: 1234567, locale, showCurrencyCode: true }).textContent!)).toBe(
    expected
  );
});
it.each([
  ['fa', 'western', 'ریال 123,456 (12,345.6 تومان)'],
  ['en', 'persian', 'IRR ۱۲۳٬۴۵۶ (۱۲٬۳۴۵٫۶ Toman)'],
] as const)('uses %s language with %s numerals for both units', (locale, numberStyle, expected) => {
  settings.numberStyle = numberStyle;
  expect(plain(render({ amount: '123456', showToman: true, locale }).textContent!)).toBe(expected);
});
it.each(['invalid', '1.5', '1e6', Number.MAX_SAFE_INTEGER + 1, NaN])(
  'does not present %s as valid money',
  (amount) => {
    const host = render({ amount, showToman: true, locale: 'en' });
    expect(host.textContent).toBe('—');
  }
);
it('preserves negative sub-toman amounts and zero instead of rounding them', () => {
  expect(plain(render({ amount: -1, showToman: true, locale: 'en' }).textContent!)).toBe(
    '-IRR 1 (-0.1 Toman)'
  );
  expect(plain(render({ amount: 0, showToman: true, locale: 'en' }).textContent!)).toBe(
    'IRR 0 (0 Toman)'
  );
});
