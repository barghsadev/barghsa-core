import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import Page from './AdminCataloguePage.js';
import {
  catalogueBase as base,
  catalogueTypes,
  catalogueId as id,
  secondCatalogueId as secondId,
  hardwareId,
  catalogueProduct,
  catalogueDetail,
  catalogueReferences,
  catalogueConfig,
  type CatalogueType,
} from '../test/catalogue-fixtures.js';
import { tCatalogue } from '@barghsa/i18n/catalogue';

vi.mock('./SavingAgreementEditor.js', () => ({ SavingAgreementEditor: () => null }));
vi.mock('../components/SavingInventoryPanel.js', () => ({ SavingInventoryPanel: () => null }));
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});
function button(host: ParentNode, name: string) {
  const result = Array.from(host.querySelectorAll('button')).find(
    (item) => (item.getAttribute('aria-label') || item.textContent) === name
  );
  expect(result, name).toBeDefined();
  return result!;
}
function fill(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function data(url: string, type: CatalogueType = 'consultation') {
  if (url.endsWith('/settings/timezone')) return { timezone: 'Asia/Tehran' };
  if (url.includes('type=hardware') && type === 'saving_plan')
    return [catalogueProduct('hardware', hardwareId)];
  if (url.includes('?type=')) return [catalogueProduct(type), catalogueProduct(type, secondId)];
  if (url.endsWith('/rule-references')) return catalogueReferences;
  if (url.endsWith('/configuration')) return catalogueConfig;
  return catalogueDetail(type, url.includes(secondId) ? secondId : id);
}
async function mount(type: CatalogueType = 'consultation') {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Page />));
  if (type !== 'consultation') await act(async () => button(host, tCatalogue(type, 'en')).click());
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
for (const type of catalogueTypes) {
  it(`${type}: list failure and retry preserve product/price drafts and fetch only that list`, async () => {
    let finish: ((response: Response) => void) | undefined;
    let refreshing = false;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (refreshing && url === `${base}?type=${type}`)
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        return Response.json(data(url, type));
      })
    );
    const { host, close } = await mount(type);
    try {
      await act(async () => button(host, 'Edit Sample product').click());
      refreshing = true;
      await act(async () => button(host, 'Refresh').click());
      const list = host.querySelector('[data-slot="list-content"]')!;
      expect(list.getAttribute('aria-busy')).toBe('true');
      expect(list.textContent).toContain('Sample product');
      const title = host.querySelector<HTMLInputElement>('#catalogue-titleEn')!;
      await act(async () => fill(title, 'Keep product draft'));
      await act(async () => button(host, 'Add price version').click());
      const price = host.querySelector<HTMLInputElement>('#catalogue-price')!;
      await act(async () => fill(price, '19000'));
      await act(async () => finish!(new Response('{}', { status: 503 })));
      expect(list.querySelector('[role="alert"]')).not.toBeNull();
      const reads = calls.length;
      refreshing = false;
      await act(async () => button(list, 'Try again').click());
      expect(calls.slice(reads)).toEqual([`${base}?type=${type}`]);
      expect(title.isConnected).toBe(true);
      expect(title.value).toBe('Keep product draft');
      expect(price.value).toBe('19000');
      expect(list.querySelector('[role="alert"]')).toBeNull();
    } finally {
      await close();
    }
  });
}
for (const resource of ['product', 'references', 'configuration']) {
  it(`${resource}: detail retry leaves the list available and does not reload hardware or list`, async () => {
    const type = 'saving_plan';
    let failing = true;
    const failingUrl =
      resource === 'product'
        ? `${base}/${id}`
        : resource === 'references'
          ? `${base}/${id}/rule-references`
          : `/api/admin/catalogue/saving-plans/${id}/configuration`;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return url === failingUrl && failing
          ? new Response('{}', { status: 503 })
          : Response.json(data(url, type));
      })
    );
    const { host, close } = await mount(type);
    try {
      await act(async () => button(host, 'Edit Sample product').click());
      expect(host.textContent).toContain('Could not load this product and its settings.');
      const list = host.querySelector('[data-slot="list-content"]')!;
      expect(list.querySelector('[role="alert"]')).toBeNull();
      expect(list.textContent).toContain('Sample product');
      const reads = calls.length;
      failing = false;
      await act(async () => button(host, 'Try again').click());
      expect(calls.slice(reads)).toEqual([
        `${base}/${id}`,
        `${base}/${id}/rule-references`,
        `/api/admin/catalogue/saving-plans/${id}/configuration`,
      ]);
      expect(host.querySelector('#catalogue-titleEn')).not.toBeNull();
    } finally {
      await close();
    }
  });
}
it('hardware retry preserves plan drafts and blocks saving until compatible hardware is available', async () => {
  let failing = true;
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return url === `${base}?type=hardware` && failing
        ? new Response('{}', { status: 503 })
        : Response.json(data(url, 'saving_plan'));
    })
  );
  const { host, close } = await mount('saving_plan');
  try {
    await act(async () => button(host, 'Edit Sample product').click());
    const title = host.querySelector<HTMLInputElement>('#catalogue-titleEn')!;
    await act(async () => fill(title, 'Plan draft'));
    expect(button(host, 'Save product').disabled).toBe(true);
    const reads = calls.length;
    failing = false;
    await act(async () => button(host, 'Try again').click());
    expect(calls.slice(reads)).toEqual([`${base}?type=hardware`]);
    expect(title.value).toBe('Plan draft');
    expect(host.querySelector<HTMLInputElement>('fieldset input[type="checkbox"]')?.checked).toBe(
      true
    );
    expect(button(host, 'Save product').disabled).toBe(false);
  } finally {
    await close();
  }
});
it('timezone retry leaves the list and product draft intact while price actions wait for valid settings', async () => {
  let failing = true;
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return url.endsWith('/settings/timezone') && failing
        ? new Response('{}', { status: 503 })
        : Response.json(data(url));
    })
  );
  const { host, close } = await mount();
  try {
    await act(async () => button(host, 'Edit Sample product').click());
    const title = host.querySelector<HTMLInputElement>('#catalogue-titleEn')!;
    await act(async () => fill(title, 'Timezone independent draft'));
    expect(host.querySelector('form[aria-label="Price editor"]')).toBeNull();
    expect(host.textContent).not.toContain('Add price version');
    const reads = calls.length;
    failing = false;
    await act(async () => button(host, 'Try again').click());
    expect(calls.slice(reads)).toEqual(['/api/user/settings/timezone']);
    expect(title.value).toBe('Timezone independent draft');
    expect(button(host, 'Add price version')).toBeDefined();
  } finally {
    await close();
  }
});
it('a late product response cannot replace the newly selected editor', async () => {
  let finish: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === `${base}/${id}`)
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return Response.json(data(url));
    })
  );
  const { host, close } = await mount();
  try {
    await act(async () => button(host, 'Edit Sample product').click());
    await act(async () => button(host, 'Edit Second product').click());
    await act(async () => finish!(Response.json(catalogueDetail())));
    expect(host.querySelector<HTMLInputElement>('#catalogue-titleEn')?.value).toBe(
      'Second product'
    );
  } finally {
    await close();
  }
});
it('hardware permission denial discards an open editor and prevents a late list response repopulating it', async () => {
  let finish: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === `${base}?type=saving_plan`)
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      if (url === `${base}?type=hardware`) return new Response('{}', { status: 403 });
      return Response.json(data(url, 'saving_plan'));
    })
  );
  const { host, close } = await mount('saving_plan');
  try {
    await act(async () => button(host, 'Add product').click());
    await act(async () => finish!(Response.json([catalogueProduct('saving_plan')])));
    expect(host.textContent).toContain('You do not have permission to manage products.');
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('[data-slot="list-content"]')?.textContent).not.toContain(
      'Sample product'
    );
    expect(host.textContent).not.toContain('Add product');
  } finally {
    await close();
  }
});
