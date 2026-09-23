import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Route } from '../routes/_app/electricity/index.js';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: (value: string) => `${value} IRR`, irrDigits: String }),
}));

const Catalogue = Route.options.component as ComponentType;
const products = [
  {
    id: 'thermal',
    systemKey: 'thermal',
    title: { en: 'Thermal electricity' },
    description: null,
    status: 'active',
    price: '250000',
    limits: { minKwh: '100', maxKwh: '0' },
    orderable: true,
    simpleOrderable: true,
    simpleOrderBlockReasons: [] as string[],
  },
  {
    id: 'green',
    systemKey: 'green',
    title: { en: 'Green electricity' },
    description: null,
    status: 'inactive',
    price: null,
    limits: { minKwh: '0', maxKwh: '0' },
    orderable: false,
    simpleOrderable: false,
    simpleOrderBlockReasons: [],
  },
  {
    id: null,
    systemKey: 'free_market',
    title: null,
    description: null,
    status: 'missing',
    price: null,
    limits: { minKwh: '0', maxKwh: '0' },
    orderable: false,
    simpleOrderable: false,
    simpleOrderBlockReasons: [],
  },
  {
    id: 'saving',
    systemKey: 'energy_saving',
    title: { en: 'Energy saving' },
    description: null,
    status: 'active',
    price: '700000',
    limits: { minKwh: '0', maxKwh: '500' },
    orderable: true,
    simpleOrderable: false,
    simpleOrderBlockReasons: [],
  },
];
let host: HTMLDivElement;
let root: Root;
let previousLanguage: string;

beforeEach(() => {
  previousLanguage = document.documentElement.lang;
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.lang = previousLanguage;
  vi.unstubAllGlobals();
});

it('shows four products but only offers the supported simple-order draft', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(products), { status: 200 }))
  );
  await act(async () => root.render(<Catalogue />));
  expect(host.textContent).toContain('250000 IRR');
  expect(host.textContent).toContain('Free market electricity');
  expect(host.textContent).toContain('Not available yet');
  expect(host.querySelectorAll('a[href="/electricity/order"]')).toHaveLength(1);
});

it('blocks the draft link while the mandatory green product is unavailable', async () => {
  const blocked = structuredClone(products);
  blocked[0]!.simpleOrderable = false;
  blocked[0]!.simpleOrderBlockReasons = ['inactive'];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(blocked), { status: 200 }))
  );
  await act(async () => root.render(<Catalogue />));
  expect(host.textContent).toContain(
    'Ordering is paused until green electricity is active and priced.'
  );
  expect(host.querySelector('a[href="/electricity/order"]')).toBeNull();
});
