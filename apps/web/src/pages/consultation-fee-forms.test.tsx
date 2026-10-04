import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { tConsultation } from '@barghsa/i18n/consultation';
import { tConsultationFee } from '@barghsa/i18n/consultation-fee';
import { ErrorCodes } from '@barghsa/shared/errors';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { AdminConsultationsPage } from './AdminConsultationsPage.js';
import {
  feeSource,
  feeReview,
  feeReceipt,
  firstWork,
  olderWork,
} from '../test/consultation-fee-fixtures.js';
import type * as FormModule from '@barghsa/ui/form';
import type * as SchemaModule from '../lib/consultation-fee-form-schemas.js';
const snapshots = vi.hoisted(() => ({ read: null as (() => Record<string, unknown>) | null }));
vi.mock('@barghsa/ui/form', async (importOriginal) => {
  const actual = await importOriginal<typeof FormModule>();
  const useZodForm: typeof actual.useZodForm = (schema, options) => {
    const form = actual.useZodForm(schema, options);
    if (options?.defaultValues && 'scope' in options.defaultValues)
      snapshots.read = () => form.getValues();
    return form;
  };
  return { ...actual, useZodForm };
});
const lazy = vi.hoisted(() => ({ gate: null as Promise<void> | null, started: false }));
vi.mock('@tanstack/react-router', () => ({ useSearch: () => ({}) }));
vi.mock('../lib/consultation-fee-form-schemas.js', async (importOriginal) => {
  lazy.started = true;
  await lazy.gate;
  return importOriginal<typeof SchemaModule>();
});
const invalid = (fields: unknown[], code: string = ErrorCodes.VALIDATION_INPUT_INVALID.code) =>
  Response.json(
    { error: { code, message: 'PRIVATE backend text', correlationId: firstWork, fields } },
    { status: 400 }
  );
