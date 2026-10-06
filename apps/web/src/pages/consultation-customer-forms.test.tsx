import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { tConsultation } from '@barghsa/i18n/consultation';
import { ErrorCodes } from '@barghsa/shared/errors';
import type * as FormModule from '@barghsa/ui/form';
import { ConsultationsPage } from './ConsultationsPage.js';
import { ConsultationDetailPage } from './ConsultationDetailPage.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import {
  browseConsultation,
  browseProductId,
  browseProfileId,
  browseProfiles,
  browseRequestId,
} from '../test/customer-browse-fixtures.js';
const routing = vi.hoisted(() => ({
  requestId: '86000000-0000-4000-8000-000000000003',
  navigate: vi.fn(),
}));
const resolverGate = vi.hoisted(() => ({ wait: null as Promise<void> | null, started: 0 }));
vi.mock('@barghsa/ui/form', async (importOriginal) => {
  const actual = await importOriginal<typeof FormModule>();
  return {
    ...actual,
    useZodForm: (
      schema: Parameters<typeof actual.useZodForm>[0],
      options: Parameters<typeof actual.useZodForm>[1]
    ) =>
      actual.useZodForm(
        typeof schema === 'function'
          ? async () => {
              const wait = resolverGate.wait;
              if (wait) {
                resolverGate.started++;
                await wait;
              }
              return schema();
            }
          : schema,
        options
      ),
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => routing.navigate,
  useParams: () => ({ requestId: routing.requestId }),
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (value: string) => value, notice: null }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  routing.navigate.mockReset();
  routing.requestId = browseRequestId;
  document.documentElement.lang = 'fa';
  resolverGate.wait = null;
  resolverGate.started = 0;
});
const copy = (key: string, locale: 'en' | 'fa' = 'en') => tConsultation(key, locale);
const validation = (fields: unknown[]) =>
  Response.json(
    {
      error: {
        code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
        fields,
        message: 'Private backend text',
        correlationId: browseRequestId,
      },
    },
    { status: 400 }
  );
