import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import { tConsultation } from '@barghsa/i18n/consultation';
import { AdminConsultationsPage } from './AdminConsultationsPage.js';
import { consultationWork, firstWork, olderWork } from '../test/staff-business-fixtures.js';

vi.mock('@tanstack/react-router', () => ({ useSearch: () => ({}) }));
type EventRow = {
  status: string;
  actor_type: 'staff' | 'customer';
  reason: string | null;
  created_at: string;
};
const initialEvent: EventRow = {
  status: 'under_review',
  actor_type: 'staff',
  reason: 'Existing staff history',
  created_at: '2026-09-23T10:00:00.000Z',
};
function detail(paid = false, id = firstWork) {
  return {
    request: {
      ...consultationWork(id),
      status: paid ? 'offer_accepted' : 'under_review',
      has_paid_invoice: paid,
      invoice_id: paid ? olderWork : null,
      invoice_state: paid ? 'Paid' : null,
    },
    history: [{ ...initialEvent }] as EventRow[],
  };
}
const invalid = (fields: unknown[]) =>
  Response.json(
    { error: { code: ErrorCodes.VALIDATION_INPUT_INVALID.code, fields, message: 'PRIVATE error' } },
    { status: 400 }
  );
function button(owner: ParentNode, text: string) {
  const match = [...owner.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === text
  );
  expect(match, text).toBeDefined();
  return match!;
}
function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(
    element,
    value
  );
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});
async function mount(
  override: (url: string, options?: RequestInit) => Promise<Response | undefined>,
  data = detail(),
  locale: 'en' | 'fa' = 'en'
) {
  document.documentElement.lang = locale;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      const overridden = await override(url, options);
      if (overridden) return overridden;
      if (url.endsWith('/settings/timezone')) return Response.json({ timezone: 'UTC' });
      if (url.endsWith('/teams')) return Response.json({ teams: [] });
      if (url.includes('/requests?'))
        return Response.json({
          requests: [data.request, detail(false, olderWork).request],
          nextAfter: null,
        });
      if (url.endsWith(`/requests/${firstWork}`)) return Response.json(data);
      if (url.endsWith(`/requests/${olderWork}`)) return Response.json(detail(false, olderWork));
      throw new Error(`Unexpected fixture request: ${url}`);
    })
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<AdminConsultationsPage />));
  const select = async (id = firstWork) =>
    act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((item) =>
          item.textContent?.includes(id === firstWork ? 'First buyer' : 'Older buyer')
        )!
        .click();
    });
  await select();
  await vi.waitFor(() => expect(container.querySelector('#consultation-reason')).not.toBeNull());
  const reason = () => container.querySelector<HTMLTextAreaElement>('#consultation-reason')!;
  const click = async (text: string, owner: ParentNode = container) =>
    act(async () => button(owner, text).click());
  const change = async (value: string) => act(async () => fill(reason(), value));
  const recover = async () =>
    act(async () => {
      const alert = [...container.querySelectorAll('[role=alert]')].find((item) =>
        item.textContent?.includes(tConsultation('actionUnconfirmed', locale))
      )!;
      button(alert, tConsultation('retry', locale)).click();
    });
  return {
    container,
    reason,
    click,
    change,
    select,
    recover,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
const dialog = () =>
  vi.waitFor(() => expect(document.querySelector('[role=dialog]')).not.toBeNull());

it.each(['en', 'fa'] as const)(
  'shows linked touched errors and preserves raw reasons at the nonfinancial limit (%s)',
  async (locale) => {
    const writes: unknown[] = [];
    const view = await mount(
      async (_url, options) => {
        if (options?.method === 'POST') {
          writes.push(JSON.parse(String(options.body)));
          return invalid(['reason']);
        }
        return undefined;
      },
      detail(),
      locale
    );
    try {
      const action = tConsultation('requestInfo', locale);
      expect(button(view.container, action).disabled).toBe(false);
      await view.click(action);
      await vi.waitFor(() => expect(view.reason().getAttribute('aria-invalid')).toBe('true'));
      await vi.waitFor(() => expect(document.activeElement?.id).toBe('consultation-reason'));
      const message = view.container.querySelector('#consultation-reason-message')!;
      expect(message.textContent).toBe(tConsultation('reasonInvalid2000', locale));
      expect(view.reason().getAttribute('aria-describedby')).toContain(
        'consultation-reason-message'
      );
      expect(view.container.querySelector('label[for=consultation-reason]')).not.toBeNull();
      expect(message.parentElement?.querySelector('[aria-hidden=true]')?.textContent).toBe(
        message.textContent
      );
      expect(
        view.container.querySelector(
          `form[aria-label="${tConsultation('reasonFormTitle', locale)}"]`
        )
      ).not.toBeNull();
      expect(writes).toEqual([]);
      const raw = ` ${'r'.repeat(2000)} `;
      await view.change(raw);
      await view.click(action);
      await dialog();
      await view.click(locale === 'en' ? 'Confirm' : 'تأیید', document);
      await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
      expect(writes).toEqual([{ reason: raw.trim() }]);
      expect(view.reason().value).toBe(raw);
      expect(document.body.textContent).not.toContain('PRIVATE error');
    } finally {
      await view.close();
    }
  }
);

it('uses 1000 for a paid closure and 2000 for completion when switching the shared reason intent', async () => {
  const calls: string[] = [];
  const view = await mount(async (url, options) => {
    if (options?.method === 'POST') {
      calls.push(url);
      return invalid(['reason']);
    }
    return undefined;
  }, detail(true));
  try {
    await view.change('r'.repeat(1001));
    await view.click(tConsultation('reject', 'en'));
    await vi.waitFor(() =>
      expect(view.container.querySelector('#consultation-reason-message')?.textContent).toBe(
        tConsultation('paidReasonInvalid1000', 'en')
      )
    );
    expect(calls).toEqual([]);
    expect(view.reason().value).toBe('r'.repeat(1001));
    await view.change('r'.repeat(2000));
    await view.click(tConsultation('complete', 'en'));
    await dialog();
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
    expect(calls).toEqual([`/api/admin/consultations/requests/${firstWork}/complete`]);
    expect(view.container.querySelector('#consultation-reason-message')?.textContent).toBe(
      tConsultation('reasonInvalid2000', 'en')
    );
    expect(view.reason().value).toHaveLength(2000);
  } finally {
    await view.close();
  }
});

it('suppresses same-tick lazy preparations and confirmations until the captured command settles', async () => {
  let release: ((value: Response) => void) | undefined;
  const writes: unknown[] = [];
  const view = await mount(async (_url, options) => {
    if (options?.method === 'POST') {
      writes.push(JSON.parse(String(options.body)));
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return undefined;
  });
  try {
    await view.change(' Captured reason ');
    await act(async () => {
      button(view.container, tConsultation('requestInfo', 'en')).click();
      button(view.container, tConsultation('reject', 'en')).click();
    });
    await dialog();
    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1);
    expect(document.querySelector('[role=dialog]')?.textContent).toContain(
      tConsultation('requestInfo', 'en')
    );
    await act(async () => {
      button(document, 'Confirm').click();
      button(document, 'Confirm').click();
    });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(view.reason().disabled).toBe(true);
    expect(writes).toEqual([{ reason: 'Captured reason' }]);
    await act(async () => release!(invalid(['reason'])));
    await vi.waitFor(() => expect(view.reason().disabled).toBe(false));
  } finally {
    await view.close();
  }
});

it('fences a superseded lazy reason resolver from opening a dialog or attaching errors to another selection', async () => {
  let writes = 0;
  const view = await mount(async (_url, options) => {
    if (options?.method === 'POST') {
      writes++;
      return invalid(['reason']);
    }
    return undefined;
  });
  try {
    await act(async () => {
      button(view.container, tConsultation('requestInfo', 'en')).click();
      [...view.container.querySelectorAll<HTMLButtonElement>('button')]
        .find((item) => item.textContent?.includes('Older buyer'))!
        .click();
    });
    await vi.waitFor(() => expect(view.container.textContent).toContain('Older buyer'));
    await vi.waitFor(() => expect(view.reason()).not.toBeNull());
    await view.change('New selected reason');
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(view.reason().getAttribute('aria-invalid')).not.toBe('true');
    expect(view.reason().value).toBe('New selected reason');
    expect(writes).toBe(0);
  } finally {
    await view.close();
  }
});

it('accepts only owned server reasons and returns focus without clearing independent offer input', async () => {
  let fields: unknown[] = ['reason'];
  const view = await mount(async (_url, options) =>
    options?.method === 'POST' ? invalid(fields) : undefined
  );
  try {
    const scope = [...view.container.querySelectorAll<HTMLTextAreaElement>('textarea')].find(
      (item) => item.value === 'Site survey'
    )!;
    await act(async () => fill(scope, 'Independent unsaved scope'));
    await view.change(' Raw reason ');
    await view.click(tConsultation('requestInfo', 'en'));
    await dialog();
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('consultation-reason'));
    expect(scope.value).toBe('Independent unsaved scope');
    expect(view.reason().value).toBe(' Raw reason ');
    fields = ['reason', 'privateRevision'];
    await view.click(tConsultation('requestInfo', 'en'));
    await dialog();
    await view.click('Confirm', document);
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    expect(view.reason().getAttribute('aria-invalid')).not.toBe('true');
    expect(document.body.textContent).not.toMatch(/PRIVATE error|privateRevision/);
  } finally {
    await view.close();
  }
});