function button(owner: ParentNode, label: string) {
  const result = [...owner.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label
  );
  expect(result, label).toBeDefined();
  return result!;
}
function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(
    element,
    value
  );
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});
async function mount(
  options: {
    mode?: 'initial' | 'replacement' | 'paid';
    locale?: 'en' | 'fa';
    timezone?: string;
    override?: (url: string, init?: RequestInit) => Promise<Response | undefined>;
  } = {}
) {
  const mode = options.mode ?? 'initial',
    locale = options.locale ?? 'en';
  document.documentElement.lang = locale;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const source = feeSource(mode),
    posts: Array<{ url: string; body: Record<string, string> }> = [];
  const reads: string[] = [];
  let lastReview: ReturnType<typeof feeReview> | undefined;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') posts.push({ url, body: JSON.parse(String(init.body)) });
    else reads.push(url);
    const custom = await options.override?.(url, init);
    if (custom) return custom;
    if (url.endsWith('/settings/timezone'))
      return Response.json({ timezone: options.timezone ?? 'UTC' });
    if (url.endsWith('/teams')) return Response.json({ teams: [] });
    if (url.includes('/requests?'))
      return Response.json({
        requests: [source, feeSource('initial', olderWork)],
        nextAfter: null,
      });
    if (url.endsWith(`/requests/${firstWork}`))
      return Response.json({ request: source, history: [] });
    if (url.endsWith(`/requests/${olderWork}`))
      return Response.json({ request: feeSource('initial', olderWork), history: [] });
    if (url.endsWith('-review')) {
      const input = JSON.parse(String(init?.body));
      lastReview = feeReview(source, input);
      return Response.json(lastReview);
    }
    if (url.endsWith('/fee') || url.endsWith('/paid-fee'))
      return Response.json(feeReceipt(lastReview!));
    if (url === '/api/auth/step-up') return Response.json({ verified: true });
    throw new Error(`Unexpected fixture request ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = async (actor = 'reviewer') =>
    act(async () =>
      root.render(
        <AccountUserProvider value={actor}>
          <AdminConsultationsPage />
        </AccountUserProvider>
      )
    );
  await render();
  const select = async (id = firstWork) =>
    act(async () =>
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((item) =>
          item.textContent?.includes(id === firstWork ? 'First buyer' : 'Older buyer')
        )!
        .click()
    );
  await select();
  await vi.waitFor(() => expect(container.querySelector('#consultation-fee')).not.toBeNull());
  const field = (name: string) =>
    container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#consultation-${name}`)!;
  const change = async (name: string, value: string) => act(async () => fill(field(name), value));
  const submit = async () =>
    act(async () =>
      container
        .querySelector('form[data-testid=consultation-fee-form]')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
  const click = async (label: string, owner: ParentNode = container) =>
    act(async () => button(owner, label).click());
  const dialog = async () =>
    vi.waitFor(() => expect(document.querySelector('[role=dialog]')).not.toBeNull());
  const confirm = async () => {
    await dialog();
    await click(locale === 'en' ? 'Confirm' : 'تأیید', document);
  };
  const writes = () => posts.filter((item) => /\/(paid-fee|fee)$/.test(item.url));
  const previews = () => posts.filter((item) => /fee-review$/.test(item.url));
  const ready = async () => {
    if (mode === 'paid') await change('fee', '600000');
    if (mode !== 'initial') await change('offer-reason', ' Raw fee change ');
  };
  const retry = async () =>
    act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid=consultation-fee-retry]')!.click()
    );
  return {
    container,
    source,
    posts,
    reads,
    field,
    change,
    submit,
    click,
    select,
    dialog,
    confirm,
    writes,
    previews,
    ready,
    retry,
    render,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
it('fences an edited raw draft across a held lazy validation import', async () => {
  const gate = deferred<void>();
  lazy.gate = gate.promise;
  const view = await mount();
  try {
    await view.change('fee', '');
    await view.submit();
    await vi.waitFor(() => expect(lazy.started).toBe(true));
    await view.change('fee', '200000');
    await act(async () => gate.resolve());
    expect(view.field('fee').value).toBe('200000');
    expect(view.field('fee').getAttribute('aria-invalid')).not.toBe('true');
    expect(view.previews()).toHaveLength(0);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(button(view.container, tConsultation('issueFee', 'en')).disabled).toBe(false);
    });
    await view.submit();
    await view.dialog();
    expect(view.previews()).toHaveLength(1);
  } finally {
    lazy.gate = null;
    await view.close();
  }
});
it.each(['en', 'fa'] as const)(
  'links touched fee feedback and focuses invalid submit in %s',
  async (locale) => {
    const view = await mount({ locale });
    try {
      await view.change('fee', '0');
      await view.submit();
      await vi.waitFor(() => {
        expect(view.field('fee').getAttribute('aria-invalid')).toBe('true');
        expect(document.activeElement?.id).toBe('consultation-fee');
      });
      await vi.waitFor(() =>
        expect(view.field('fee').getAttribute('aria-describedby')).toContain(
          'consultation-fee-message'
        )
      );
      expect(view.container.querySelector('label[for=consultation-fee]')).not.toBeNull();
      expect(view.container.querySelector('#consultation-fee-message')?.textContent).toBe(
        tConsultationFee('feeInvalid', locale)
      );
      const message = view.container.querySelector('#consultation-fee-message')!;
      expect(message.parentElement?.querySelector('[aria-hidden=true]')?.textContent).toBe(
        message.textContent
      );
      expect(view.previews()).toHaveLength(0);
      expect(view.field('fee').disabled).toBe(false);
    } finally {
      await view.close();
    }
  }
);
it.each([
  { fields: ['fee'], owned: true },
  { fields: ['scope', 'deliverables'], owned: true },
  { fields: ['fee', 'expectedReviewHash'], owned: false },
  { fields: ['reason'], owned: false },
])('projects only owned complete preview metadata $fields', async ({ fields, owned }) => {
  const view = await mount({
    override: async (url) => (url.endsWith('/fee-review') ? invalid(fields) : undefined),
  });
  try {
    await view.change('scope', ' Raw scope ');
    await view.submit();
    await vi.waitFor(() => expect(view.previews()).toHaveLength(1));
    if (owned)
      await vi.waitFor(() => expect(document.activeElement?.id).toBe(`consultation-${fields[0]}`));
    else
      await vi.waitFor(() =>
        expect(view.container.textContent).toContain(tConsultation('loadError', 'en'))
      );
    expect(view.field('scope').value).toBe(' Raw scope ');
    expect(view.container.textContent).not.toContain('PRIVATE backend text');
    expect(view.field('fee').getAttribute('aria-invalid') === 'true').toBe(
      owned && fields.includes('fee')
    );
  } finally {
    await view.close();
  }
});
it.each(['success', 'owned400'] as const)(
  'ignores held stale %s preview feedback after editing',
  async (outcome) => {
    const held = deferred<Response>();
    const view = await mount({
      override: async (url) => (url.endsWith('/fee-review') ? held.promise : undefined),
    });
    try {
      await view.submit();
      await vi.waitFor(() => expect(view.previews()).toHaveLength(1));
      const input = view.previews()[0]!.body;
      const { fee, validUntil } = input;
      if (fee === undefined || validUntil === undefined)
        throw new Error('Missing captured fee terms');
      await view.change('fee', '300000');
      await act(async () =>
        held.resolve(
          outcome === 'success'
            ? Response.json(feeReview(view.source, { ...input, fee, validUntil }))
            : invalid(['fee'])
        )
      );
      expect(document.querySelector('[role=dialog]')).toBeNull();
      expect(view.field('fee').getAttribute('aria-invalid')).not.toBe('true');
      expect(view.field('fee').value).toBe('300000');
    } finally {
      await view.close();
    }
  }
);
it('suppresses duplicate lazy preparation and held preview while leaving its controls focusable', async () => {
  const held = deferred<Response>();
  const view = await mount({
    override: async (url) => (url.endsWith('/fee-review') ? held.promise : undefined),
  });
  try {
    await act(async () => {
      const form = view.container.querySelector('form[data-testid=consultation-fee-form]')!;
      for (let i = 0; i < 2; i++)
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(view.previews()).toHaveLength(1));
    expect(view.field('fee').disabled).toBe(false);
    await view.submit();
    expect(view.previews()).toHaveLength(1);
    const input = view.previews()[0]!.body;
    const { fee, validUntil } = input;
    if (fee === undefined || validUntil === undefined)
      throw new Error('Missing captured fee terms');
    await act(async () =>
      held.resolve(Response.json(feeReview(view.source, { ...input, fee, validUntil })))
    );
    await view.dialog();
  } finally {
    await view.close();
  }
});
it.each(['initial', 'replacement', 'paid'] as const)(
  'retains exact %s command after malformed receipt and rejected uncertain retry',
  async (mode) => {
    let attempt = 0;
    let review: ReturnType<typeof feeReview> | undefined;
    const view = await mount({
      mode,
      override: async (url, init) => {
        if (url.endsWith('fee-review')) {
          review = feeReview(feeSource(mode), JSON.parse(String(init?.body)));
          return Response.json(review);
        }
        if (/\/(fee|paid-fee)$/.test(url)) {
          attempt++;
          return attempt === 1
            ? Response.json({
                ...feeReceipt(review!),
                financialReview: {
                  ...review,
                  data: { ...review!.data, scope: 'Foreign same hash' },
                },
              })
            : attempt === 2
              ? invalid(['fee'])
              : Response.json(feeReceipt(review!));
        }
        return undefined;
      },
    });
    try {
      await view.ready();
      await view.submit();
      await view.confirm();
      await vi.waitFor(() =>
        expect(view.container.querySelector('[data-testid=consultation-fee-retry]')).not.toBeNull()
      );
      const first = view.writes()[0]!.body;
      expect(view.field('fee').disabled).toBe(true);
      expect(button(view.container, tConsultation('refresh', 'en')).disabled).toBe(true);
      expect(button(view.container, tConsultation('reject', 'en')).disabled).toBe(true);
      await view.select(olderWork);
      expect(view.field('fee').value).toBe(first.fee);
      await view.retry();
      await view.confirm();
      await view.click('Cancel', document);
      await view.retry();
      await view.confirm();
      await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
      expect(view.writes().map((item) => item.body)).toEqual([first, first, first]);
      expect(view.container.querySelector('[data-testid=consultation-fee-retry]')).toBeNull();
    } finally {
      await view.close();
    }
  }
);
it('uses actual password step-up without changing the captured UTC instant, body or key', async () => {
  let attempts = 0;
  const view = await mount({
    mode: 'paid',
    timezone: 'Pacific/Kiritimati',
    override: async (url) => {
      if (url.endsWith('/paid-fee') && ++attempts === 1)
        return Response.json(
          { error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code }, requiresStepUp: true },
          { status: 403 }
        );
      return undefined;
    },
  });
  try {
    await view.ready();
    await view.submit();
    await view.confirm();
    await vi.waitFor(() => expect(document.querySelector('#team-step-up-password')).not.toBeNull());
    await act(async () =>
      fill(document.querySelector<HTMLInputElement>('#team-step-up-password')!, 'password')
    );
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(view.writes()).toHaveLength(2));
    expect(view.writes()[0]!.body).toEqual(view.writes()[1]!.body);
    expect(view.writes()[1]!.body.validUntil).toBe('2099-01-01T12:30:27.123Z');
  } finally {
    await view.close();
  }
});
it.each([401, 403, 404])(
  'withdraws all current private work on preview denial %s',
  async (status) => {
    const view = await mount({
      override: async (url) =>
        url.endsWith('/fee-review') ? new Response('{}', { status }) : undefined,
    });
    try {
      await view.change('scope', 'PRIVATE draft');
      await view.submit();
      await vi.waitFor(() => expect(view.container.querySelector('#consultation-fee')).toBeNull());
      expect(view.container.textContent).not.toMatch(/PRIVATE draft|First buyer|Site survey/);
    } finally {
      await view.close();
    }
  }
);
it('fences held preview denial after a different selection takes ownership', async () => {
  const held = deferred<Response>();
  const view = await mount({
    override: async (url) => (url.endsWith('/fee-review') ? held.promise : undefined),
  });
  try {
    await view.submit();
    await vi.waitFor(() => expect(view.previews()).toHaveLength(1));
    await view.select(olderWork);
    await vi.waitFor(() =>
      expect(view.container.querySelector('#consultation-fee')).not.toBeNull()
    );
    await view.change('scope', 'New selection draft');
    await act(async () => held.resolve(new Response('{}', { status: 403 })));
    expect(view.field('scope').value).toBe('New selection draft');
    expect(view.container.textContent).toContain('Older buyer');
  } finally {
    await view.close();
  }
});
it('hides old actor private work synchronously and ignores its held preview response', async () => {
  const held = deferred<Response>();
  const view = await mount({
    override: async (url) => (url.endsWith('/fee-review') ? held.promise : undefined),
  });
  try {
    await view.submit();
    await vi.waitFor(() => expect(view.previews()).toHaveLength(1));
    await view.render('other-reviewer');
    await vi.waitFor(() =>
      expect(view.container.querySelector('#consultation-fee')).not.toBeNull()
    );
    await view.change('scope', 'New actor draft');
    await act(async () => held.resolve(new Response('{}', { status: 403 })));
    expect(view.field('scope').value).toBe('New actor draft');
  } finally {
    await view.close();
  }
});
it('invalidates held sibling GET denial before capturing a fee command and preserves raw independent reason', async () => {
  const held = deferred<Response>();
  let queues = 0;
  let review: ReturnType<typeof feeReview> | undefined;
  let writes = 0;
  const view = await mount({
    override: async (url, init) => {
      if (url.includes('/requests?') && ++queues > 1) return held.promise;
      if (url.endsWith('/fee-review')) {
        review = feeReview(feeSource(), JSON.parse(String(init?.body)));
        return Response.json(review);
      }
      if (url.endsWith('/fee') && ++writes === 1)
        return Response.json({ financialReview: { hash: review!.hash } });
      return undefined;
    },
  });
  try {
    await act(async () =>
      fill(
        view.container.querySelector<HTMLTextAreaElement>('#consultation-reason')!,
        ' Independent decision draft '
      )
    );
    await view.click(tConsultation('refresh', 'en'));
    await vi.waitFor(() => expect(queues).toBeGreaterThan(1));
    await vi.waitFor(() =>
      expect(view.container.querySelector('#consultation-fee')).not.toBeNull()
    );
    await view.submit();
    await view.dialog();
    await act(async () => held.resolve(new Response('{}', { status: 403 })));
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    await view.confirm();
    await vi.waitFor(() =>
      expect(view.container.querySelector('[data-testid=consultation-fee-retry]')).not.toBeNull()
    );
    expect(view.container.querySelector<HTMLTextAreaElement>('#consultation-reason')?.value).toBe(
      ' Independent decision draft '
    );
  } finally {
    await view.close();
  }
});
it('releases an original complete owned write rejection and restores linked focus with the raw draft', async () => {
  const view = await mount({
    mode: 'replacement',
    override: async (url) => (url.endsWith('/fee') ? invalid(['reason']) : undefined),
  });
  try {
    await view.ready();
    await view.submit();
    await view.confirm();
    await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('consultation-offer-reason'));
    expect(view.field('offer-reason').value).toBe(' Raw fee change ');
    expect(view.field('offer-reason').disabled).toBe(false);
    expect(view.container.textContent).not.toContain('PRIVATE backend text');
  } finally {
    await view.close();
  }
});

