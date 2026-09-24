import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { WalletBalanceCard } from './WalletBalanceCard.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
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
    expect(card.querySelector('[role="alert"]')).not.toBeNull();
  }
);

it('hides the reserved row when no funds are held', () => {
  const card = render('0');
  expect(card.textContent).not.toContain('Reserved funds');
});