it('retries the identical captured reason after step-up and retains the owning draft on field rejection', async () => {
  const bodies: string[] = [];
  let proofs = 0;
  const view = await mount(async (url, options) => {
    if (url === '/api/auth/step-up') {
      proofs++;
      return Response.json({ verified: true });
    }
    if (options?.method === 'POST') {
      bodies.push(String(options.body));
      return bodies.length === 1
        ? Response.json(
            { error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code } },
            { status: 403 }
          )
        : invalid(['reason']);
    }
    return undefined;
  });
  try {
    await view.change(' Keep captured reason ');
    await view.click(tConsultation('requestInfo', 'en'));
    await dialog();
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(document.querySelector('#team-step-up-password')).not.toBeNull());
    await act(async () =>
      fill(
        document.querySelector<HTMLInputElement>('#team-step-up-password')!,
        'test-only-password'
      )
    );
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
    expect(proofs).toBe(1);
    expect(bodies).toEqual([
      JSON.stringify({ reason: 'Keep captured reason' }),
      JSON.stringify({ reason: 'Keep captured reason' }),
    ]);
    expect(view.reason().value).toBe(' Keep captured reason ');
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('consultation-reason'));
  } finally {
    await view.close();
  }
});

it.each(['lost', 'wrong-receipt'] as const)(
  'locks %s until a post-settlement authorized read proves the appended exact staff reason',
  async (mode) => {
    let writes = 0;
    let readMode = 'old';
    const data = detail();
    const view = await mount(async (url, options) => {
      if (options?.method === 'POST') {
        writes++;
        return mode === 'lost'
          ? new Response('{}', { status: 503 })
          : Response.json({ requestId: olderWork, status: 'awaiting_customer_info' });
      }
      if (url.endsWith(`/requests/${firstWork}`) && readMode === 'malformed')
        return Response.json({ ...data, history: [null] });
      return undefined;
    }, data);
    try {
      const fee = [...view.container.querySelectorAll<HTMLInputElement>('input')].find(
        (item) => item.value === '100000'
      )!;
      await act(async () => fill(fee, '123000'));
      await view.change(' Saved staff reason ');
      await view.click(tConsultation('requestInfo', 'en'));
      await dialog();
      await view.click('Confirm', document);
      await vi.waitFor(() => expect(button(document, 'Confirm').disabled).toBe(true));
      await view.click('Cancel', document);
      expect(view.reason().value).toBe(' Saved staff reason ');
      expect(button(view.container, tConsultation('requestInfo', 'en')).disabled).toBe(true);
      await view.recover();
      expect(view.reason().disabled).toBe(true);
      expect(writes).toBe(1);
      readMode = 'malformed';
      await view.recover();
      expect(view.container.querySelector('#consultation-reason')).toBeNull();
      expect(view.container.textContent).toContain(tConsultation('detailLoadError', 'en'));
      readMode = 'old';
      data.history.push({
        status: 'awaiting_customer_info',
        actor_type: 'staff',
        reason: 'Different reason',
        created_at: '2026-09-23T10:01:00.000Z',
      });
      await view.recover();
      expect(view.reason().value).toBe(' Saved staff reason ');
      expect(view.reason().disabled).toBe(true);
      data.history.push({
        status: 'awaiting_customer_info',
        actor_type: 'staff',
        reason: 'Saved staff reason',
        created_at: '2026-09-23T10:02:00.000Z',
      });
      await view.recover();
      await vi.waitFor(() => expect(view.reason().disabled).toBe(false));
      expect(view.reason().value).toBe('');
      expect(view.container.textContent).not.toContain(tConsultation('actionUnconfirmed', 'en'));
      expect(
        [...view.container.querySelectorAll<HTMLInputElement>('input')].some(
          (item) => item.value === '123000'
        )
      ).toBe(true);
      expect(writes).toBe(1);
    } finally {
      await view.close();
    }
  }
);