it('fences an old actor queue denial before effect cleanup can withdraw new private drafts', async () => {
  const held = deferred<Response>();
  let queues = 0;
  const view = await mount({
    override: async (url) =>
      url.includes('/requests?') && ++queues === 2 ? held.promise : undefined,
  });
  try {
    await view.click(tConsultation('refresh', 'en'));
    await vi.waitFor(() => expect(queues).toBe(2));
    await view.render('new-reviewer');
    await vi.waitFor(() =>
      expect(view.container.querySelector('#consultation-fee')).not.toBeNull()
    );
    await view.change('scope', 'New actor authorized draft');
    await act(async () => held.resolve(new Response('{}', { status: 403 })));
    expect(view.field('scope').value).toBe('New actor authorized draft');
    expect(view.container.textContent).toContain('First buyer');
  } finally {
    await view.close();
  }
});

it('preserves hidden raw ordinary terms and independent decision reason after a paid revision refresh', async () => {
  const view = await mount({ mode: 'replacement' });
  try {
    await view.change('scope', ' Raw hidden scope ');
    await view.change('deliverables', ' Raw hidden deliverables ');
    await act(async () =>
      fill(
        view.container.querySelector<HTMLTextAreaElement>('#consultation-reason')!,
        ' Independent closure draft '
      )
    );
    Object.assign(view.source, {
      status: 'offer_accepted',
      has_paid_invoice: true,
      invoice_state: 'Paid',
      fee: '500000',
    });
    await view.click(tConsultation('refresh', 'en'));
    await vi.waitFor(() => expect(view.container.querySelector('#consultation-scope')).toBeNull());
    await vi.waitFor(() =>
      expect(view.container.querySelector('#consultation-fee')).not.toBeNull()
    );
    await view.change('fee', '600000');
    await view.change('offer-reason', ' Consumed paid reason ');
    await view.submit();
    await view.confirm();
    await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
    await vi.waitFor(() => expect(view.field('offer-reason').value).toBe(''));
    expect(snapshots.read!().scope).toBe(' Raw hidden scope ');
    expect(snapshots.read!().deliverables).toBe(' Raw hidden deliverables ');
    expect(view.container.querySelector<HTMLTextAreaElement>('#consultation-reason')?.value).toBe(
      ' Independent closure draft '
    );
    expect(view.previews()[0]!.body).not.toHaveProperty('scope');
    expect(view.writes()[0]!.body).not.toHaveProperty('deliverables');
  } finally {
    await view.close();
  }
});

