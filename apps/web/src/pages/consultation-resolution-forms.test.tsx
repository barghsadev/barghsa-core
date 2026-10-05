import { act, useState, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { tConsultation } from '@barghsa/i18n/consultation';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useListQuery, writeListQuery } from '../hooks/useListQuery.js';
import { consultationQueryOptions, consultationSearch } from '../lib/support-list-query.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { AdminConsultationsPage } from './AdminConsultationsPage.js';
import {
  resolutionSource,
  resolutionReview,
  resolutionReceipt,
  firstWork,
  olderWork,
} from '../test/consultation-resolution-fixtures.js';
import type * as SchemaModule from '../lib/consultation-form-schemas.js';
import type * as DialogModule from '../components/TeamActionDialog.js';
import type * as FormModule from '@barghsa/ui/form';
const lazy = vi.hoisted(() => ({ gate: null as Promise<void> | null, started: false }));
const snapshots = vi.hoisted(() => ({
  dialog: null as ComponentProps<typeof DialogModule.TeamActionDialog> | null,
  fee: null as (() => Record<string, unknown>) | null,
  hidden: null as ((scope: string, deliverables: string) => void) | null,
}));
vi.mock('@tanstack/react-router', () => ({ useSearch: () => ({}) }));
vi.mock('../lib/consultation-form-schemas.js', async (importOriginal) => {
  lazy.started = true;
  await lazy.gate;
  return importOriginal<typeof SchemaModule>();
});
vi.mock('../components/TeamActionDialog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof DialogModule>();
  return {
    ...actual,
    TeamActionDialog: (props: ComponentProps<typeof actual.TeamActionDialog>) => {
      snapshots.dialog = props;
      return <actual.TeamActionDialog {...props} />;
    },
  };
});
vi.mock('@barghsa/ui/form', async (importOriginal) => {
  const actual = await importOriginal<typeof FormModule>();
  const useZodForm: typeof actual.useZodForm = (schema, options) => {
    const form = actual.useZodForm(schema, options);
    if (options?.defaultValues && 'scope' in options.defaultValues) {
      snapshots.fee = () => form.getValues();
      snapshots.hidden = (scope, deliverables) => {
        form.reset({ ...form.getValues(), scope, deliverables });
      };
    }
    return form;
  };
  return { ...actual, useZodForm };
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { resolve, promise };
}
function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(
    element,
    value
  );
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
function button(owner: ParentNode, label: string) {
  const found = [...owner.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === label
  );
  expect(found, label).toBeDefined();
  return found!;
}
const invalid = (
  fields: unknown[],
  code: string = ErrorCodes.VALIDATION_INPUT_INVALID.code,
  status = 400
) =>
  Response.json(
    { error: { code, message: 'PRIVATE backend values', correlationId: firstWork, fields } },
    { status }
  );
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
  snapshots.dialog = null;
  lazy.gate = null;
});
async function mount(
  options: {
    mode?: 'closure' | 'recovery' | 'pending_charge';
    locale?: 'en' | 'fa';
    queryBound?: boolean;
    override?: (url: string, init?: RequestInit) => Promise<Response | undefined>;
  } = {}
) {
  const locale = options.locale ?? 'en',
    source = resolutionSource(options.mode);
  document.documentElement.lang = locale;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const posts: Array<{ url: string; raw: string; body: Record<string, string> }> = [],
    reads: string[] = [];
  let preview: ReturnType<typeof resolutionReview> | undefined;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      posts.push({ url, raw: String(init.body), body: JSON.parse(String(init.body)) });
    else reads.push(url);
    const custom = await options.override?.(url, init);
    if (custom) return custom;
    if (url.endsWith('/settings/timezone')) return Response.json({ timezone: 'UTC' });
    if (url.endsWith('/teams')) return Response.json({ teams: [{ name: 'Finance' }] });
    if (url.includes('/requests?'))
      return Response.json({
        requests: [source, { ...source, id: olderWork, profile_name: 'Older buyer' }],
        nextAfter: null,
      });
    if (url.endsWith(`/requests/${firstWork}`))
      return Response.json({ request: source, history: [] });
    if (url.endsWith(`/requests/${olderWork}`))
      return Response.json({
        request: { ...source, id: olderWork, profile_name: 'Older buyer' },
        history: [],
      });
    if (url.endsWith('/paid-resolution-review')) {
      const body = JSON.parse(String(init?.body));
      preview = resolutionReview(source, body.action, body.reason);
      return Response.json(preview);
    }
    if (/\/(paid-cancel|paid-reject|refund-recovery)$/.test(url))
      return Response.json(resolutionReceipt(preview!));
    if (url === '/api/auth/step-up') return Response.json({ verified: true });
    throw new Error(`Unexpected fixture request ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  function QueryHarness() {
    const [raw, setRaw] = useState<Record<string, unknown>>({});
    const parsed = consultationSearch(raw);
    const queue = useListQuery(consultationQueryOptions, parsed, (update) =>
      setRaw((value) => consultationSearch(update(value)))
    );
    return (
      <AdminConsultationsPage
        queries={{
          queue,
          selected: typeof parsed.requestId === 'string' ? parsed.requestId : null,
          select: (id) => setRaw((value) => ({ ...value, requestId: id ?? undefined })),
          setFilters: (filters) =>
            setRaw((value) => ({
              ...writeListQuery(value, consultationQueryOptions, { filters }),
              requestId: undefined,
            })),
        }}
      />
    );
  }
  const render = async (actor = 'reviewer') =>
    act(async () =>
      root.render(
        <AccountUserProvider value={actor}>
          {options.queryBound ? <QueryHarness /> : <AdminConsultationsPage />}
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
  await vi.waitFor(() => expect(container.querySelector('#consultation-reason')).not.toBeNull());
  const field = (name: string) =>
    container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#consultation-${name}`)!;
  const change = async (name: string, value: string) => act(async () => fill(field(name), value));
  const click = async (label: string, owner: ParentNode = container) =>
    act(async () => button(owner, label).click());
  const prepare = async (intent: 'cancel' | 'reject' | 'recover_refund' = 'cancel') =>
    click(tConsultation(intent === 'recover_refund' ? 'recoverRefund' : intent, locale));
  const dialog = async () =>
    vi.waitFor(() => expect(document.querySelector('[role=dialog]')).not.toBeNull());
  const confirm = async () => {
    await dialog();
    await click(locale === 'en' ? 'Confirm' : 'تأیید', document);
  };
  const retry = async () =>
    act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid=consultation-resolution-retry]')!
        .click()
    );
  const writes = () =>
    posts.filter((item) => /\/(paid-cancel|paid-reject|refund-recovery)$/.test(item.url));
  const previews = () => posts.filter((item) => item.url.endsWith('/paid-resolution-review'));
  return {
    source,
    container,
    field,
    change,
    click,
    prepare,
    dialog,
    confirm,
    retry,
    writes,
    previews,
    posts,
    reads,
    render,
    select,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
it('owns paid preparation synchronously across a held lazy import, rejects edited reason and blocks sibling submits', async () => {
  const gate = deferred<void>();
  lazy.gate = gate.promise;
  const view = await mount();
  try {
    await view.change('reason', ' Raw reason ');
    const cancel = button(view.container, tConsultation('cancel', 'en'));
    await act(async () => {
      cancel.click();
      cancel.click();
      view.container
        .querySelector('form[data-testid=consultation-fee-form]')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(lazy.started).toBe(true));
    expect(view.posts).toEqual([]);
    expect(
      [...view.container.querySelectorAll<HTMLSelectElement>('select')]
        .slice(0, 4)
        .every((item) => item.disabled)
    ).toBe(true);
    await view.change('reason', ' New raw reason ');
    await act(async () => gate.resolve());
    expect(view.previews()).toHaveLength(0);
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(button(view.container, tConsultation('cancel', 'en')).disabled).toBe(false);
    });
    await view.prepare();
    await view.dialog();
    expect(view.previews()).toHaveLength(1);
    expect(view.previews()[0]!.body.reason).toBe('New raw reason');
  } finally {
    gate.resolve();
    await view.close();
  }
});
it.each(['en', 'fa'] as const)(
  'reuses touched paid reason1000 validation with linked focus and complete raw retention in %s',
  async (locale) => {
    const view = await mount({ locale });
    try {
      const raw = 'x'.repeat(1001);
      await view.change('reason', raw);
      await view.prepare();
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(view.field('reason').getAttribute('aria-invalid')).toBe('true');
        expect(document.activeElement?.id).toBe('consultation-reason');
      });
      expect(view.field('reason').value).toBe(raw);
      expect(view.field('reason').getAttribute('aria-describedby')).toContain(
        'consultation-reason-message'
      );
      expect(view.container.querySelector('#consultation-reason-message')?.textContent).toContain(
        tConsultation('paidReasonInvalid1000', locale)
      );
      expect(view.posts).toEqual([]);
    } finally {
      await view.close();
    }
  }
);
it.each([
  { fields: ['reason'], owned: true },
  { fields: ['expectedReviewHash'], owned: false },
  { fields: ['reason', 'idempotencyKey'], owned: false },
])(
  'projects only complete owned preview feedback $fields and never echoes backend values',
  async ({ fields, owned }) => {
    const view = await mount({
      override: async (url) =>
        url.endsWith('/paid-resolution-review') ? invalid(fields) : undefined,
    });
    try {
      await view.change('reason', ' Raw reason ');
      await view.prepare();
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(view.previews()).toHaveLength(1);
        expect(view.container.textContent).toContain(
          tConsultation(owned ? 'paidReasonInvalid1000' : 'loadError', 'en')
        );
      });
      expect(view.field('reason').value).toBe(' Raw reason ');
      expect(view.field('reason').getAttribute('aria-invalid') === 'true').toBe(owned);
      expect(view.container.textContent).not.toContain('PRIVATE');
      expect(view.writes()).toEqual([]);
    } finally {
      await view.close();
    }
  }
);
it.each(['success', 'owned-error'] as const)(
  'suppresses a held preview %s after its raw reason is edited',
  async (kind) => {
    const gate = deferred<Response>();
    const view = await mount({
      override: async (url) => (url.endsWith('/paid-resolution-review') ? gate.promise : undefined),
    });
    try {
      await view.change('reason', 'Old reason');
      await view.prepare();
      await vi.waitFor(() => expect(view.previews()).toHaveLength(1));
      await view.change('reason', 'New reason');
      await act(async () =>
        gate.resolve(
          kind === 'success'
            ? Response.json(resolutionReview(view.source, 'cancel', 'Old reason'))
            : invalid(['reason'])
        )
      );
      expect(document.querySelector('[role=dialog]')).toBeNull();
      expect(view.field('reason').getAttribute('aria-invalid')).not.toBe('true');
      expect(view.field('reason').value).toBe('New reason');
    } finally {
      await view.close();
    }
  }
);
it.each(['cancel', 'reject', 'recover_refund'] as const)(
  'clears only the consumed reason after exact %s receipt and preserves every companion draft through refresh',
  async (intent) => {
    const view = await mount({ mode: intent === 'recover_refund' ? 'recovery' : 'closure' });
    try {
      for (const [name, value] of [
        ['fee', '700000'],
        ['scope', ' Hidden raw scope '],
        ['deliverables', ' Hidden raw report '],
        ['valid-until', '2030-03-01T12:17'],
        ['offer-reason', ' Independent raw offer reason '],
        ['reason', ' Raw resolution reason '],
      ] as const) {
        if (view.field(name)) await view.change(name, value);
      }
      const team = view.container.querySelector<HTMLSelectElement>('#consultation-team')!;
      await act(async () => {
        team.value = 'Finance';
        team.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await act(async () => snapshots.hidden!(' Hidden raw scope ', ' Hidden raw report '));
      const before = structuredClone(snapshots.fee!());
      await view.prepare(intent);
      await view.confirm();
      await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
      await vi.waitFor(() => expect(view.field('reason')).not.toBeNull());
      expect(view.field('reason').value).toBe('');
      expect(snapshots.fee!()).toEqual(before);
      expect(view.container.querySelector<HTMLSelectElement>('#consultation-team')?.value).toBe(
        'Finance'
      );
      expect(view.writes()).toHaveLength(1);
      expect(view.writes()[0]!.body.reason).toBe('Raw resolution reason');
    } finally {
      await view.close();
    }
  }
);
it.each([
  'transport',
  'server',
  'malformed',
  'foreign',
  'status',
  'same-hash-plan',
  'unexpected-success-status',
] as const)(
  'retains exact reviewed command after %s uncertainty and never uses GET or another family to unlock it',
  async (failure) => {
    let attempts = 0;
    const view = await mount({
      override: async (url) => {
        if (!url.endsWith('/paid-cancel')) return undefined;
        ++attempts;
        if (attempts > 1) return undefined;
        if (failure === 'transport') throw new Error('Lost response');
        if (failure === 'server') return Response.json({ error: 'error' }, { status: 503 });
        const review = resolutionReview(resolutionSource(), 'cancel', 'Raw resolution reason');
        const receipt = resolutionReceipt(review);
        if (failure === 'malformed') return Response.json({ requestId: firstWork });
        if (failure === 'foreign') return Response.json({ ...receipt, requestId: olderWork });
        if (failure === 'status') return Response.json({ ...receipt, status: 'rejected' });
        if (failure === 'same-hash-plan')
          return Response.json({
            ...receipt,
            financialReview: { ...review, data: { ...review.data, reason: 'Other reason' } },
          });
        return Response.json(receipt, { status: 201 });
      },
    });
    try {
      await view.change('reason', ' Raw resolution reason ');
      await view.prepare();
      await view.confirm();
      await vi.waitFor(() =>
        expect(
          view.container.querySelector('[data-testid=consultation-resolution-retry]')
        ).not.toBeNull()
      );
      const reads = view.reads.length;
      expect(button(view.container, tConsultation('refresh', 'en')).disabled).toBe(true);
      await act(async () =>
        view.container
          .querySelector('form[data-testid=consultation-fee-form]')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      );
      expect(view.reads).toHaveLength(reads);
      expect(view.previews()).toHaveLength(1);
      expect(view.field('reason').disabled).toBe(true);
      expect(view.field('reason').value).toBe(' Raw resolution reason ');
      await view.retry();
      await view.confirm();
      await vi.waitFor(() => expect(view.writes()).toHaveLength(2));
      expect(view.writes()[1]!.raw).toBe(view.writes()[0]!.raw);
      await vi.waitFor(() =>
        expect(
          view.container.querySelector('[data-testid=consultation-resolution-retry]')
        ).toBeNull()
      );
      expect(view.previews()).toHaveLength(1);
    } finally {
      await view.close();
    }
  }
);
it('a rejected uncertain retry and closed retry dialog cannot discard the earlier captured command', async () => {
  let attempts = 0;
  const view = await mount({
    override: async (url) => {
      if (!url.endsWith('/paid-cancel')) return undefined;
      ++attempts;
      return attempts === 1
        ? Response.json(null, { status: 503 })
        : attempts === 2
          ? invalid(['reason'])
          : undefined;
    },
  });
  try {
    await view.change('reason', 'Resolution reason');
    await view.prepare();
    await view.confirm();
    await view.retry();
    await view.confirm();
    await view.click('Cancel', document);
    expect(
      view.container.querySelector('[data-testid=consultation-resolution-retry]')
    ).not.toBeNull();
    expect(view.field('reason').getAttribute('aria-invalid')).not.toBe('true');
    await view.retry();
    await view.confirm();
    expect(view.writes()).toHaveLength(3);
    expect(new Set(view.writes().map((item) => item.raw)).size).toBe(1);
    expect(view.previews()).toHaveLength(1);
  } finally {
    await view.close();
  }
});
it('first complete owned write rejection unlocks only that reason and focuses its local feedback', async () => {
  const view = await mount({
    override: async (url) => (url.endsWith('/paid-cancel') ? invalid(['reason']) : undefined),
  });
  try {
    await view.change('reason', ' Raw resolution reason ');
    await view.prepare();
    await view.confirm();
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.querySelector('[role=dialog]')).toBeNull();
      expect(document.activeElement?.id).toBe('consultation-reason');
    });
    expect(view.field('reason').getAttribute('aria-invalid')).toBe('true');
    expect(view.field('reason').value).toBe(' Raw resolution reason ');
    expect(view.container.querySelector('[data-testid=consultation-resolution-retry]')).toBeNull();
  } finally {
    await view.close();
  }
});
it('password step-up resends exactly the captured paid body and duplicate confirmation cannot create another write', async () => {
  let attempts = 0;
  const view = await mount({
    override: async (url) => {
      if (!url.endsWith('/paid-cancel')) return undefined;
      ++attempts;
      return attempts === 1
        ? Response.json(
            { requiresStepUp: true, error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code } },
            { status: 403 }
          )
        : undefined;
    },
  });
  try {
    await view.change('reason', ' Raw resolution reason ');
    await view.prepare();
    await view.confirm();
    await vi.waitFor(() => expect(document.querySelector('#team-step-up-password')).not.toBeNull());
    await act(async () =>
      fill(document.querySelector<HTMLInputElement>('#team-step-up-password')!, 'password')
    );
    const confirm = button(document, 'Confirm');
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    await vi.waitFor(() => expect(view.writes()).toHaveLength(2));
    expect(view.posts.filter((item) => item.url === '/api/auth/step-up')).toHaveLength(1);
    expect(view.writes()[1]!.raw).toBe(view.writes()[0]!.raw);
    expect(view.previews()).toHaveLength(1);
  } finally {
    await view.close();
  }
});
it.each([401, 403, 404])(
  'current paid preview %s withdraws private workspace and companion drafts',
  async (status) => {
    const view = await mount({
      override: async (url) =>
        url.endsWith('/paid-resolution-review') ? Response.json(null, { status }) : undefined,
    });
    try {
      await view.change('reason', 'Private reason');
      await view.change('offer-reason', 'Private fee reason');
      await view.prepare();
      await vi.waitFor(() =>
        expect(view.container.querySelector('#consultation-reason')).toBeNull()
      );
      expect(view.container.textContent).not.toContain('First buyer');
      expect(snapshots.fee!().reason).toBe('');
    } finally {
      await view.close();
    }
  }
);
it('late old-actor preview and dialog callbacks cannot clear a new selected draft', async () => {
  const gate = deferred<Response>();
  let previews = 0;
  const view = await mount({
    override: async (url) =>
      url.endsWith('/paid-resolution-review') && ++previews === 1 ? gate.promise : undefined,
  });
  try {
    await view.change('reason', 'Old actor reason');
    await view.prepare();
    await view.render('new-reviewer');
    await view.select();
    await view.change('reason', 'New actor reason');
    await act(async () => gate.resolve(Response.json(null, { status: 403 })));
    expect(view.field('reason').value).toBe('New actor reason');
    await view.prepare();
    await view.dialog();
    const old = snapshots.dialog!;
    await view.render('third-reviewer');
    await view.select();
    await view.change('reason', 'Third actor reason');
    await act(async () => {
      old.onDenied?.(403);
      old.onClose();
      old.onUnconfirmed?.();
    });
    expect(view.field('reason').value).toBe('Third actor reason');
    expect(view.container.querySelector('[data-testid=consultation-resolution-retry]')).toBeNull();
  } finally {
    gate.resolve(Response.json(null, { status: 403 }));
    await view.close();
  }
});

