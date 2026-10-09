import { QueryComponentProvider } from '../test/query-provider.js';
import { act, useLayoutEffect, useRef, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { tSolar } from '@barghsa/i18n/solar';
import { ErrorCodes } from '@barghsa/shared/errors';
import type * as UiModule from '@barghsa/ui';
import { SolarPostalTrackingEditor } from './SolarPostalTrackingEditor.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import type { TeamActionDialog } from './TeamActionDialog.js';
import type { SolarTrackingCommand, SolarTrackingSnapshot } from '../lib/solar-tracking-form.js';
let recentClose: (() => void) | undefined;
vi.mock('@barghsa/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof UiModule>();
  return {
    ...actual,
    DatePicker: ({
      id,
      disabled,
      triggerProps,
      onBlur,
    }: ComponentProps<typeof actual.DatePicker>) => (
      <button {...triggerProps} id={id} type="button" disabled={disabled} onBlur={onBlur}>
        Calendar
      </button>
    ),
  };
});
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({
    status: 'ready',
    timezone: 'UTC',
    format: (value: string) => value,
    notice: null,
  }),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: (props: ComponentProps<typeof TeamActionDialog>) => {
    recentClose = props.onClose;
    const pending = useRef(false);
    return (
      <div role="dialog">
        {props.summary}
        <button
          type="button"
          onClick={() =>
            void (async () => {
              if (pending.current || !props.action) return;
              pending.current = true;
              props.onPendingChange?.(true);
              try {
                const response = await fetch(props.action.path, {
                  method: props.action.method,
                  body: JSON.stringify(props.action.body),
                });
                const value = await response.json();
                if ([401, 403].includes(response.status)) props.onDenied?.();
                else if (response.status >= 500) props.onUnconfirmed?.();
                else if (
                  response.status === 400 &&
                  props.onValidationError?.(value.error?.fields ?? [])
                )
                  props.onClose();
                else if (!response.ok) {
                  const message = props.action.errorMessages?.[value.error?.code];
                  if (typeof message === 'function') message(value);
                } else if (response.ok) {
                  await props.onSuccess(value);
                  props.onClose();
                }
              } catch {
                props.onUnconfirmed?.();
              } finally {
                pending.current = false;
                props.onPendingChange?.(false);
              }
            })()
          }
        >
          Confirm test update
        </button>
        <button type="button" onClick={props.onClose}>
          Close test review
        </button>
      </div>
    );
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
  recentClose = undefined;
});
const requestId = '89000000-0000-4000-8000-000000000001';
const otherRequest = '89000000-0000-4000-8000-000000000004';
const initial: SolarTrackingSnapshot = {
  requestId,
  profileId: '89000000-0000-4000-8000-000000000002',
  requestStatus: 'waiting_for_postal_submission',
  postalStatus: 'shipped',
  courier: 'Private courier',
  trackingNumber: 'PRIVATE-PARCEL',
  sendDate: '2026-10-01',
  receiptImageId: null,
  estimatedArrivalDate: null,
  trackingUrl: null,
  note: null,
  revision: 0,
  recordedAt: null,
  canEdit: true,
};
const copy = (key: string, locale: 'en' | 'fa' = 'en') => tSolar(key, locale);
const validation = (fields: unknown[]) =>
  Response.json(
    {
      error: {
        code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
        fields,
        message: 'PRIVATE BACKEND DETAIL',
        correlationId: requestId,
      },
    },
    { status: 400 }
  );
