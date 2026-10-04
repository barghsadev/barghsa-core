import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { t } from '@barghsa/i18n/app';
import { ErrorCodes } from '@barghsa/shared/errors';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { ElectricityOrderDetailsPage } from './ElectricityOrderDetailsPage.js';
import { ElectricityOrderRevisionForm } from './ElectricityOrderRevisionForm.js';

vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ money: String, irrDigits: String }),
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: String, notice: null }),
}));
vi.mock('../components/SavingOrderComments.js', () => ({ ElectricityOrderComments: () => null }));
vi.mock('./ElectricityIncreasePanel.js', () => ({ ElectricityIncreasePanel: () => null }));
vi.mock('./ElectricityPriceAdjustmentsPanel.js', () => ({
  ElectricityPriceAdjustmentsPanel: () => null,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }) => {
    const path = Object.entries(params ?? {}).reduce(
      (current, [key, value]) => current.replace(`$${key}`, encodeURIComponent(value)),
      to
    );
    return (
      <a href={`${path}${search ? `?${new URLSearchParams(search)}` : ''}`} {...rest}>
        {children}
      </a>
    );
  },
}));

const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-7${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const order = {
  orderId: id('1'),
  profileId: id('2'),
  contractId: id('3'),
  versionId: id('4'),
  invoiceId: id('5'),
  mode: 'simple',
  profileName: 'Private buyer',
  commercialStatus: 'PENDING',
  electricityStatus: 'changes_requested',
  financialStatus: 'unpaid',
  nextAction: 'resubmit_changes',
  contractState: 'ChangesRequested',
  invoiceState: 'Unpaid',
  periodStart: '2026-10-04T00:00:00Z',
  periodEnd: '2026-10-11T00:00:00Z',
  totalKwh: '10',
  totalIrR: '100',
  paidIrR: '0',
  refundedIrR: '0',
  provinceId: id('6'),
  cityId: id('7'),
  fullAddress: 'Retained private address',
  postalCode: '1234567890',
  lines: [
    {
      productId: id('8'),
      systemKey: 'thermal',
      title: { en: 'Thermal', fa: 'برق حرارتی' },
      quantityKwh: '10',
      unitPriceIrR: '10',
      lineTotalIrR: '100',
    },
  ],
};
const quote = {
  reviewDigest: 'a'.repeat(64),
  periodStart: order.periodStart,
  periodEnd: order.periodEnd,
  durationHours: '168',
  averagePowerKw: '0.05952381',
  greenRuleApplies: false,
  totalKwh: '10',
  subtotalIrR: '100',
  discountIrR: '0',
  vatIrR: '0',
  totalIrR: '100',
  lines: [
    {
      productId: id('8'),
      systemKey: 'thermal',
      quantityKwh: '10',
      unitPriceIrR: '10',
      subtotalIrR: '100',
      discountIrR: '0',
      vatRateBasisPoints: 0,
      vatIrR: '0',
      totalIrR: '100',
    },
  ],
};
const error = (fields: string[], code: string = ErrorCodes.VALIDATION_INPUT_INVALID.code) => ({
  error: { code, message: 'private server value', correlationId: id('9'), fields },
});
let host: HTMLDivElement, root: Root;
let requests: Mock<(path: string, init?: RequestInit) => Promise<Response>>;
let post: (path: string, body: Record<string, unknown>) => Response | Promise<Response>;
let currentQuote = quote;
beforeEach(() => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  currentQuote = quote;
  post = () => Response.json({});
  requests = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/periods/simple'))
      return Response.json({
        periods: [{ key: 'next_week', start: order.periodStart, end: order.periodEnd }],
      });
    if (path.endsWith('/periods/advanced')) return Response.json({ mandatoryGreenEnabled: true });
    if (path.endsWith('/provinces'))
      return Response.json([{ id: order.provinceId, nameEn: 'Province', nameFa: 'استان' }]);
    if (path.endsWith('/cities'))
      return Response.json([
        { id: order.cityId, provinceId: order.provinceId, nameEn: 'City', nameFa: 'شهر' },
      ]);
    if (path.endsWith('/revision-preview')) return Response.json(currentQuote);
    if (init?.method === 'POST')
      return post(path, JSON.parse(String(init.body)) as Record<string, unknown>);
    return Response.json(order);
  });
  vi.stubGlobal('fetch', requests);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const input = (id: string) => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