it.each([403, 404])(
  'current paid write %s withdraws the accepted resource and captured owner',
  async (status) => {
    const view = await mount({
      override: async (url) =>
        url.endsWith('/paid-cancel')
          ? status === 404
            ? invalid([], ErrorCodes.NOT_FOUND_RESOURCE.code, 404)
            : Response.json(null, { status })
          : undefined,
    });
    try {
      await view.change('reason', 'Private captured reason');
      await view.prepare();
      await view.confirm();
      await vi.waitFor(() =>
        expect(view.container.querySelector('#consultation-reason')).toBeNull()
      );
      expect(view.container.textContent).not.toContain('First buyer');
      expect(
        view.container.querySelector('[data-testid=consultation-resolution-retry]')
      ).toBeNull();
    } finally {
      await view.close();
    }
  }
);
it('unclassified complete4xx cannot release a command whose outcome is unproved', async () => {
  let attempts = 0;
  const view = await mount({
    override: async (url) =>
      url.endsWith('/paid-cancel') && ++attempts === 1
        ? invalid(['reason'], 'UNKNOWN:REJECTION', 409)
        : undefined,
  });
  try {
    await view.change('reason', 'Resolution reason');
    await view.prepare();
    await view.confirm();
    await view.click('Cancel', document);
    expect(
      view.container.querySelector('[data-testid=consultation-resolution-retry]')
    ).not.toBeNull();
    await view.retry();
    await view.confirm();
    expect(view.writes()[1]!.raw).toBe(view.writes()[0]!.raw);
    expect(view.previews()).toHaveLength(1);
  } finally {
    await view.close();
  }
});

