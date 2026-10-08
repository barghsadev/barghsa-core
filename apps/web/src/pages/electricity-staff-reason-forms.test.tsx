import { QueryProvider } from '../test/query-provider.js';
import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type * as FormModule from '@barghsa/ui/form';
import type { TeamActionDialog } from '../components/TeamActionDialog.js';
import { t } from '@barghsa/i18n/app';
import { ErrorCodes } from '@barghsa/shared/errors';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import AdminElectricityOrdersPage from './AdminElectricityOrdersPage.js';
import { staffFormOrder, staffFormReview } from '../test/electricity-staff-reason-fixtures.js';

type DialogProps = ComponentProps<typeof TeamActionDialog>;
const gate = vi.hoisted(() => ({
  wait: null as Promise<void> | null,
  started: 0,
  dialog: null as DialogProps | null,
}));
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
              const wait = gate.wait;
              if (wait) {
                ++gate.started;
                await wait;
              }
              return schema();
            }
          : schema,
        options
      ),
  };
});
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: DialogProps) => {
    gate.dialog = props;
    return <div role="dialog">Captured decision</div>;
  },
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (value: string) => value, notice: null }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    money: String,
    number: String,
    irrDigits: String,
    numberStyle: 'western',
  }),
}));
vi.mock('../components/SavingOrderComments.js', () => ({ ElectricityOrderComments: () => null }));
afterEach(() => {
  vi.unstubAllGlobals();
  gate.wait = null;
  gate.started = 0;
  gate.dialog = null;
  document.documentElement.lang = 'fa';
  window.history.replaceState(null, '', '/');
});
const copy = (key: string, locale: 'en' | 'fa' = 'en') =>
  t(`electricity.staffReasonForm.${key}`, locale);
const invalid = (fields: unknown[]) =>
  Response.json(
    {
      error: {
        code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
        message: 'PRIVATE_SERVER_TEXT',
        correlationId: staffFormOrder.orderId,
        fields,
      },
    },
    { status: 400 }
  );

async function mount(
  locale: 'en' | 'fa' = 'en',
  reviewResponse?: (body: Record<string, unknown>) => Promise<Response>,
  paged = false,
  otherQueue = false
) {
  document.documentElement.lang = locale;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let holdDetail = false;
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/financial-review')) {
      const body = JSON.parse(options!.body as string) as Record<string, unknown>;
      return reviewResponse
        ? reviewResponse(body)
        : Response.json(
            staffFormReview(
              body.action as 'approve' | 'request-changes' | 'reject',
              String(body.reason)
            )
          );
    }
    if (url === `/api/staff/electricity/orders/${staffFormOrder.orderId}`)
      return holdDetail ? new Promise<Response>(() => {}) : Response.json(staffFormOrder);
    if (paged && actor === 'staff-two')
      return Response.json({
        orders: [
          {
            ...staffFormOrder,
            orderId: staffFormOrder.profileId,
            customerName: 'Fresh second actor queue',
          },
        ],
        nextAfter: null,
      });
    return Response.json({
      orders: [
        staffFormOrder,
        ...(otherQueue
          ? [
              {
                ...staffFormOrder,
                orderId: staffFormOrder.profileId,
                customerName: 'Authorized Other Buyer',
              },
            ]
          : []),
      ],
      nextAfter: paged ? staffFormOrder.orderId : null,
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let actor = 'staff-one';
  const render = () =>
    root.render(
      <QueryProvider>
        <AccountUserProvider value={actor}>
          <AdminElectricityOrdersPage />
        </AccountUserProvider>
      </QueryProvider>
    );
  await act(async () => render());
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((button) => button.textContent?.includes(staffFormOrder.customerName))!
      .click()
  );
  const field = () => host.querySelector<HTMLTextAreaElement>('#electricity-review-reason')!;
  return {
    host,
    fetcher,
    field,
    choose: async (text = locale === 'fa' ? 'درخواست اصلاح' : 'Request changes') =>
      act(async () =>
        [...host.querySelectorAll('button')].find((button) => button.textContent === text)!.click()
      ),
    enter: async (text: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
          field(),
          text
        );
        field().dispatchEvent(new Event('input', { bubbles: true }));
      }),
    blur: async () =>
      act(async () => field().dispatchEvent(new FocusEvent('focusout', { bubbles: true }))),
    actor: async (value: string) =>
      act(async () => {
        actor = value;
        holdDetail = true;
        render();
      }),
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
const reviews = (fetcher: ReturnType<typeof vi.fn>) =>
  fetcher.mock.calls.filter(([url]) => String(url).endsWith('/financial-review'));