it('blocks fee preparation through a held or failed timezone read and enables it after a confirmed retry', async () => {
  const held = deferred<Response>();
  let timezoneReads = 0;
  const view = await mount({
    override: async (url) =>
      url.endsWith('/settings/timezone') && ++timezoneReads === 1 ? held.promise : undefined,
  });
  try {
    expect(button(view.container, tConsultation('issueFee', 'en')).disabled).toBe(true);
    expect(view.field('valid-until').disabled).toBe(true);
    await view.submit();
    expect(view.previews()).toHaveLength(0);
    expect(view.field('valid-until').getAttribute('aria-invalid')).not.toBe('true');
    await act(async () => held.resolve(new Response('{}', { status: 503 })));
    expect(button(view.container, tConsultation('issueFee', 'en')).disabled).toBe(true);
    await act(async () => window.dispatchEvent(new Event('barghsa:timezone-changed')));
    await vi.waitFor(() =>
      expect(button(view.container, tConsultation('issueFee', 'en')).disabled).toBe(false)
    );
    expect(view.field('valid-until').value).toBe('2099-01-01T12:30');
    await view.submit();
    await view.dialog();
  } finally {
    await view.close();
  }
});
it('preserves an uncertain command across actual account timezone loading/change and retries its original UTC body', async () => {
  const heldZone = deferred<Response>();
  let timezoneReads = 0;
  let writes = 0;
  let reviewed: ReturnType<typeof feeReview> | undefined;
  const view = await mount({
    override: async (url, init) => {
      if (url.endsWith('/settings/timezone') && ++timezoneReads === 2) return heldZone.promise;
      if (url.endsWith('/fee-review')) {
        reviewed = feeReview(feeSource(), JSON.parse(String(init?.body)));
        return Response.json(reviewed);
      }
      if (url.endsWith('/fee')) {
        writes++;
        return Response.json(
          writes === 1 ? { financialReview: { hash: reviewed!.hash } } : feeReceipt(reviewed!)
        );
      }
      return undefined;
    },
  });
  try {
    await view.submit();
    await view.confirm();
    await vi.waitFor(() =>
      expect(view.container.querySelector('[data-testid=consultation-fee-retry]')).not.toBeNull()
    );
    const captured = view.writes()[0]!.body,
      rawDeadline = view.field('valid-until').value;
    await act(async () => window.dispatchEvent(new Event('barghsa:timezone-changed')));
    await vi.waitFor(() => expect(timezoneReads).toBe(2));
    expect(view.field('fee').disabled).toBe(true);
    expect(view.container.querySelector('[data-testid=consultation-fee-retry]')).not.toBeNull();
    await act(async () => heldZone.resolve(Response.json({ timezone: 'Pacific/Kiritimati' })));
    expect(view.field('valid-until').value).toBe(rawDeadline);
    expect(view.field('fee').disabled).toBe(true);
    await view.retry();
    await view.confirm();
    await vi.waitFor(() => expect(view.writes()).toHaveLength(2));
    expect(view.writes()[1]!.body).toEqual(captured);
    expect(view.writes()[1]!.body.validUntil).toBe('2099-01-01T12:30:27.123Z');
    expect(view.previews()).toHaveLength(1);
  } finally {
    await view.close();
  }
});