it('clears only the matching reason receipt and preserves independent fee, scope and delivery drafts', async () => {
  const writes: unknown[] = [];
  const view = await mount(async (_url, options) => {
    if (options?.method === 'POST') {
      writes.push(JSON.parse(String(options.body)));
      return Response.json({ requestId: firstWork, status: 'awaiting_customer_info' });
    }
    return undefined;
  });
  try {
    const fee = [...view.container.querySelectorAll<HTMLInputElement>('input')].find(
      (item) => item.value === '100000'
    )!;
    const scope = [...view.container.querySelectorAll<HTMLTextAreaElement>('textarea')].find(
      (item) => item.value === 'Site survey'
    )!;
    const deliverables = [...view.container.querySelectorAll<HTMLTextAreaElement>('textarea')].find(
      (item) => item.value === 'Report'
    )!;
    await act(async () => {
      fill(fee, '123000');
      fill(scope, 'Unsaved scope');
      fill(deliverables, 'Unsaved deliverables');
    });
    await view.change(' Confirmed reason ');
    await view.click(tConsultation('requestInfo', 'en'));
    await dialog();
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
    await vi.waitFor(() => expect(view.reason().value).toBe(''));
    expect(writes).toEqual([{ reason: 'Confirmed reason' }]);
    expect(
      [...view.container.querySelectorAll('input,textarea')].map(
        (item) => (item as HTMLInputElement).value
      )
    ).toEqual(expect.arrayContaining(['123000', 'Unsaved scope', 'Unsaved deliverables']));
  } finally {
    await view.close();
  }
});

it('withdraws private work on write denial and fences an already pending queue read', async () => {
  let release: ((value: Response) => void) | undefined;
  const data = detail();
  const view = await mount(async (url, options) => {
    if (options?.method === 'POST') return new Response('{}', { status: 403 });
    if (url.includes('/requests?')) {
      if (new URL(url, 'http://localhost').searchParams.has('after'))
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      return Response.json({ requests: [data.request], nextAfter: firstWork });
    }
    return undefined;
  }, data);
  try {
    await view.change('Private unsaved reason');
    await view.click(tConsultation('moreWork', 'en'));
    await vi.waitFor(() => expect(release).toBeDefined());
    await view.click(tConsultation('requestInfo', 'en'));
    await dialog();
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(view.container.querySelector('#consultation-reason')).toBeNull());
    await act(async () =>
      release!(Response.json({ requests: [detail(false, olderWork).request], nextAfter: null }))
    );
    expect(view.container.textContent).not.toMatch(
      /First buyer|Older buyer|Private unsaved reason|Existing staff history/
    );
    expect(view.container.textContent).toContain(tConsultation('queueForbidden', 'en'));
  } finally {
    await view.close();
  }
});