function review(body: SolarTrackingCommand, snapshot = initial) {
  return {
    schemaVersion: 1,
    hash: 'a'.repeat(64),
    scope: {
      action: 'solar.postal.tracking',
      profileId: snapshot.profileId,
      resourceId: snapshot.requestId,
    },
    data: {
      ...snapshot,
      ...body,
      previousEstimatedArrivalDate: snapshot.estimatedArrivalDate,
      previousTrackingUrl: snapshot.trackingUrl,
      previousNote: snapshot.note,
      expectedRevision: body.expectedRevision,
      customerVisible: true,
      confirmsReceipt: false,
      createsContract: false,
      collectsPayment: false,
    },
  };
}
function receipt(body: SolarTrackingCommand) {
  const { canEdit: _canEdit, ...snapshot } = initial;
  return {
    ...snapshot,
    ...body,
    revision: body.expectedRevision + 1,
    recordedAt: '2026-10-02T10:00:00Z',
  };
}
function button(host: ParentNode, text: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === text
  );
  expect(found, text).toBeDefined();
  return found!;
}
function ScopeProbe({ actor, inspect }: { actor: string; inspect?: () => void }) {
  useLayoutEffect(() => {
    inspect?.();
  }, [actor]);
  return null;
}
async function mount(
  handler: (url: string, options?: RequestInit) => Promise<Response>,
  locale: 'en' | 'fa' = 'en'
) {
  document.documentElement.lang = locale;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(handler));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const saved = vi.fn(),
    denied = vi.fn();
  const render = async (id = requestId, actor = 'staff-one', inspect?: () => void) =>
    act(async () =>
      root.render(
        <QueryComponentProvider>
          {
            <AccountUserProvider value={actor}>
              <SolarPostalTrackingEditor requestId={id} onSaved={saved} onDenied={denied} />
              <ScopeProbe actor={actor} {...(inspect ? { inspect } : {})} />
            </AccountUserProvider>
          }
        </QueryComponentProvider>
      )
    );
  await render();
  await vi.waitFor(() => expect(host.querySelector('#postal-tracking-form')).not.toBeNull());
  const fill = async (id: string, value: string) =>
    act(async () => {
      const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
      const prototype =
        input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const submit = async () =>
    act(async () => {
      host
        .querySelector('#postal-tracking-form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  const click = async (text: string) => act(async () => button(host, text).click());
  return {
    host,
    saved,
    denied,
    render,
    fill,
    submit,
    click,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
it.each(['en', 'fa'] as const)(
  'validates touched notes with linked focus and stable reserved copy (%s)',
  async (locale) => {
    const previews: SolarTrackingCommand[] = [];
    const view = await mount(async (url, options) => {
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        previews.push(body);
        return Response.json(review(body));
      }
      return Response.json(initial);
    }, locale);
    try {
      expect(view.host.querySelector('#postal-tracking-note-message')).toBeNull();
      await view.fill('postal-tracking-note', 'n'.repeat(1001));
      await act(async () =>
        view.host
          .querySelector<HTMLElement>('#postal-tracking-note')!
          .dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      );
      await vi.waitFor(() =>
        expect(view.host.querySelector('#postal-tracking-note-message')?.textContent).toBe(
          copy('postalTrackingNoteInvalid', locale)
        )
      );
      await view.submit();
      await vi.waitFor(() => expect(document.activeElement?.id).toBe('postal-tracking-note'));
      const control = view.host.querySelector('#postal-tracking-note')!;
      expect(control.getAttribute('aria-invalid')).toBe('true');
      expect(control.getAttribute('aria-describedby')).toContain('postal-tracking-note-message');
      const message = view.host.querySelector('#postal-tracking-note-message')!;
      expect(message.parentElement?.querySelector('[aria-hidden=true]')?.textContent).toBe(
        message.textContent
      );
      expect(message.classList.contains('col-start-1')).toBe(true);
      expect(previews).toHaveLength(0);
      await view.fill('postal-tracking-note', `  ${'n'.repeat(1000)}  `);
      await view.fill('postal-tracking-url', '  https://Courier.example:443  ');
      await view.submit();
      await vi.waitFor(() => expect(view.host.querySelector('[role=dialog]')).not.toBeNull());
      expect(previews).toHaveLength(1);
      expect(previews[0]).toMatchObject({
        note: 'n'.repeat(1000),
        trackingUrl: 'https://courier.example/',
        estimatedArrivalDate: null,
        expectedRevision: 0,
      });
    } finally {
      await view.close();
    }
  }
);
it('projects only owned preview fields and focuses the date trigger without losing raw input', async () => {
  const view = await mount(async (_url, options) =>
    options?.method === 'POST' ? validation(['estimatedArrivalDate']) : Response.json(initial)
  );
  try {
    await view.fill('postal-tracking-note', '  Valid customer note  ');
    await view.submit();
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('postal-arrival-estimate'));
    expect(view.host.querySelector('#postal-arrival-estimate')?.getAttribute('aria-invalid')).toBe(
      'true'
    );
    expect(
      view.host.querySelector('#postal-arrival-estimate')?.getAttribute('aria-describedby')
    ).toContain('postal-arrival-estimate-message');
    expect(view.host.querySelector<HTMLTextAreaElement>('#postal-tracking-note')?.value).toBe(
      '  Valid customer note  '
    );
    expect(view.host.textContent).not.toContain('PRIVATE BACKEND DETAIL');
  } finally {
    await view.close();
  }
});
it('keeps mixed protected preview feedback generic and preserves all drafts', async () => {
  const view = await mount(async (_url, options) =>
    options?.method === 'POST' ? validation(['note', 'expectedRevision']) : Response.json(initial)
  );
  try {
    await view.fill('postal-tracking-note', '  Public <em>note</em>  ');
    await view.fill('postal-tracking-url', 'https://courier.example');
    await view.submit();
    await vi.waitFor(() =>
      expect(view.host.textContent).toContain(copy('postalTrackingSaveError'))
    );
    expect(view.host.querySelector('#postal-tracking-note')?.getAttribute('aria-invalid')).not.toBe(
      'true'
    );
    expect(view.host.querySelector<HTMLTextAreaElement>('#postal-tracking-note')?.value).toBe(
      '  Public <em>note</em>  '
    );
    expect(view.host.querySelector<HTMLInputElement>('#postal-tracking-url')?.value).toBe(
      'https://courier.example'
    );
    expect(view.host.textContent).not.toContain('PRIVATE BACKEND DETAIL');
  } finally {
    await view.close();
  }
});
it('owned confirmation errors close the review and return focus to the preserved draft', async () => {
  const view = await mount(async (url, options) => {
    if (!options?.method) return Response.json(initial);
    return url.endsWith('/review')
      ? Response.json(review(JSON.parse(String(options.body))))
      : validation(['note']);
  });
  try {
    await view.fill('postal-tracking-note', '  Keep this reason  ');
    await view.submit();
    await vi.waitFor(() => expect(view.host.querySelector('[role=dialog]')).not.toBeNull());
    await view.click('Confirm test update');
    await vi.waitFor(() => expect(view.host.querySelector('[role=dialog]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('postal-tracking-note'));
    expect(view.host.querySelector<HTMLTextAreaElement>('#postal-tracking-note')?.value).toBe(
      '  Keep this reason  '
    );
    expect(button(view.host, copy('postalTrackingReview')).disabled).toBe(false);
    expect(view.saved).not.toHaveBeenCalled();
  } finally {
    await view.close();
  }
});
it('ambiguous save stays locked after old editable reads and clears only with exact fresh proof', async () => {
  let current = initial,
    captured: SolarTrackingCommand | undefined;
  const writes: unknown[] = [];
  const view = await mount(async (url, options) => {
    if (!options?.method) return Response.json(current);
    const body = JSON.parse(String(options.body));
    if (url.endsWith('/review')) {
      captured = body;
      return Response.json(review(body));
    }
    writes.push(body);
    return Response.json({ ...receipt(body), revision: 99 });
  });
  try {
    await view.fill('postal-tracking-note', '  Keep uncertain raw draft  ');
    await view.submit();
    await vi.waitFor(() => expect(view.host.querySelector('[role=dialog]')).not.toBeNull());
    await view.click('Confirm test update');
    await view.click('Close test review');
    expect(view.host.textContent).toContain(copy('postalTrackingUnconfirmed'));
    await view.click(copy('postalTrackingReload'));
    await vi.waitFor(() => expect(view.host.querySelector('#postal-tracking-form')).not.toBeNull());
    expect(view.host.querySelector<HTMLTextAreaElement>('#postal-tracking-note')?.value).toBe(
      '  Keep uncertain raw draft  '
    );
    expect(button(view.host, copy('postalTrackingReview')).disabled).toBe(true);
    await view.submit();
    expect(writes).toHaveLength(1);
    current = { ...receipt(captured!), canEdit: true };
    await view.click(copy('postalTrackingReload'));
    await vi.waitFor(() => expect(view.saved).toHaveBeenCalledOnce());
    expect(view.host.textContent).not.toContain(copy('postalTrackingUnconfirmed'));
    expect(view.host.querySelector<HTMLTextAreaElement>('#postal-tracking-note')?.value).toBe(
      'Keep uncertain raw draft'
    );
  } finally {
    await view.close();
  }
});
it('reopens and retries exactly the same idempotent reviewed update after a lost response', async () => {
  const writes: Record<string, unknown>[] = [];
  let previews = 0;
  const view = await mount(async (url, options) => {
    if (!options?.method) return Response.json(initial);
    const body = JSON.parse(String(options.body));
    if (url.endsWith('/review')) {
      previews++;
      return Response.json(review(body));
    }
    writes.push(body);
    if (writes.length === 1) throw new Error('lost response');
    return Response.json(receipt(body));
  });
  try {
    await view.fill('postal-tracking-note', '  Same command  ');
    await view.submit();
    await vi.waitFor(() => expect(view.host.querySelector('[role=dialog]')).not.toBeNull());
    const staleClose = recentClose!;
    await view.click('Confirm test update');
    await view.click('Close test review');
    await view.click(copy('postalTrackingRetry'));
    await act(async () => staleClose());
    expect(view.host.querySelector('[role=dialog]')).not.toBeNull();
    await view.click('Confirm test update');
    await vi.waitFor(() => expect(view.saved).toHaveBeenCalledOnce());
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(previews).toBe(1);
    expect(view.host.querySelector<HTMLTextAreaElement>('#postal-tracking-note')?.value).toBe(
      'Same command'
    );
  } finally {
    await view.close();
  }
});
it('holds one preview against duplicate submissions and discards its result after selection changes', async () => {
  let release: ((value: Response) => void) | undefined;
  const previews: SolarTrackingCommand[] = [];
  const view = await mount(async (url, options) => {
    if (options?.method) {
      previews.push(JSON.parse(String(options.body)));
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return Response.json(
      url.includes(otherRequest)
        ? { ...initial, requestId: otherRequest, trackingNumber: 'OTHER-PARCEL' }
        : initial
    );
  });
  try {
    await view.fill('postal-tracking-note', 'Selected request note');
    await view.submit();
    await view.submit();
    await vi.waitFor(() => expect(previews).toHaveLength(1));
    expect(button(view.host, copy('postalTrackingReview')).disabled).toBe(true);
    expect(
      button(view.host, copy('postalTrackingReview')).querySelector('[data-icon=inline-start]')
    ).not.toBeNull();
    await view.render(otherRequest);
    await vi.waitFor(() => expect(view.host.textContent).toContain('OTHER-PARCEL'));
    await act(async () => release!(Response.json(review(previews[0]!))));
    expect(view.host.querySelector('[role=dialog]')).toBeNull();
    expect(view.host.querySelector<HTMLTextAreaElement>('#postal-tracking-note')?.value).toBe('');
    expect(view.saved).not.toHaveBeenCalled();
  } finally {
    await view.close();
  }
});
it('failed reload retains a valid draft and authority denial withdraws private content', async () => {
  let reads = 0;
  const view = await mount(async (_url, options) => {
    if (options?.method) return new Response(null, { status: 403 });
    reads++;
    return reads === 2 ? Response.json({}, { status: 503 }) : Response.json(initial);
  });
  try {
    await view.fill('postal-tracking-note', '  Recover after read failure  ');
    await view.click(copy('postalTrackingReload'));
    await vi.waitFor(() =>
      expect(view.host.textContent).toContain(copy('postalTrackingLoadError'))
    );
    expect(view.host.textContent).not.toContain('PRIVATE-PARCEL');
    await view.click(copy('postalTrackingReload'));
    await vi.waitFor(() => expect(view.host.querySelector('#postal-tracking-form')).not.toBeNull());
    expect(view.host.querySelector<HTMLTextAreaElement>('#postal-tracking-note')?.value).toBe(
      '  Recover after read failure  '
    );
    await view.submit();
    await vi.waitFor(() => expect(view.denied).toHaveBeenCalledOnce());
    expect(view.host.querySelector('#postal-tracking-form')).toBeNull();
    expect(view.host.textContent).not.toContain('PRIVATE-PARCEL');
  } finally {
    await view.close();
  }
});
it('withdraws previous actor details and review in the commit before passive cleanup', async () => {
  let reads = 0,
    release: ((value: Response) => void) | undefined;
  const view = await mount(async (_url, options) => {
    if (options?.method) return Response.json(review(JSON.parse(String(options.body))));
    if (++reads === 2)
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    return Response.json(initial);
  });
  try {
    await view.fill('postal-tracking-note', 'Previous actor draft');
    await view.submit();
    await vi.waitFor(() => expect(view.host.querySelector('[role=dialog]')).not.toBeNull());
    await view.render(requestId, 'staff-two', () => {
      expect(view.host.textContent).not.toContain('PRIVATE-PARCEL');
      expect(view.host.textContent).not.toContain('Previous actor draft');
      expect(view.host.querySelector('[role=dialog]')).toBeNull();
      expect(view.host.querySelector('#postal-tracking-form')).toBeNull();
    });
    await act(async () => release!(Response.json(initial)));
    await vi.waitFor(() => expect(view.host.querySelector('#postal-tracking-form')).not.toBeNull());
    expect(view.host.querySelector<HTMLTextAreaElement>('#postal-tracking-note')?.value).toBe('');
  } finally {
    await view.close();
  }
});
it.each(['definitive', 'malformed'] as const)(
  'closed %s confirmation preserves the draft with the correct replay gate',
  async (mode) => {
    const view = await mount(async (url, options) => {
      if (!options?.method) return Response.json(initial);
      if (url.endsWith('/review')) return Response.json(review(JSON.parse(String(options.body))));
      return mode === 'definitive'
        ? validation(['expectedRevision'])
        : Response.json({ error: 'Malformed' }, { status: 400 });
    });
    try {
      await view.fill('postal-tracking-note', '  Valid preserved update  ');
      await view.submit();
      await vi.waitFor(() => expect(view.host.querySelector('[role=dialog]')).not.toBeNull());
      await view.click('Confirm test update');
      await view.click('Close test review');
      expect(view.host.querySelector<HTMLTextAreaElement>('#postal-tracking-note')?.value).toBe(
        '  Valid preserved update  '
      );
      expect(button(view.host, copy('postalTrackingReview')).disabled).toBe(mode === 'malformed');
      expect(view.host.textContent?.includes(copy('postalTrackingUnconfirmed'))).toBe(
        mode === 'malformed'
      );
      expect(
        view.host.querySelector('#postal-tracking-note')?.getAttribute('aria-invalid')
      ).not.toBe('true');
    } finally {
      await view.close();
    }
  }
);
it('a wellformed missing-resource confirmation withdraws the previously authorized shipment', async () => {
  const view = await mount(async (url, options) => {
    if (!options?.method) return Response.json(initial);
    if (url.endsWith('/review')) return Response.json(review(JSON.parse(String(options.body))));
    return Response.json(
      {
        error: {
          code: ErrorCodes.NOT_FOUND_RESOURCE.code,
          message: 'Private resource',
          correlationId: requestId,
        },
      },
      { status: 404 }
    );
  });
  try {
    await view.fill('postal-tracking-note', 'Private missing request draft');
    await view.submit();
    await vi.waitFor(() => expect(view.host.querySelector('[role=dialog]')).not.toBeNull());
    await view.click('Confirm test update');
    await vi.waitFor(() => expect(view.denied).toHaveBeenCalledOnce());
    expect(view.host.textContent).not.toContain('PRIVATE-PARCEL');
    expect(view.host.querySelector('#postal-tracking-form')).toBeNull();
    expect(view.host.querySelector('[role=dialog]')).toBeNull();
  } finally {
    await view.close();
  }
});
it('exact retry after reload withdraws authority on a missing-resource response with the original command', async () => {
  const writes: unknown[] = [];
  const view = await mount(async (url, options) => {
    if (!options?.method) return Response.json(initial);
    const body = JSON.parse(String(options.body));
    if (url.endsWith('/review')) return Response.json(review(body));
    writes.push(body);
    if (writes.length === 1) throw new Error('Lost write response');
    return Response.json(
      {
        error: {
          code: ErrorCodes.NOT_FOUND_RESOURCE.code,
          message: 'Private missing resource',
          correlationId: requestId,
        },
      },
      { status: 404 }
    );
  });
  try {
    await view.fill('postal-tracking-note', '  Captured before authority loss  ');
    await view.submit();
    await vi.waitFor(() => expect(view.host.querySelector('[role=dialog]')).not.toBeNull());
    await view.click('Confirm test update');
    await view.click('Close test review');
    await view.click(copy('postalTrackingReload'));
    await vi.waitFor(() => expect(view.host.querySelector('#postal-tracking-form')).not.toBeNull());
    await view.click(copy('postalTrackingRetry'));
    await view.click('Confirm test update');
    await vi.waitFor(() => expect(view.denied).toHaveBeenCalledOnce());
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(writes[0]);
    expect(view.host.textContent).not.toContain('PRIVATE-PARCEL');
    expect(view.host.querySelector('#postal-tracking-form')).toBeNull();
    expect(view.host.querySelector('[role=dialog]')).toBeNull();
  } finally {
    await view.close();
  }
});
