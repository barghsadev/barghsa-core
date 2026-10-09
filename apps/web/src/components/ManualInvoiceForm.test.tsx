import { QueryComponentProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import ManualInvoiceForm from './ManualInvoiceForm.js';
import {
  manualInvoiceReviewFixture,
  type ManualReviewCommand,
} from '../test/manual-invoice-review-fixture.js';
const profileId = '11111111-1111-4111-8111-111111111111',
  invoiceId = '22222222-2222-4222-8222-222222222222';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, number: String }),
}));
let host: HTMLDivElement,
  root: Root,
  readStatus: number,
  reviewStatus: number,
  commitStatus: number,
  fields: unknown[],
  patch: Record<string, unknown>,
  reviews: ManualReviewCommand[],
  commits: ManualReviewCommand[];
beforeEach(() => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  readStatus = 200;
  reviewStatus = 200;
  commitStatus = 201;
  fields = [];
  patch = {};
  reviews = [];
  commits = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('/manual/profiles?'))
        return Response.json(
          { items: [{ id: profileId, title: 'Customer', profileType: 'LEGAL' }], nextBefore: null },
          { status: readStatus }
        );
      const body = JSON.parse(options?.body as string) as ManualReviewCommand;
      if (url.endsWith('/manual/review')) {
        reviews.push(body);
        return reviewStatus === 200
          ? Response.json(manualInvoiceReviewFixture(body))
          : Response.json(
              { error: { code: 'VALIDATION:INPUT:INVALID', fields } },
              { status: reviewStatus }
            );
      }
      commits.push(body);
      return commitStatus === 201
        ? Response.json(
            {
              invoiceId,
              profileId,
              totalAmount: manualInvoiceReviewFixture(body).data.totals.total,
              state: 'Unpaid',
              ...patch,
            },
            { status: 201 }
          )
        : Response.json(
            { error: { code: 'VALIDATION:INPUT:INVALID', fields } },
            { status: commitStatus }
          );
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount() {
  await act(async () =>
    root.render(<QueryComponentProvider>{<ManualInvoiceForm />}</QueryComponentProvider>)
  );
  await vi.waitFor(() => expect(host.querySelector('select')?.textContent).toContain('Customer'));
}
async function set(input: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
function input(prefix: string, index = 0) {
  return host.querySelectorAll<HTMLInputElement>(`[id^="manual-${prefix}-"]`)[index]!;
}
async function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (value) => value.textContent?.trim() === text || value.getAttribute('aria-label') === text
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function fill() {
  await set(host.querySelector<HTMLSelectElement>('#manual-profile')!, profileId);
  await set(input('description'), '  Service  ');
  await set(input('price'), '۴۰');
}
async function issue() {
  await click('Issue invoice');
  await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).not.toBeNull());
}

