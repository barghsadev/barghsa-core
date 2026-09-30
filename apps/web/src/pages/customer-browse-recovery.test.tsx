import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Route } from '../routes/_app/electricity/index.js';
import { SavingsPage } from './SavingsPage.js';
import { ConsultationsPage } from './ConsultationsPage.js';
import {
  browseElectricity,
  browseSavingPlan,
  browseProfiles,
  browseProfileId,
  browseConsultation,
  browseConsultationHistory,
  browseRequestId,
} from '../test/customer-browse-fixtures.js';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (value: string) => value, notice: null }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  navigate.mockReset();
  document.documentElement.lang = 'fa';
});
const Electricity = Route.options.component as ComponentType;
const cases = [
  {
    Page: Electricity,
    api: '/api/products/electricity',
    refresh: 'Refresh products',
    title: 'thermal electricity',
    response: browseElectricity,
  },
  {
    Page: SavingsPage,
    api: '/api/saving/plans',
    refresh: 'Refresh plans',
    title: 'Efficient home',
    response: { plans: [browseSavingPlan] },
  },
];
function button(host: ParentNode, text: string) {
  const found = Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent === text
  );
  expect(found, text).toBeDefined();
  return found!;
}
async function mount(Page: ComponentType) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Page />));
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
function consultationData(url: string) {
  if (url === '/api/profiles') return browseProfiles;
  if (url.includes('/products?')) return { products: [browseConsultation] };
  return browseConsultationHistory;
}
for (const { Page, api, refresh, title, response } of cases) {
  it(`${api}: local retry and refresh retain accepted cards until explicit permission denial`, async () => {
    let status = 503;
    let finish: ((response: Response) => void) | undefined;
    let hold = false;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (hold)
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        return status === 200 ? Response.json(response) : new Response('{}', { status });
      })
    );
    const { host, close } = await mount(Page);
    try {
      expect(host.querySelector('h1')).not.toBeNull();
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      status = 200;
      await act(async () => button(host, 'Try again').click());
      expect(host.textContent).toContain(title);
      const details = host.querySelector('details');
      if (details) details.open = true;
      hold = true;
      await act(async () => button(host, refresh).click());
      expect(button(host, refresh).disabled).toBe(true);
      expect(host.querySelector('[data-slot="list-content"]')?.getAttribute('aria-busy')).toBe(
        'true'
      );
      expect(host.textContent).toContain(title);
      await act(async () => finish!(new Response('{}', { status: 503 })));
      expect(host.textContent).toContain(title);
      hold = false;
      await act(async () => button(host, 'Try again').click());
      if (details) expect(details.open && details.isConnected).toBe(true);
      status = 403;
      await act(async () => button(host, refresh).click());
      expect(host.textContent).not.toContain(title);
      expect(host.querySelector('[data-slot="list-content"] button')).toBeNull();
      expect(calls.every((url) => url === api)).toBe(true);
    } finally {
      await close();
    }
  });
}
it('saving catalogue keeps its empty state and history navigation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ plans: [] }))
  );
  const { host, close } = await mount(SavingsPage);
  try {
    expect(host.textContent).toContain('No saving plans are available yet.');
    expect(host.querySelector('a[href="/savings/orders"]')).not.toBeNull();
  } finally {
    await close();
  }
});
it('malformed electricity refresh retains validated cards and reports the failure', async () => {
  let malformed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(malformed ? [] : browseElectricity))
  );
  const { host, close } = await mount(Electricity);
  try {
    malformed = true;
    await act(async () => button(host, 'Refresh products').click());
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.textContent).toContain('thermal electricity');
  } finally {
    await close();
  }
});
it('profile retry exposes history even when products fail, and product retry reloads only products', async () => {
  let profileFail = true,
    productFail = true;
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return (url === '/api/profiles' && profileFail) || (url.includes('/products?') && productFail)
        ? new Response('{}', { status: 503 })
        : Response.json(consultationData(url));
    })
  );
  const { host, close } = await mount(ConsultationsPage);
  try {
    expect(host.textContent).toContain('Could not load your active profile.');
    profileFail = false;
    await act(async () => button(host, 'Try again').click());
    expect(host.textContent).toContain('Available consultations could not be loaded.');
    expect(host.textContent).toContain('Previous consultation');
    const reads = calls.length;
    productFail = false;
    await act(async () => button(host, 'Try again').click());
    expect(calls.slice(reads)).toEqual([
      `/api/consultations/products?profileId=${browseProfileId}`,
    ]);
    expect(host.textContent).toContain('Generation consultation');
    expect(host.textContent).toContain('Previous consultation');
  } finally {
    await close();
  }
});
it('product recovery preserves selected/confirmed consultation and its failed submission key; denied products clear it while history stays', async () => {
  let status = 200,
    hold = false,
    finish: ((response: Response) => void) | undefined;
  const writes: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        writes.push(JSON.parse(options.body as string));
        return writes.length === 1
          ? new Response('{}', { status: 503 })
          : Response.json({ requestId: browseRequestId });
      }
      if (url.includes('/products?')) {
        if (hold)
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        if (status !== 200) return new Response('{}', { status });
      }
      return Response.json(consultationData(url));
    })
  );
  const { host, close } = await mount(ConsultationsPage);
  try {
    const radio = host.querySelector<HTMLInputElement>('input[type="radio"]')!;
    const confirmation = host.querySelector<HTMLInputElement>('form input[type="checkbox"]')!;
    await act(async () => {
      radio.click();
      confirmation.click();
    });
    const form = host.querySelector('form')!;
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(writes).toHaveLength(1);
    hold = true;
    await act(async () => button(host, 'Refresh consultations').click());
    expect(host.querySelector<HTMLButtonElement>('form button[type="submit"]')?.disabled).toBe(
      true
    );
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(writes).toHaveLength(1);
    await act(async () => finish!(new Response('{}', { status: 503 })));
    hold = false;
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(writes).toHaveLength(1);
    await act(async () => button(host, 'Try again').click());
    expect(radio.checked && confirmation.checked).toBe(true);
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(navigate).toHaveBeenCalledOnce();
    status = 403;
    await act(async () => button(host, 'Refresh consultations').click());
    expect(host.querySelector('input[type="radio"]')).toBeNull();
    expect(host.querySelector('form input[type="checkbox"]')).toBeNull();
    expect(host.textContent).toContain('Previous consultation');
  } finally {
    await close();
  }
});
it('a refreshed catalogue without the selected product clears confirmation before another request', async () => {
  let replaced = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.includes('/products?') && replaced
          ? { products: [{ ...browseConsultation, id: 'replacement-product' }] }
          : consultationData(url)
      )
    )
  );
  const { host, close } = await mount(ConsultationsPage);
  try {
    await act(async () => {
      host.querySelector<HTMLInputElement>('input[type="radio"]')!.click();
      host.querySelector<HTMLInputElement>('form input[type="checkbox"]')!.click();
    });
    replaced = true;
    await act(async () => button(host, 'Refresh consultations').click());
    expect(host.querySelector<HTMLInputElement>('input[type="radio"]')?.checked).toBe(false);
    expect(host.querySelector<HTMLInputElement>('form input[type="checkbox"]')?.checked).toBe(
      false
    );
    expect(host.querySelector<HTMLButtonElement>('form button[type="submit"]')?.disabled).toBe(
      true
    );
  } finally {
    await close();
  }
});