async function change(id: string, value: string) {
  const control = input(id);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      control.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )!.set!.call(control, value);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(testId: string) {
  await act(async () =>
    host
      .querySelector(`[data-testid=${testId}]`)!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function renderDetails(actor = 'buyer-one') {
  await import('../lib/electricity-correction-form-schemas.js');
  await import('./ElectricityOrderRevisionForm.js');
  await act(async () =>
    root.render(
      <AccountUserProvider value={actor}>
        <ElectricityOrderDetailsPage orderId={order.orderId} />
      </AccountUserProvider>
    )
  );
  await vi.waitFor(() => expect(host.querySelector('#revision-note')).not.toBeNull());
}
async function renderRevision(value = order, onComplete = vi.fn(), onDenied = vi.fn()) {
  await import('../lib/electricity-correction-form-schemas.js');
  await act(async () =>
    root.render(
      <ElectricityOrderRevisionForm order={value} onComplete={onComplete} onDenied={onDenied} />
    )
  );
  return { onComplete, onDenied };
}
const calls = (suffix: string) =>
  requests.mock.calls.filter(([path]) => String(path).endsWith(suffix));
async function previewRevision() {
  await change('revision-note', ' Preserve full revision response ');
  await submit('electricity-revision-form');
  await vi.waitFor(() => expect(calls('/revision-preview')).toHaveLength(1));
  await act(async () => {});
}
async function confirmRevision() {
  const button = [...host.querySelectorAll('section [role=status] button')].find(
    (element) => element.textContent === t('electricity.order.correction.submit', 'en')
  )!;
  await act(async () => (button as HTMLButtonElement).click());
}

it.each(['en', 'fa'] as const)(
  'shows touched linked bilingual address errors and focuses the first invalid field in %s',
  async (locale) => {
    document.documentElement.lang = locale;
    await renderDetails();
    expect(input('correction-postal').getAttribute('aria-invalid')).not.toBe('true');
    await change('correction-postal', '0123456789');
    expect(input('correction-postal').getAttribute('aria-invalid')).not.toBe('true');
    await act(async () =>
      input('correction-postal').dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    );
    await vi.waitFor(() =>
      expect(input('correction-postal').getAttribute('aria-invalid')).toBe('true')
    );
    expect(host.textContent).toContain(t('electricity.correctionForm.postalInvalid', locale));
    expect(input('correction-postal').getAttribute('aria-describedby')).toContain(
      'correction-postal-message'
    );
    await change('correction-note', ' Valid response ');
    await submit('electricity-address-correction-form');
    await vi.waitFor(() => expect(document.activeElement).toBe(input('correction-postal')));
    expect(calls('/resubmit-address')).toHaveLength(0);
    expect(input('correction-address').value).toBe(order.fullAddress);
    expect(input('correction-note').value).toBe(' Valid response ');
  }
);
it('retains malformed address receipts and the exact retry while blocking the sibling revision and cancellation', async () => {
  await renderDetails();
  let attempts = 0;
  post = () =>
    ++attempts === 1
      ? Response.json({ status: 'awaiting_staff_review' })
      : Response.json({
          orderId: order.orderId,
          contractId: order.contractId,
          versionId: id('9'),
          status: 'awaiting_staff_review',
        });
  await change('correction-note', ' Preserved address response ');
  await submit('electricity-address-correction-form');
  await vi.waitFor(() =>
    expect(host.querySelector('[data-testid=electricity-address-correction-retry]')).not.toBeNull()
  );
  expect(input('correction-note').value).toBe(' Preserved address response ');
  expect(input('revision-note').disabled).toBe(true);
  await submit('electricity-revision-form');
  expect(calls('/revision-preview')).toHaveLength(0);
  const cancel = [...host.querySelectorAll('form')].find(
    (form) => form.querySelector('textarea') && !form.hasAttribute('data-testid')
  )!;
  await act(async () =>
    cancel.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(calls('/cancel-review')).toHaveLength(0);
  const first = String(calls('/resubmit-address')[0]![1]?.body);
  await act(async () =>
    (
      host.querySelector('[data-testid=electricity-address-correction-retry]') as HTMLButtonElement
    ).click()
  );
  expect(calls('/resubmit-address')).toHaveLength(2);
  expect(String(calls('/resubmit-address')[1]![1]?.body)).toBe(first);
  expect(JSON.parse(first)).toMatchObject({
    expectedVersionId: order.versionId,
    responseNote: 'Preserved address response',
  });
});
it('maps only owned public fields and preserves valid companion address entries', async () => {
  await renderDetails();
  post = () => Response.json(error(['postalCode']), { status: 400 });
  await change('correction-note', ' Preserved note ');
  await submit('electricity-address-correction-form');
  await vi.waitFor(() =>
    expect(input('correction-postal').getAttribute('aria-invalid')).toBe('true')
  );
  expect(input('correction-address').value).toBe(order.fullAddress);
  expect(input('correction-note').value).toBe(' Preserved note ');
  expect(input('revision-note').disabled).toBe(false);
  expect(host.textContent).not.toContain('private server value');
});
it('keeps an unknown complete 4xx response uncertain and never treats private mixed fields as editable metadata', async () => {
  await renderDetails();
  post = () =>
    Response.json(error(['postalCode', 'expectedVersionId'], 'OTHER:UNKNOWN'), { status: 400 });
  await change('correction-note', 'Keep original');
  await submit('electricity-address-correction-form');
  await vi.waitFor(() =>
    expect(host.querySelector('[data-testid=electricity-address-correction-retry]')).not.toBeNull()
  );
  expect(input('correction-postal').getAttribute('aria-invalid')).not.toBe('true');
  expect(input('revision-note').disabled).toBe(true);
  expect(host.textContent).not.toContain('private server value');
});
it('starts a synchronous guard before validation and prevents duplicate correction events', async () => {
  await renderDetails();
  let resolve!: (value: Response) => void;
  post = () =>
    new Promise<Response>((done) => {
      resolve = done;
    });
  await change('correction-note', 'One command only');
  await act(async () => {
    const form = host.querySelector('[data-testid=electricity-address-correction-form]')!;
    for (let count = 0; count < 2; count++)
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(calls('/resubmit-address')).toHaveLength(1));
  await act(async () => resolve(Response.json({})));
  expect(host.querySelector('[data-testid=electricity-address-correction-retry]')).not.toBeNull();
});
it('retains a full revision and captured quote digest across uncertain retries while blocking address-only writes', async () => {
  await renderDetails();
  let attempts = 0;
  post = () =>
    ++attempts === 1
      ? Response.json({})
      : Response.json({
          orderId: order.orderId,
          contractId: order.contractId,
          versionId: id('9'),
          invoiceId: id('2'),
          status: 'awaiting_staff_review',
          ...quote,
        });
  await previewRevision();
  await confirmRevision();
  await vi.waitFor(() =>
    expect(host.querySelector('[data-testid=electricity-revision-retry]')).not.toBeNull()
  );
  expect(input('correction-note').disabled).toBe(true);
  await submit('electricity-address-correction-form');
  expect(calls('/resubmit-address')).toHaveLength(0);
  await submit('electricity-revision-form');
  expect(calls('/revision-preview')).toHaveLength(1);
  const first = String(calls('/resubmit')[0]![1]?.body);
  await act(async () =>
    (host.querySelector('[data-testid=electricity-revision-retry]') as HTMLButtonElement).click()
  );
  expect(String(calls('/resubmit')[1]![1]?.body)).toBe(first);
  expect(JSON.parse(first)).toMatchObject({
    expectedVersionId: order.versionId,
    expectedQuoteDigest: quote.reviewDigest,
    responseNote: 'Preserve full revision response',
  });
});
it('keeps a rejected exact retry uncertain rather than permitting a new command', async () => {
  await renderRevision();
  let attempts = 0;
  post = () =>
    ++attempts === 1
      ? Response.json({}, { status: 503 })
      : Response.json(error([], ErrorCodes.CONFLICT_STATE.code), { status: 409 });
  await previewRevision();
  await confirmRevision();
  await vi.waitFor(() =>
    expect(host.querySelector('[data-testid=electricity-revision-retry]')).not.toBeNull()
  );
  await act(async () =>
    (host.querySelector('[data-testid=electricity-revision-retry]') as HTMLButtonElement).click()
  );
  expect(input('revision-note').disabled).toBe(true);
  expect(host.querySelector('[data-testid=electricity-revision-retry]')).not.toBeNull();
  expect(calls('/revision-preview')).toHaveLength(1);
});
it('preserves derived green in a complete simple preview', async () => {
  currentQuote = {
    ...quote,
    greenRuleApplies: true,
    totalKwh: '11',
    subtotalIrR: '110',
    totalIrR: '110',
    lines: [
      ...quote.lines,
      {
        ...quote.lines[0]!,
        productId: id('9'),
        systemKey: 'green',
        quantityKwh: '1',
        subtotalIrR: '10',
        totalIrR: '10',
      },
    ],
  };
  await renderRevision();
  await previewRevision();
  expect(host.querySelector('section > [role=status]')).not.toBeNull();
  expect(host.textContent).toContain('110');
});
it('accepts canonical advanced quantity receipts from leading-zero inputs and server-derived green', async () => {
  currentQuote = {
    ...quote,
    greenRuleApplies: true,
    totalKwh: '11',
    subtotalIrR: '110',
    totalIrR: '110',
    lines: [
      ...quote.lines,
      {
        ...quote.lines[0]!,
        productId: id('9'),
        systemKey: 'green',
        quantityKwh: '1',
        subtotalIrR: '10',
        totalIrR: '10',
      },
    ],
  };
  await renderRevision({ ...order, mode: 'advanced' });
  await change('revision-thermal', '0010');
  await previewRevision();
  expect(host.querySelector('section > [role=status]')).not.toBeNull();
  expect(JSON.parse(String(calls('/revision-preview')[0]![1]?.body))).toMatchObject({
    quantities: { thermal: '0010', green: '0' },
  });
});
it.each(['/resubmit-address', '/resubmit'])(
  'withdraws private correction data when %s reports missing resource',
  async (path) => {
    await renderDetails();
    post = () => Response.json(error([], ErrorCodes.NOT_FOUND_RESOURCE.code), { status: 404 });
    if (path === '/resubmit') {
      await previewRevision();
      await confirmRevision();
    } else {
      await change('correction-note', 'Private response');
      await submit('electricity-address-correction-form');
    }
    await vi.waitFor(() => expect(host.querySelector('#electricity-order-correction')).toBeNull());
    expect(host.textContent).not.toContain(order.fullAddress);
    expect(host.textContent).not.toContain('Private buyer');
  }
);
it('fences stale account writes before they can publish a receipt or private data', async () => {
  await renderDetails();
  let resolve!: (value: Response) => void;
  post = () =>
    new Promise<Response>((done) => {
      resolve = done;
    });
  await change('correction-note', 'Old private response');
  await submit('electricity-address-correction-form');
  await vi.waitFor(() => expect(calls('/resubmit-address')).toHaveLength(1));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({}, { status: 403 }))
  );
  await act(async () =>
    root.render(
      <AccountUserProvider value="buyer-two">
        <ElectricityOrderDetailsPage orderId={order.orderId} />
      </AccountUserProvider>
    )
  );
  await act(async () =>
    resolve(
      Response.json({
        orderId: order.orderId,
        contractId: order.contractId,
        versionId: id('9'),
        status: 'awaiting_staff_review',
      })
    )
  );
  expect(host.textContent).not.toContain(order.fullAddress);
  expect(host.textContent).not.toContain('Old private response');
  expect(host.querySelector('#electricity-order-correction')).toBeNull();
});
it('waits for the advanced mandatory-green policy before creating any preview', async () => {
  const underlying = requests;
  let resolve!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) =>
      path.endsWith('/periods/advanced')
        ? new Promise<Response>((done) => {
            resolve = done;
          })
        : underlying(path, init)
    )
  );
  await renderRevision({ ...order, mode: 'advanced' });
  await change('revision-note', 'Retained advanced response');
  await submit('electricity-revision-form');
  expect(calls('/revision-preview')).toHaveLength(0);
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  await act(async () => resolve(Response.json({ mandatoryGreenEnabled: true })));
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
  expect(host.querySelector('#revision-green')).toBeNull();
  expect(input('revision-note').value).toBe('Retained advanced response');
});
it('withdraws the revision draft when its owned options read loses authorization', async () => {
  const onDenied = vi.fn();
  const underlying = requests;
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) =>
      path.endsWith('/periods/advanced')
        ? Promise.resolve(Response.json({}, { status: 403 }))
        : underlying(path, init)
    )
  );
  await renderRevision({ ...order, mode: 'advanced' }, vi.fn(), onDenied);
  expect(onDenied).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-testid=electricity-revision-form]')).toBeNull();
  expect(host.textContent).not.toContain(order.fullAddress);
});
it('links each advanced date label and first-error focus to the real picker trigger', async () => {
  await renderRevision({ ...order, mode: 'advanced' });
  for (const part of ['start', 'end']) {
    const label = host.querySelector<HTMLLabelElement>(`#revision-${part}-label`)!;
    const control = host.querySelector<HTMLButtonElement>(`#revision-${part}-date`)!;
    expect(label.htmlFor).toBe(control.id);
    expect(control.getAttribute('aria-labelledby')).toBe(label.id);
  }
  // An inverted period is rejected before any server preview and focuses its composite picker.
  await act(async () =>
    root.render(
      <ElectricityOrderRevisionForm
        order={{ ...order, mode: 'advanced', versionId: id('9'), periodEnd: order.periodStart }}
        onComplete={() => {}}
      />
    )
  );
  await change('revision-note', 'Valid preserved response');
  await submit('electricity-revision-form');
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('revision-end-date'));
  expect(calls('/revision-preview')).toHaveLength(0);
  expect(host.querySelector('#revision-end-date')?.getAttribute('aria-describedby')).toContain(
    'revision-end-date-message'
  );
});
it('rejects an old retry callback before it can borrow a new order attempt', async () => {
  await renderDetails();
  post = () => Response.json({});
  await change('correction-note', 'First captured command');
  await submit('electricity-address-correction-form');
  await vi.waitFor(() =>
    expect(host.querySelector('[data-testid=electricity-address-correction-retry]')).not.toBeNull()
  );
  const oldButton = host.querySelector('[data-testid=electricity-address-correction-retry]')!;
  // Retain the actual React event callback to simulate delivery from an obsolete render.
  const oldProps = Object.entries(oldButton).find(([key]) =>
    key.startsWith('__reactProps$')
  )?.[1] as { onClick: () => void };
  const nextOrder = { ...order, orderId: id('9') };
  const underlying = requests;
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) =>
      path === `/api/electricity/orders/${nextOrder.orderId}` && !init?.method
        ? Promise.resolve(Response.json(nextOrder))
        : underlying(path, init)
    )
  );
  await act(async () =>
    root.render(
      <AccountUserProvider value="buyer-one">
        <ElectricityOrderDetailsPage orderId={nextOrder.orderId} />
      </AccountUserProvider>
    )
  );
  await vi.waitFor(() => expect(host.querySelector('#correction-note')).not.toBeNull());
  await change('correction-note', 'Second captured command');
  await submit('electricity-address-correction-form');
  await vi.waitFor(() => expect(calls('/resubmit-address')).toHaveLength(2));
  await act(async () => oldProps.onClick());
  expect(calls('/resubmit-address')).toHaveLength(2);
  await act(async () =>
    (
      host.querySelector('[data-testid=electricity-address-correction-retry]') as HTMLButtonElement
    ).click()
  );
  expect(calls('/resubmit-address')).toHaveLength(3);
  expect(calls('/resubmit-address')[2]?.[0]).toBe(
    `/api/electricity/orders/${nextOrder.orderId}/resubmit-address`
  );
  expect(String(calls('/resubmit-address')[2]?.[1]?.body)).toBe(
    String(calls('/resubmit-address')[1]?.[1]?.body)
  );
});
it('keeps preview controls focusable, blocks duplicate preview commands and discards a response after the draft changes', async () => {
  await renderRevision();
  const underlying = requests;
  let resolve!: (value: Response) => void;
  let previews = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) => {
      if (path.endsWith('/revision-preview')) {
        ++previews;
        return new Promise<Response>((done) => {
          resolve = done;
        });
      }
      return underlying(path, init);
    })
  );
  await change('revision-note', 'Original preview response');
  await submit('electricity-revision-form');
  await vi.waitFor(() => expect(previews).toBe(1));
  expect(input('revision-quantity').disabled).toBe(false);
  input('revision-quantity').focus();
  expect(document.activeElement).toBe(input('revision-quantity'));
  await submit('electricity-revision-form');
  expect(previews).toBe(1);
  await change('revision-note', 'Updated response is retained');
  await act(async () => resolve(Response.json(quote)));
  expect(host.querySelector('section > [role=status]')).toBeNull();
  expect(input('revision-note').value).toBe('Updated response is retained');
  expect(calls('/resubmit')).toHaveLength(0);
});
it('ignores stale owned field feedback after the preview draft has been corrected', async () => {
  await renderRevision();
  const underlying = requests;
  let resolve!: (value: Response) => void;
  let previews = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) => {
      if (path.endsWith('/revision-preview')) {
        ++previews;
        return new Promise<Response>((done) => {
          resolve = done;
        });
      }
      return underlying(path, init);
    })
  );
  await change('revision-note', 'Preserved response');
  await submit('electricity-revision-form');
  await vi.waitFor(() => expect(previews).toBe(1));
  await change('revision-postal', '2345678901');
  await act(async () => resolve(Response.json(error(['postalCode']), { status: 400 })));
  expect(input('revision-postal').value).toBe('2345678901');
  expect(input('revision-postal').getAttribute('aria-invalid')).not.toBe('true');
  expect(host.querySelector('#revision-postal-message')).toBeNull();
  expect(host.textContent).not.toContain(t('electricity.order.revision.error', 'en'));
  expect(host.textContent).not.toContain('private server value');
  expect(calls('/resubmit')).toHaveLength(0);
});