it('validates blank fields on submit and preserves localized input through correction', async () => {
  await mount();
  await click('Issue invoice');
  await vi.waitFor(() =>
    expect(host.querySelector('select')?.getAttribute('aria-invalid')).toBe('true')
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  await fill();
  await issue();
  expect(reviews[0]?.lines[0]).toMatchObject({
    description: 'Service',
    quantity: 1,
    unitPrice: '40',
    vatRate: 0,
  });
  expect(input('price').value).toBe('۴۰');
  expect(input('description').value).toBe('  Service  ');
});
it.each(['lineDescription0', 'lineQuantity0', 'lineUnitPrice0', 'lineVatRate0'])(
  'maps owned review %s without clearing companions',
  async (field) => {
    await mount();
    await fill();
    reviewStatus = 400;
    fields = [field];
    await click('Issue invoice');
    const name = {
      lineDescription0: 'description',
      lineQuantity0: 'quantity',
      lineUnitPrice0: 'price',
      lineVatRate0: 'vat',
    }[field]!;
    await vi.waitFor(() => expect(input(name).getAttribute('aria-invalid')).toBe('true'));
    expect(input('price').value).toBe('۴۰');
    expect(input('description').value).toBe('  Service  ');
    expect(commits).toHaveLength(0);
  }
);
it('keeps indexed feedback attached to the captured row after reordering', async () => {
  await mount();
  await fill();
  await click('Add line');
  await set(input('description', 1), '  Second line  ');
  await set(input('price', 1), '۵۰');
  const secondId = input('description', 1).id;
  await click('Move line up 2');
  reviewStatus = 400;
  fields = ['lineDescription0'];
  await click('Issue invoice');
  await vi.waitFor(() =>
    expect(host.querySelector('#' + secondId)?.getAttribute('aria-invalid')).toBe('true')
  );
  expect(reviews[0]?.lines.map((line) => line.description)).toEqual(['Second line', 'Service']);
  expect(input('price', 0).value).toBe('۵۰');
  expect(input('price', 1).value).toBe('۴۰');
});
it('retains the customer and raw rows after a failed unchanged search and recovers', async () => {
  await mount();
  await fill();
  readStatus = 503;
  await click('Search');
  await vi.waitFor(() => expect(host.textContent).toContain('Customers could not be loaded'));
  expect(host.querySelector<HTMLSelectElement>('select')?.value).toBe(profileId);
  expect(input('price').value).toBe('۴۰');
  expect(
    [...host.querySelectorAll('button')].find((button) => button.textContent === 'Issue invoice')
      ?.disabled
  ).toBe(true);
  readStatus = 200;
  await click('Search');
  await vi.waitFor(() =>
    expect(host.querySelector<HTMLSelectElement>('select')?.disabled).toBe(false)
  );
  expect(host.querySelector<HTMLSelectElement>('select')?.value).toBe(profileId);
  await issue();
});
it('maps confirmation feedback back to the enabled row and preserves raw draft', async () => {
  await mount();
  await fill();
  await issue();
  commitStatus = 400;
  fields = ['lineUnitPrice0'];
  await click('Confirm and issue invoice');
  await vi.waitFor(() => expect(input('price').getAttribute('aria-invalid')).toBe('true'));
  expect(input('price').disabled).toBe(false);
  expect(input('price').value).toBe('۴۰');
  expect(document.querySelector('[role=dialog]')).toBeNull();
});
it('keeps mixed or protected confirmation errors generic', async () => {
  await mount();
  await fill();
  await issue();
  commitStatus = 400;
  fields = ['lineUnitPrice0', 'expectedReviewHash'];
  await click('Confirm and issue invoice');
  await vi.waitFor(() => expect(host.querySelector('[role=alert]')).not.toBeNull());
  expect(input('price').getAttribute('aria-invalid')).toBeNull();
  expect(input('price').value).toBe('۴۰');
});
it.each([{ totalAmount: '41' }, { state: 'Draft' }, { state: 'unknown-state' }])(
  'retains the exact uncertain command after a mismatched acknowledgement: %j',
  async (value) => {
    await mount();
    await fill();
    await issue();
    patch = value;
    await click('Confirm and issue invoice');
    await vi.waitFor(() => expect(host.textContent).toContain('The result is unknown'));
    expect(input('price').matches(':disabled')).toBe(true);
    patch = {};
    await click('Retry this invoice');
    await vi.waitFor(() => expect(host.textContent).toContain('Invoice issued'));
    expect(commits[1]).toEqual(commits[0]);
    expect(reviews).toHaveLength(1);
  }
);
it('clears private work after explicit denial', async () => {
  await mount();
  await fill();
  reviewStatus = 403;
  await click('Issue invoice');
  await vi.waitFor(() => expect(host.textContent).toContain('Sign in with current Finance access'));
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).not.toContain('Service');
});
it('revalidates a zero aggregate without losing a valid raw description', async () => {
  await mount();
  await fill();
  await set(input('price'), '۰');
  await click('Issue invoice');
  await vi.waitFor(() => expect(host.textContent).toContain('Add 1 to 100 valid lines'));
  await set(input('price'), '۴۰');
  await vi.waitFor(() => expect(host.querySelector('[role=alert]')).toBeNull());
  await issue();
  expect(reviews[0]?.lines[0]?.unitPrice).toBe('40');
});

it('claims one review before deferred validation and ignores duplicate submits', async () => {
  await mount();
  await fill();
  let respond!: (value: Response) => void;
  const response = new Promise<Response>((resolve) => {
    respond = resolve;
  });
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (String(url).endsWith('/manual/review')) {
      reviews.push(JSON.parse(options?.body as string) as ManualReviewCommand);
      return response;
    }
    return original(url, options);
  });
  const form = host.querySelector('form[aria-label]')!;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(reviews).toHaveLength(1));
  expect(input('price').matches(':disabled')).toBe(true);
  await act(async () => respond(Response.json(manualInvoiceReviewFixture(reviews[0]!))));
  await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).not.toBeNull());
  expect(reviews).toHaveLength(1);
  expect(commits).toHaveLength(0);
});
it('discards old review callbacks after the editor is replaced', async () => {
  await mount();
  await fill();
  let respond!: (value: Response) => void;
  const response = new Promise<Response>((resolve) => {
    respond = resolve;
  });
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (String(url).endsWith('/manual/review')) {
      reviews.push(JSON.parse(options?.body as string) as ManualReviewCommand);
      return response;
    }
    return original(url, options);
  });
  await click('Issue invoice');
  await vi.waitFor(() => expect(reviews).toHaveLength(1));
  await act(async () =>
    root.render(
      <QueryComponentProvider>{<ManualInvoiceForm key="new-editor" />}</QueryComponentProvider>
    )
  );
  await vi.waitFor(() => expect(host.querySelector('select')?.textContent).toContain('Customer'));
  await act(async () =>
    respond(
      Response.json(
        { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['lineUnitPrice0'] } },
        { status: 400 }
      )
    )
  );
  expect(input('price').value).toBe('');
  expect(input('price').getAttribute('aria-invalid')).toBeNull();
  expect(host.textContent).not.toContain('Service');
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(commits).toHaveLength(0);
});

it.each([
  'Unpaid',
  'PaymentUnderReview',
  'PartiallyFunded',
  'Paid',
  'Overdue',
  'Cancelled',
  'PartiallyRefunded',
  'Refunded',
])('accepts the same issued invoice replay after its live state advances to %s', async (state) => {
  await mount();
  await fill();
  await issue();
  commitStatus = 503;
  await click('Confirm and issue invoice');
  await vi.waitFor(() => expect(host.textContent).toContain('The result is unknown'));
  commitStatus = 201;
  patch = { state };
  await click('Retry this invoice');
  await vi.waitFor(() => expect(host.textContent).toContain('Invoice issued'));
  expect(commits).toHaveLength(2);
  expect(commits[1]).toEqual(commits[0]);
  expect(reviews).toHaveLength(1);
});