it('retries the same unaccepted URL-bound More cursor after paid preparation aborts a held page read, without allowing an accepted-page cycle', async () => {
  const gate = deferred<Response>();
  let pages = 0;
  const view = await mount({
    queryBound: true,
    override: async (url) => {
      if (!url.includes('/requests?')) return undefined;
      if (!new URL(url, 'https://fixture.invalid').searchParams.has('after'))
        return Response.json({ requests: [resolutionSource()], nextAfter: olderWork });
      ++pages;
      return pages === 1
        ? gate.promise
        : Response.json({
            requests: [{ ...resolutionSource(), id: olderWork, profile_name: 'Older buyer' }],
            nextAfter: null,
          });
    },
  });
  try {
    await view.click(tConsultation('moreWork', 'en'));
    await vi.waitFor(() => expect(pages).toBe(1));
    await view.change('reason', 'Resolution reason');
    await view.prepare();
    await view.dialog();
    await view.click('Cancel', document);
    const more = button(view.container, tConsultation('moreWork', 'en'));
    expect(more.disabled).toBe(false);
    await view.click(tConsultation('moreWork', 'en'));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(pages).toBe(2);
      expect(view.container.textContent).toContain('Older buyer');
    });
    expect(view.reads.filter((url) => url.includes('after='))).toHaveLength(2);
    expect(new Set(view.reads.filter((url) => url.includes('after='))).size).toBe(1);
    await act(async () => gate.resolve(Response.json(null, { status: 403 })));
    expect(view.field('reason').value).toBe('Resolution reason');
    expect(
      [...view.container.querySelectorAll<HTMLButtonElement>('button')].find(
        (item) => item.textContent?.trim() === tConsultation('moreWork', 'en')
      )?.disabled
    ).toBe(true);
  } finally {
    gate.resolve(Response.json(null, { status: 403 }));
    await view.close();
  }
});