const baseline = [
  {
    status: 'awaiting_customer_info',
    actor_type: 'staff',
    reason: 'Private requested detail',
    created_at: '2026-10-01T10:00:00Z',
  },
];
function detail(
  status = 'awaiting_customer_info',
  history = baseline,
  id = routing.requestId,
  profileId = browseProfileId
) {
  return {
    request: {
      id,
      profile_id: profileId,
      status,
      product_snapshot: { title: browseConsultation.title },
      submitted_at: '2026-10-01T09:00:00Z',
      staff_owner_username: null,
      staff_team: null,
      fee: null,
      scope: null,
      deliverables: null,
      expected_next_step: null,
      offer_valid_until: null,
      invoice_id: null,
      invoice_state: null,
      has_paid_invoice: false,
      accepted_at: null,
    },
    history,
    adjustments: [],
    refunds: [],
  };
}
function read(url: string) {
  if (url === '/api/profiles') return browseProfiles;
  if (url.includes('/products?')) return { products: [browseConsultation] };
  if (url.includes('/requests?')) return { requests: [], nextBefore: null };
  return detail();
}
function button(host: ParentNode, text: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === text
  );
  expect(found, text).toBeDefined();
  return found!;
}
async function mount(
  Page: typeof ConsultationsPage | typeof ConsultationDetailPage,
  handler: (url: string, options?: RequestInit) => Promise<Response>,
  locale: 'en' | 'fa' = 'en'
) {
  document.documentElement.lang = locale;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(handler));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = async (actor = 'customer-one') =>
    act(async () =>
      root.render(
        <AccountUserProvider value={actor}>
          <Page />
        </AccountUserProvider>
      )
    );
  await render();
  const click = async (text: string) => {
    await vi.waitFor(() => expect(button(host, text).disabled).toBe(false));
    await act(async () => button(host, text).click());
  };
  const submit = async () =>
    act(async () =>
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
  const fill = async (value: string) =>
    act(async () => {
      const input = host.querySelector<HTMLTextAreaElement>('#consultation-information')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        input,
        value
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const select = async () =>
    act(async () => {
      host.querySelector<HTMLInputElement>('input[type=radio]')!.click();
      host.querySelector<HTMLInputElement>('#consultation-confirmation')!.click();
    });
  return {
    host,
    render,
    click,
    submit,
    fill,
    select,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
it.each(['en', 'fa'] as const)(
  'intake gives linked product/confirmation feedback and first-field focus (%s)',
  async (locale) => {
    const writes: unknown[] = [];
    const view = await mount(
      ConsultationsPage,
      async (url, options) => {
        if (options?.method === 'POST') {
          writes.push(JSON.parse(String(options.body)));
          return Response.json({ requestId: browseRequestId, status: 'submitted' });
        }
        return Response.json(read(url));
      },
      locale
    );
    try {
      await view.submit();
      await vi.waitFor(() =>
        expect(view.host.querySelector('#consultation-product-message')?.textContent).toBe(
          copy('productInvalid', locale)
        )
      );
      await vi.waitFor(() =>
        expect(document.activeElement?.id).toBe(`consultation-product-${browseProductId}`)
      );
      expect(view.host.querySelector('[role=radiogroup]')?.getAttribute('aria-invalid')).toBe(
        'true'
      );
      expect(view.host.querySelector('input[type=radio]')?.hasAttribute('aria-invalid')).toBe(
        false
      );
      expect(writes).toEqual([]);
      for (const id of ['consultation-product', 'consultation-confirmation']) {
        const message = view.host.querySelector(`#${id}-message`)!;
        expect(message.parentElement?.querySelector('[aria-hidden=true]')?.textContent).toBe(
          message.textContent
        );
        expect(message.classList.contains('col-start-1')).toBe(true);
      }
      await act(async () =>
        view.host.querySelector<HTMLInputElement>('input[type=radio]')!.click()
      );
      await view.submit();
      await vi.waitFor(() => expect(document.activeElement?.id).toBe('consultation-confirmation'));
      expect(view.host.querySelector('#consultation-confirmation-message')?.textContent).toBe(
        copy('confirmationInvalid', locale)
      );
      await act(async () =>
        view.host.querySelector<HTMLInputElement>('#consultation-confirmation')!.click()
      );
      await view.submit();
      await vi.waitFor(() =>
        expect(routing.navigate).toHaveBeenCalledWith({
          to: '/consultations/$requestId',
          params: { requestId: browseRequestId },
        })
      );
      expect(writes).toHaveLength(1);
    } finally {
      await view.close();
    }
  }
);

it.each(['denied', 'replaced'] as const)(
  'deferred intake cannot submit an older catalogue after it is %s',
  async (mode) => {
    let refreshing = false,
      release: (() => void) | undefined,
      writes = 0;
    const view = await mount(ConsultationsPage, async (url, options) => {
      if (options?.method === 'POST') {
        writes++;
        return Response.json({ requestId: browseRequestId, status: 'submitted' });
      }
      if (url.includes('/products?') && refreshing)
        return mode === 'denied'
          ? new Response('{}', { status: 403 })
          : Response.json({
              products: [{ ...browseConsultation, id: '86000000-0000-4000-8000-000000000005' }],
            });
      return Response.json(read(url));
    });
    try {
      await view.select();
      resolverGate.wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      refreshing = true;
      await act(async () => {
        view.host
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        button(view.host, copy('refreshProducts')).click();
      });
      await vi.waitFor(() => expect(resolverGate.started).toBeGreaterThan(0));
      if (mode === 'denied') expect(view.host.textContent).toContain(copy('productsDenied'));
      else
        expect(view.host.querySelector<HTMLInputElement>('input[type=radio]')?.checked).toBe(false);
      await act(async () => release!());
      expect(writes).toBe(0);
      expect(routing.navigate).not.toHaveBeenCalled();
    } finally {
      resolverGate.wait = null;
      await view.close();
    }
  }
);

it('information read started before the command cannot prove its later ambiguous settlement', async () => {
  let reads = 0,
    writes = 0,
    releaseValidation: (() => void) | undefined,
    releaseRead: ((response: Response) => void) | undefined;
  const saved = {
    status: 'under_review',
    actor_type: 'customer',
    reason: 'Captured reply',
    created_at: '2026-10-01T11:00:00Z',
  };
  const view = await mount(ConsultationDetailPage, async (url, options) => {
    if (options?.method === 'POST') {
      writes++;
      return new Response('{}', { status: 503 });
    }
    if (++reads === 2)
      return new Promise<Response>((resolve) => {
        releaseRead = resolve;
      });
    return Response.json(reads > 2 ? detail('under_review', [...baseline, saved]) : read(url));
  });
  try {
    await view.fill(' Captured reply ');
    resolverGate.wait = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    await act(async () => {
      button(view.host, copy('informationReload')).click();
      view.host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(releaseRead).toBeDefined());
    await act(async () => releaseValidation!());
    await vi.waitFor(() => expect(writes).toBe(1));
    resolverGate.wait = null;
    await act(async () =>
      releaseRead!(Response.json(detail('under_review', [...baseline, saved])))
    );
    expect(view.host.querySelector<HTMLTextAreaElement>('#consultation-information')?.value).toBe(
      ' Captured reply '
    );
    expect(
      view.host.querySelector<HTMLTextAreaElement>('#consultation-information')?.disabled
    ).toBe(true);
    expect(view.host.textContent).not.toContain(copy('infoSent'));
    await view.submit();
    expect(writes).toBe(1);
    await view.click(copy('informationReload'));
    expect(view.host.querySelector('form')).toBeNull();
    expect(view.host.textContent).toContain(copy('infoSent'));
  } finally {
    resolverGate.wait = null;
    await view.close();
  }
});
it('intake projects only public server fields and preserves valid selection/confirmation drafts', async () => {
  let fields: unknown[] = ['productId'];
  const view = await mount(ConsultationsPage, async (url, options) =>
    options?.method === 'POST' ? validation(fields) : Response.json(read(url))
  );
  try {
    await view.select();
    await view.submit();
    await vi.waitFor(() =>
      expect(document.activeElement?.id).toBe(`consultation-product-${browseProductId}`)
    );
    expect(view.host.querySelector<HTMLInputElement>('#consultation-confirmation')?.checked).toBe(
      true
    );
    fields = ['productId', 'submissionKey'];
    await view.submit();
    await vi.waitFor(() => expect(view.host.textContent).toContain(copy('submitError')));
    expect(view.host.querySelector<HTMLInputElement>('input[type=radio]')?.disabled).toBe(false);
    expect(view.host.querySelector('#consultation-product-message')).toBeNull();
    expect(view.host.textContent).not.toContain('submissionKey');
    expect(view.host.textContent).not.toContain('Private backend text');
  } finally {
    await view.close();
  }
});
it('intake blocks simultaneous submits and retries a malformed result using the exact captured actor-bound key', async () => {
  const writes: unknown[] = [];
  let finish: ((response: Response) => void) | undefined;
  const view = await mount(ConsultationsPage, async (url, options) => {
    if (options?.method === 'POST') {
      writes.push(JSON.parse(String(options.body)));
      return writes.length === 1
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Response.json({ requestId: browseRequestId, status: 'submitted' });
    }
    return Response.json(read(url));
  });
  try {
    await view.select();
    await act(async () => {
      const form = view.host.querySelector('form')!;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await act(async () =>
      finish!(Response.json({ requestId: browseRequestId, status: 'under_review' }))
    );
    await vi.waitFor(() => expect(view.host.textContent).toContain(copy('intakeUnconfirmed')));
    expect(routing.navigate).not.toHaveBeenCalled();
    expect(view.host.querySelector<HTMLInputElement>('input[type=radio]')?.disabled).toBe(true);
    await view.submit();
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toEqual(writes[0]);
    expect(routing.navigate).toHaveBeenCalledOnce();
  } finally {
    await view.close();
  }
});
it('intake discards old actor settlement and starts a distinct key for the newly authorized account', async () => {
  const writes: unknown[] = [];
  let finish: ((response: Response) => void) | undefined;
  const view = await mount(ConsultationsPage, async (url, options) => {
    if (options?.method === 'POST') {
      writes.push(JSON.parse(String(options.body)));
      return writes.length === 1
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : new Response('{}', { status: 503 });
    }
    return Response.json(read(url));
  });
  try {
    await view.select();
    await view.submit();
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await view.render('customer-two');
    await view.select();
    await act(async () =>
      finish!(Response.json({ requestId: browseRequestId, status: 'submitted' }))
    );
    expect(routing.navigate).not.toHaveBeenCalled();
    await view.submit();
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toMatchObject({ profileId: browseProfileId, productId: browseProductId });
    expect((writes[1] as { submissionKey: string }).submissionKey).not.toBe(
      (writes[0] as { submissionKey: string }).submissionKey
    );
  } finally {
    await view.close();
  }
});
it.each(['en', 'fa'] as const)(
  'information validates full 2000-character intent, links feedback and owns safe server focus (%s)',
  async (locale) => {
    const writes: unknown[] = [];
    let fields: unknown[] = ['reason'];
    const view = await mount(
      ConsultationDetailPage,
      async (url, options) => {
        if (options?.method === 'POST') {
          writes.push(JSON.parse(String(options.body)));
          return validation(fields);
        }
        return Response.json(read(url));
      },
      locale
    );
    try {
      await view.fill('x'.repeat(2001));
      await view.submit();
      await vi.waitFor(() =>
        expect(view.host.querySelector('#consultation-information-message')?.textContent).toBe(
          copy('informationInvalid', locale)
        )
      );
      await vi.waitFor(() => expect(document.activeElement?.id).toBe('consultation-information'));
      expect(writes).toEqual([]);
      const field = view.host.querySelector('#consultation-information')!;
      expect(field.getAttribute('aria-describedby')).toContain(
        'consultation-information-description'
      );
      expect(field.getAttribute('aria-describedby')).toContain('consultation-information-message');
      const message = view.host.querySelector('#consultation-information-message')!;
      expect(message.parentElement?.querySelector('[aria-hidden=true]')?.textContent).toBe(
        message.textContent
      );
      await view.fill(' ' + 'x'.repeat(2000) + ' ');
      await view.submit();
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      await vi.waitFor(() => expect(document.activeElement?.id).toBe('consultation-information'));
      expect(writes[0]).toEqual({ reason: 'x'.repeat(2000) });
      expect(
        view.host.querySelector<HTMLTextAreaElement>('#consultation-information')?.value
      ).toHaveLength(2002);
      fields = ['reason', 'expectedReviewHash'];
      await view.submit();
      await vi.waitFor(() => expect(writes).toHaveLength(2));
      expect(view.host.querySelector('#consultation-information-message')).toBeNull();
      expect(view.host.textContent).not.toContain('expectedReviewHash');
      expect(view.host.textContent).not.toContain('Private backend text');
    } finally {
      await view.close();
    }
  }
);
it('information clears only on an exact request/outcome acknowledgement', async () => {
  let saved = false;
  const view = await mount(ConsultationDetailPage, async (url, options) => {
    if (options?.method === 'POST') {
      saved = true;
      return Response.json({ requestId: browseRequestId, status: 'under_review' });
    }
    return Response.json(saved ? detail('under_review') : read(url));
  });
  try {
    await view.fill(' Exact reply ');
    await view.submit();
    await vi.waitFor(() => expect(view.host.querySelector('form')).toBeNull());
    expect(view.host.textContent).toContain(copy('infoSent'));
  } finally {
    await view.close();
  }
});
it('uncertain information remains locked through older editable and unrelated history reads until exact appended proof', async () => {
  let writes = 0,
    mode = 'old';
  const saved = {
    status: 'under_review',
    actor_type: 'customer',
    reason: 'Captured reply',
    created_at: '2026-10-01T11:00:00Z',
  };
  const view = await mount(ConsultationDetailPage, async (url, options) => {
    if (options?.method === 'POST') {
      writes++;
      return new Response('{}', { status: 503 });
    }
    return Response.json(
      mode === 'old'
        ? detail()
        : detail('under_review', [
            ...baseline,
            { ...saved, reason: 'Unrelated reply' },
            ...(mode === 'matching' ? [saved] : []),
          ])
    );
  });
  try {
    await view.fill(' Captured reply ');
    await view.submit();
    await vi.waitFor(() => expect(view.host.textContent).toContain(copy('informationUnconfirmed')));
    await view.submit();
    expect(writes).toBe(1);
    await view.click(copy('informationReload'));
    expect(
      view.host.querySelector<HTMLTextAreaElement>('#consultation-information')?.disabled
    ).toBe(true);
    await view.submit();
    expect(writes).toBe(1);
    mode = 'other';
    await view.click(copy('informationReload'));
    expect(view.host.querySelector<HTMLTextAreaElement>('#consultation-information')?.value).toBe(
      ' Captured reply '
    );
    await view.submit();
    expect(writes).toBe(1);
    mode = 'matching';
    await view.click(copy('informationReload'));
    expect(view.host.querySelector('form')).toBeNull();
    expect(view.host.textContent).toContain(copy('infoSent'));
    expect(writes).toBe(1);
  } finally {
    await view.close();
  }
});
it('information ignores late write settlement after request scope changes, preserving the newer draft', async () => {
  let finish: ((value: Response) => void) | undefined;
  const view = await mount(ConsultationDetailPage, async (url, options) =>
    options?.method === 'POST'
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Response.json(read(url))
  );
  try {
    await view.fill('Original request reply');
    await view.submit();
    await vi.waitFor(() => expect(finish).toBeDefined());
    routing.requestId = '86000000-0000-4000-8000-000000000004';
    await view.render();
    await view.fill('New request draft');
    await act(async () =>
      finish!(Response.json({ requestId: browseRequestId, status: 'under_review' }))
    );
    expect(view.host.querySelector<HTMLTextAreaElement>('#consultation-information')?.value).toBe(
      'New request draft'
    );
    expect(view.host.textContent).not.toContain(copy('infoSent'));
  } finally {
    await view.close();
  }
});
it.each(['denied-write', 'malformed-read'] as const)(
  'information withdraws accepted private details/history on %s',
  async (mode) => {
    let posted = false;
    const view = await mount(ConsultationDetailPage, async (url, options) => {
      if (options?.method === 'POST') {
        posted = true;
        return mode === 'denied-write'
          ? Response.json(
              {
                error: {
                  code: 'NOT_FOUND',
                  message: 'Private backend text',
                  correlationId: browseRequestId,
                },
              },
              { status: 404 }
            )
          : new Response('{}', { status: 503 });
      }
      return posted
        ? mode === 'denied-write'
          ? new Response('{}', { status: 404 })
          : Response.json({ request: { id: browseRequestId } })
        : Response.json(read(url));
    });
    try {
      await view.fill('Retained private reply');
      await view.submit();
      await vi.waitFor(() => expect(posted).toBe(true));
      if (mode === 'malformed-read') await view.click(copy('informationReload'));
      await vi.waitFor(() => expect(view.host.querySelector('form')).toBeNull());
      expect(view.host.querySelector('form')).toBeNull();
      expect(view.host.textContent).not.toContain('Private requested detail');
      expect(view.host.textContent).not.toContain(browseConsultation.title.en);
      expect(view.host.textContent).toContain(copy('loadError'));
    } finally {
      await view.close();
    }
  }
);

it('history denial preserves an unconfirmed intake and its exact original retry body', async () => {
  const writes: unknown[] = [];
  let denied = false;
  const view = await mount(ConsultationsPage, async (url, options) => {
    if (options?.method === 'POST') {
      writes.push(JSON.parse(String(options.body)));
      return Response.json(
        writes.length === 1 ? {} : { requestId: browseRequestId, status: 'submitted' }
      );
    }
    if (url.includes('/requests?'))
      return denied
        ? new Response('{}', { status: 403 })
        : Response.json({
            requests: [
              {
                id: browseRequestId,
                status: 'submitted',
                product_snapshot: { title: browseConsultation.title },
                submitted_at: '2026-10-01T09:00:00Z',
                staff_owner_username: null,
                staff_team: null,
                expected_next_step: null,
                invoice_id: null,
                invoice_state: null,
                accepted_at: null,
                offer_valid_until: null,
                refund_pending: false,
              },
            ],
            nextBefore: browseRequestId,
          });
    return Response.json(read(url));
  });
  try {
    await view.select();
    await view.submit();
    await vi.waitFor(() => expect(view.host.textContent).toContain(copy('intakeUnconfirmed')));
    denied = true;
    await act(async () =>
      view.host.querySelector<HTMLButtonElement>('nav[aria-label="History pages"] button')!.click()
    );
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-slot=list-content] [role=alert]')).not.toBeNull()
    );
    expect(view.host.textContent).toContain(copy('intakeUnconfirmed'));
    expect(view.host.querySelector('input[type=radio]')?.hasAttribute('disabled')).toBe(true);
    expect(writes).toHaveLength(1);
    await view.submit();
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toEqual(writes[0]);
    expect(routing.navigate).toHaveBeenCalledWith({
      to: '/consultations/$requestId',
      params: { requestId: browseRequestId },
    });
  } finally {
    await view.close();
  }
});
