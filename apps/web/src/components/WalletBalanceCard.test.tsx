import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps, ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { WalletBalanceCard } from './WalletBalanceCard.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode } & ComponentProps<'a'>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    money: (value: string | number) => `${value} IRR`,
    irrDigits: (value: string | number | bigint) => String(value),
  }),
}));

function render(reservedBalance: string, locale: 'en' | 'fa' = 'en') {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <WalletBalanceCard
      balance="9007199254740993"
      postedBalance="9007199254740998"
      reservedBalance={reservedBalance}
      currency="IRR"
      lowBalanceWarning
      pendingInvoices={1}
      locale={locale}
    />
  );
  return container;
}

it.each(['en', 'fa'] as const)(
  'shows exact available, posted and reserved funds in %s',
  (locale) => {
    const card = render('5', locale);
    expect(card.textContent).toContain('9007199254740993 IRR');
    expect(card.textContent).toContain('9007199254740998 IRR');
    expect(card.textContent).toContain('5 IRR');
    expect(card.textContent).toContain(locale === 'en' ? 'Posted balance' : 'موجودی ثبت‌شده');
    expect(card.textContent).toContain(locale === 'en' ? 'Reserved funds' : 'مبلغ رزروشده');
    expect(card.querySelector('a[href="/wallet"]')).not.toBeNull();
    expect(card.querySelectorAll('a')).toHaveLength(1);
    expect(card.querySelector('a [data-slot="currency"]')).not.toBeNull();
    expect(card.querySelector('a')?.getAttribute('aria-label')).toBe(
      locale === 'en' ? 'Charge Wallet' : 'شارژ کیف پول'
    );
    expect(card.textContent).toContain(
      locale === 'en' ? '900,719,925,474,099.3 Toman' : '۹۰۰٬۷۱۹٬۹۲۵٬۴۷۴٬۰۹۹٫۳ تومان'
    );
    expect(card.querySelector('[role="alert"]')).not.toBeNull();
  }
);

it('hides the reserved row when no funds are held', () => {
  const card = render('0');
  expect(card.textContent).not.toContain('Reserved funds');
});