it('settles a withdrawn queue permission into its explicit error instead of endless loading', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({}, { status: 403 }))
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <QueryProvider>
          <AccountUserProvider value="denied-staff">
            <AdminElectricityOrdersPage />
          </AccountUserProvider>
        </QueryProvider>
      )
    );
    expect(host.textContent).toContain('You cannot review electricity orders.');
    expect(host.textContent).not.toContain('Loading orders');
    expect(host.querySelector('#electricity-review-reason')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it.each(['en', 'fa'] as const)(
  'links touched staff reason errors and focuses invalid decisions in %s',
  async (locale) => {
    const page = await mount(locale);
    try {
      expect(page.field().getAttribute('aria-invalid')).not.toBe('true');
      await page.blur();
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(page.field().getAttribute('aria-invalid')).toBe('true');
        expect(
          page
            .field()
            .getAttribute('aria-describedby')!
            .split(' ')
            .map((id) => document.getElementById(id)?.textContent)
            .join(' ')
        ).toContain(copy('invalid', locale));
      });
      await page.choose();
      await vi.waitFor(() => expect(document.activeElement).toBe(page.field()));
      expect(reviews(page.fetcher)).toHaveLength(0);
      await page.enter('  Correct the address  ');
      await page.choose();
      await vi.waitFor(() => expect(gate.dialog).not.toBeNull());
      expect(page.field().value).toBe('  Correct the address  ');
      expect(gate.dialog!.action!.body).toMatchObject({
        reason: 'Correct the address',
        expectedVersionId: staffFormOrder.versionId,
        expectedReviewHash: 'b'.repeat(64),
      });
    } finally {
      await page.close();
    }
  }
);
it('guards duplicate preparation before the deferred validation module resolves', async () => {
  let release!: () => void;
  const page = await mount();
  try {
    await page.enter('Correct the address');
    gate.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.choose();
    await page.choose();
    expect(gate.started).toBe(1);
    expect(reviews(page.fetcher)).toHaveLength(0);
    await act(async () => {
      gate.wait = null;
      release();
    });
    await vi.waitFor(() => expect(reviews(page.fetcher)).toHaveLength(1));
  } finally {
    await page.close();
  }
});
it('approval bypasses reason validation and omits it from the captured command', async () => {
  const page = await mount();
  try {
    await page.choose('Approve order');
    await vi.waitFor(() => expect(gate.dialog).not.toBeNull());
    expect(JSON.parse(reviews(page.fetcher)[0]![1].body as string)).toEqual({
      action: 'approve',
      reason: '',
    });
    expect(gate.dialog!.action!.body).not.toHaveProperty('reason');
  } finally {
    await page.close();
  }
});
it('keeps a valid original reason after owned confirmation feedback and focuses it for correction', async () => {
  const page = await mount();
  try {
    await page.enter('  Keep the draft  ');
    await page.choose();
    await vi.waitFor(() => expect(gate.dialog).not.toBeNull());
    const dialog = gate.dialog!;
    await act(async () => {
      dialog.onPendingChange!(true);
      expect(dialog.onValidationError!(['reason'])).toBe(false);
      const code = ErrorCodes.VALIDATION_INPUT_INVALID.code;
      const mapped = dialog.action!.errorMessages![code];
      if (typeof mapped === 'function')
        mapped({
          error: {
            code,
            message: 'Invalid reason',
            correlationId: staffFormOrder.orderId,
            fields: ['reason'],
          },
        });
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(page.field()));
    expect(page.field().value).toBe('  Keep the draft  ');
    expect(page.field().disabled).toBe(false);
    expect(page.field().getAttribute('aria-invalid')).toBe('true');
    expect(page.host.textContent).not.toContain(copy('uncertain'));
  } finally {
    await page.close();
  }
});
it.each([ErrorCodes.CONFLICT_STATE.code, ErrorCodes.VALIDATION_INPUT_INVALID.code])(
  'retains an attempted command after malformed no-write rejection %s',
  async (code) => {
    const page = await mount();
    try {
      await page.enter('Keep captured reason');
      await page.choose();
      await vi.waitFor(() => expect(gate.dialog).not.toBeNull());
      const dialog = gate.dialog!;
      await act(async () => {
        dialog.onPendingChange!(true);
        expect(dialog.onValidationError!(['reason'])).toBe(false);
        const mapped = dialog.action!.errorMessages![code];
        if (typeof mapped === 'function') mapped({ error: { code, fields: ['reason'] } });
        dialog.onClose();
      });
      expect(page.host.textContent).toContain(copy('uncertain'));
      expect(page.field().disabled).toBe(true);
    } finally {
      await page.close();
    }
  }
);
it('withdraws private drafts when a decision callback reports a missing resource', async () => {
  const page = await mount('en', undefined, false, true);
  try {
    await page.enter('Private decision reason');
    await page.choose();
    await vi.waitFor(() => expect(gate.dialog).not.toBeNull());
    const oldDialog = gate.dialog!;
    await act(async () => {
      const mapped = gate.dialog!.action!.errorMessages![ErrorCodes.NOT_FOUND_RESOURCE.code];
      if (typeof mapped === 'function')
        mapped({ error: { code: ErrorCodes.NOT_FOUND_RESOURCE.code } });
    });
    expect(page.host.querySelector('#electricity-review-reason')).toBeNull();
    expect(page.host.textContent).not.toContain('Reason Private Street');
    expect(page.host.textContent).not.toContain('Private decision reason');
    expect(page.host.textContent).toContain('Authorized Other Buyer');
    expect(page.host.textContent).toContain('Order details were not found or are unavailable.');
    await act(async () =>
      [...page.host.querySelectorAll('button')]
        .find((button) => button.textContent === 'Retry')!
        .click()
    );
    expect(page.field().value).toBe('');
    expect(page.host.textContent).toContain('Reason Private Street');
    await act(async () => oldDialog.onDenied!());
    expect(page.field()).not.toBeNull();
  } finally {
    await page.close();
  }
});
it.each([
  { fields: ['reason'] },
  { fields: ['expectedVersionId'] },
  { fields: ['reason', 'expectedReviewHash'] },
])(
  'accepts only owned staff preview fields $fields without losing raw text',
  async ({ fields }) => {
    const page = await mount('en', async () => invalid(fields));
    try {
      await page.enter('  Keep this reason  ');
      await page.choose();
      await vi.waitFor(() => expect(reviews(page.fetcher)).toHaveLength(1));
      await vi.waitFor(() => expect(page.field().disabled).toBe(false));
      expect(page.field().value).toBe('  Keep this reason  ');
      expect(page.host.textContent).not.toContain('PRIVATE_SERVER_TEXT');
      expect(page.field().getAttribute('aria-invalid') === 'true').toBe(
        fields.length === 1 && fields[0] === 'reason'
      );
      expect(gate.dialog).toBeNull();
    } finally {
      await page.close();
    }
  }
);
it('retains an unknown command across malformed receipts, exact retries and later rejection', async () => {
  const page = await mount();
  try {
    await page.enter('  Keep exact reason  ');
    await page.choose();
    await vi.waitFor(() => expect(gate.dialog).not.toBeNull());
    const first = gate.dialog!,
      body = first.action!.body;
    await act(async () => {
      first.onPendingChange!(true);
    });
    await expect(first.onSuccess({})).rejects.toThrow('Unconfirmed decision');
    await act(async () => first.onUnconfirmed!());
    expect(page.host.textContent).toContain(copy('uncertain'));
    const beforeLane = page.fetcher.mock.calls.length;
    await act(async () =>
      [...page.host.querySelectorAll('button')]
        .find((button) => button.textContent === 'Order conversations')!
        .click()
    );
    expect(page.fetcher.mock.calls).toHaveLength(beforeLane);
    expect(page.host.textContent).toContain(copy('uncertain'));
    expect(page.field().value).toBe('  Keep exact reason  ');
    expect(page.field().disabled).toBe(true);
    await act(async () =>
      [...page.host.querySelectorAll('button')]
        .find((button) => button.textContent === copy('retry'))!
        .click()
    );
    const retry = gate.dialog!;
    expect(retry.action!.body).toBe(body);
    expect(reviews(page.fetcher)).toHaveLength(1);
    // A callback from the closed first dialog cannot close this reopened retry.
    await act(async () => first.onClose());
    expect(page.host.querySelector('[role=dialog]')).not.toBeNull();
    await act(async () => {
      retry.onPendingChange!(true);
      const code = ErrorCodes.CONFLICT_STATE.code;
      const mapped = retry.action!.errorMessages![code];
      if (typeof mapped === 'function')
        mapped({ error: { code, message: 'Conflict', correlationId: staffFormOrder.orderId } });
      retry.onClose();
    });
    expect(page.field().disabled).toBe(true);
    expect(page.host.textContent).toContain(copy('uncertain'));
    await act(async () =>
      [...page.host.querySelectorAll('button')]
        .find((button) => button.textContent === copy('retry'))!
        .click()
    );
    await act(async () =>
      gate.dialog!.onSuccess({
        orderId: staffFormOrder.orderId,
        contractId: staffFormOrder.contractId,
        invoiceId: staffFormOrder.invoiceId,
        status: 'changes_requested',
        refundId: null,
      })
    );
    expect(page.host.textContent).not.toContain(copy('uncertain'));
  } finally {
    await page.close();
  }
});
it('fences delayed preview results and immediately hides private detail when the actor changes', async () => {
  let release!: (value: Response) => void;
  const page = await mount(
    'en',
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  try {
    await page.enter('Secret reason');
    await page.choose();
    await page.actor('staff-two');
    expect(page.host.textContent).not.toContain('Reason Private Street');
    expect(page.host.textContent).not.toContain('Secret reason');
    await act(async () =>
      release(Response.json(staffFormReview('request-changes', 'Secret reason')))
    );
    expect(page.host.querySelector('[role=dialog]')).toBeNull();
  } finally {
    await page.close();
  }
});
it('never extends an earlier actor queue cache into a fresh accepted page', async () => {
  const page = await mount('en', undefined, true);
  try {
    await act(async () =>
      [...page.host.querySelectorAll('button')]
        .find((button) => button.textContent === 'More orders')!
        .click()
    );
    expect(page.fetcher.mock.calls.some(([url]) => url.includes('?after='))).toBe(true);
    await page.actor('staff-two');
    expect(page.host.textContent).toContain('Fresh second actor queue');
    expect(page.host.textContent).not.toContain('Reason Buyer');
    expect(page.host.textContent).not.toContain('Reason Private Street');
  } finally {
    await page.close();
  }
});
it.each([401, 403, 404])(
  'withdraws detail and drafts on staff preview status %s',
  async (status) => {
    const page = await mount('en', async () =>
      Response.json({ error: { code: ErrorCodes.NOT_FOUND_RESOURCE.code } }, { status })
    );
    try {
      await page.enter('Secret reason');
      await page.choose();
      await vi.waitFor(() =>
        expect(page.host.querySelector('#electricity-review-reason')).toBeNull()
      );
      expect(page.host.textContent).not.toContain('Reason Private Street');
      expect(page.host.textContent).not.toContain('Secret reason');
      expect(page.host.querySelector('[role=dialog]')).toBeNull();
    } finally {
      await page.close();
    }
  }
);
