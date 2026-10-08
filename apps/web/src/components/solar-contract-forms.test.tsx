import { QueryProvider } from '../test/query-provider.js';
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as SchemaModule from '../lib/solar-contract-form-schemas.js';
import { SolarContractForm } from './SolarContractForm.js';
import { AdminSolarPostalPage } from '../pages/AdminSolarPostalPage.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import {
  contractOptions,
  contractReview,
  createdContract,
  solarOwnedError,
  solarRequestId,
  solarProfileId,
  solarCreatedId,
} from '../test/solar-contract-fixtures.js';
import type { SolarContractBody } from '../lib/solar-contract-form.js';
import type { TeamActionDialog } from './TeamActionDialog.js';
const harness = vi.hoisted(() => ({
  dialog: null as ComponentProps<typeof TeamActionDialog> | null,
  schemaGate: null as Promise<void> | null,
  schemaStarted: false,
  locale: 'en' as 'en' | 'fa',
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({
    status: 'ready',
    timezone: 'Asia/Tehran',
    notice: null,
    format: (value: string) => value,
  }),
}));
vi.mock('../lib/solar-contract-form-schemas.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SchemaModule>();
  harness.schemaStarted = true;
  if (harness.schemaGate) await harness.schemaGate;
  return { ...actual, solarContractSchema: actual.solarContractSchema };
});
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: (props: ComponentProps<typeof TeamActionDialog>) => {
    harness.dialog = props;
    return <div role="dialog">{props.summary}</div>;
  },
}));
vi.mock('./SolarPostalTrackingEditor.js', () => ({ SolarPostalTrackingEditor: () => null }));
vi.mock('./DocumentDetail.js', () => ({ DocumentDetail: () => null }));
let host: HTMLDivElement, root: Root, calls: Array<{ url: string; body: string | undefined }>;
let owner: object | null,
  denied: ReturnType<typeof vi.fn<() => void>>,
  created: ReturnType<typeof vi.fn<(id: string) => void>>;
let respond: (url: string, init?: RequestInit) => Promise<Response>;
const defaultResponse = async (url: string, init?: RequestInit) =>
  url.endsWith('/review')
    ? Response.json(contractReview(JSON.parse(String(init?.body)) as SolarContractBody))
    : Response.json(contractOptions);
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.dialog = null;
  harness.schemaGate = null;
  harness.locale = 'en';
  owner = null;
  denied = vi.fn();
  created = vi.fn();
  calls = [];
  respond = defaultResponse;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? String(init.body) : undefined });
      return respond(url, init);
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const coordination = {
  blocked: () => !!owner,
  acquire: (value: object) => {
    if (owner) return false;
    owner = value;
    return true;
  },
  release: (value: object) => {
    if (owner === value) owner = null;
  },
};
async function mount(actor = 'opaque-staff', request = solarRequestId, scope = 'approved') {
  await act(async () =>
    root.render(
      <QueryProvider>
        <AccountUserProvider value={actor}>
          <SolarContractForm
            requestId={request}
            profileId={solarProfileId}
            scopeKey={scope}
            coordination={coordination}
            onDenied={denied}
            onCreated={created}
          />
        </AccountUserProvider>
      </QueryProvider>
    )
  );
}
async function set(id: string, value: string) {
  const el = host.querySelector('#' + id) as
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  expect(el, id).not.toBeNull();
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
async function valid() {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.querySelector('#solar-contract-source')).not.toBeNull();
  });
  for (const [id, value] of [
    ['source', 'template:' + contractOptions.templates[0]!.version_id],
    ['title', 'Solar agreement'],
    ['text', 'Build the station.'],
    ['reason', 'Initial draft'],
    ['value-kind', 'fixed'],
    ['fixed-amount', '900000'],
    ['line-0-description', 'Deposit'],
    ['line-0-unit-price', '000100000'],
  ])
    await set('solar-contract-' + id, value!);
}
async function submit() {
  await act(async () =>
    host
      .querySelector<HTMLFormElement>('[data-testid="solar-contract-form"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function opened() {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(harness.dialog).not.toBeNull();
  });
  return harness.dialog!;
}
async function click(testid: string) {
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="' + testid + '"]')!.click()
  );
}
it('native blur with held schema and companion edits cannot erase later authoritative submit errors', async () => {
  let release!: () => void;
  harness.schemaGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mount();
  await valid();
  await set('solar-contract-title', 'x'.repeat(201));
  await act(async () => {
    const title = host.querySelector<HTMLInputElement>('#solar-contract-title')!;
    title.focus();
    title.blur();
  });
  await vi.waitFor(() => expect(harness.schemaStarted).toBe(true));
  await set('solar-contract-text', 'Edited while schema loads');
  await submit();
  await submit();
  expect(calls.filter((call) => call.url.endsWith('/review'))).toHaveLength(0);
  await act(async () => {
    release();
    await harness.schemaGate;
  });
  harness.schemaGate = null;
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.querySelector('#solar-contract-title')?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement?.id).toBe('solar-contract-title');
  });
  expect(owner).toBeNull();
});
it.each(['en', 'fa'] as const)(
  '%s: touched shared fields retain complete raw input, linked first error focus and duplicate guard',
  async (locale) => {
    harness.locale = locale;
    await mount();
    await valid();
    await set('solar-contract-title', 'x'.repeat(201));
    await act(async () => {
      const title = host.querySelector<HTMLInputElement>('#solar-contract-title')!;
      title.focus();
      title.blur();
    });
    await submit();
    await submit();
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.querySelector('#solar-contract-title')?.getAttribute('aria-invalid')).toBe(
        'true'
      );
      expect(document.activeElement?.id).toBe('solar-contract-title');
    });
    const title = host.querySelector<HTMLInputElement>('#solar-contract-title')!;
    expect(title.value).toHaveLength(201);
    expect(title.getAttribute('aria-describedby')).toBeTruthy();
    for (const id of title.getAttribute('aria-describedby')!.split(' '))
      expect(host.querySelector('[id="' + id + '"]')).not.toBeNull();
    expect(calls.filter((call) => call.url.endsWith('/review'))).toHaveLength(0);
    expect(owner).toBeNull();
  }
);
it('ignores held preview success and owned errors after editable raw draft changes', async () => {
  let finish!: (response: Response) => void;
  respond = async (url, init) =>
    url.endsWith('/review')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : defaultResponse(url, init);
  await mount();
  await valid();
  await submit();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(owner).not.toBeNull();
  expect(host.querySelector<HTMLInputElement>('#solar-contract-title')!.disabled).toBe(false);
  await set('solar-contract-title', 'Corrected title');
  await act(async () => finish(Response.json(solarOwnedError(['title']), { status: 400 })));
  await vi.waitFor(() => expect(owner).toBeNull());
  expect(harness.dialog).toBeNull();
  expect(host.querySelector('#solar-contract-title')?.getAttribute('aria-invalid')).not.toBe(
    'true'
  );
});
it('retains exact captured body/key/hash after malformed receipt, close and rejected uncertain retry, then accepts actual receipt', async () => {
  await mount();
  await valid();
  await submit();
  const first = await opened();
  const body = JSON.stringify(first.action?.body);
  expect(first.action?.successStatus).toBe(200);
  expect(owner).not.toBeNull();
  await act(async () => first.onPendingChange?.(true));
  await expect(first.onSuccess({ ...createdContract, invoiceIds: [] })).rejects.toThrow('receipt');
  await act(async () => {
    first.onUnconfirmed?.();
  });
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => {
    first.onPendingChange?.(false);
    first.onClose();
  });
  expect(host.querySelector<HTMLInputElement>('#solar-contract-title')!.disabled).toBe(true);
  await submit();
  expect(calls.filter((call) => call.url.endsWith('/review'))).toHaveLength(1);
  await click('solar-contract-retry');
  const second = await opened();
  expect(JSON.stringify(second.action?.body)).toBe(body);
  expect(second.action?.errorMessages?.[ErrorCodes.CONFLICT_STATE.code]).toBeTypeOf('function');
  await act(async () => {
    (second.action?.errorMessages?.[ErrorCodes.CONFLICT_STATE.code] as (v: unknown) => string)?.({
      error: {
        code: ErrorCodes.CONFLICT_STATE.code,
        message: 'changed',
        correlationId: solarCreatedId,
      },
    });
    second.onClose();
  });
  expect(owner).not.toBeNull();
  await click('solar-contract-retry');
  const third = await opened();
  expect(JSON.stringify(third.action?.body)).toBe(body);
  await act(async () => third.onSuccess(createdContract));
  expect(created).toHaveBeenCalledExactlyOnceWith(createdContract.contractId);
  expect(owner).toBeNull();
});
it('maps only complete active owned errors and unlocks first definitive rejection while keeping raw drafts', async () => {
  await mount();
  await valid();
  await submit();
  const first = await opened();
  await act(async () => {
    first.onPendingChange?.(true);
    (first.action?.errorMessages?.['VALIDATION:INPUT:INVALID'] as (v: unknown) => string)(
      solarOwnedError(['invoiceLine0UnitPrice'])
    );
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(
      host.querySelector('#solar-contract-line-0-unit-price')?.getAttribute('aria-invalid')
    ).toBe('true');
  });
  expect(owner).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#solar-contract-line-0-unit-price')!.value).toBe(
    '000100000'
  );
  await set('solar-contract-line-0-unit-price', '100000');
  await submit();
  const next = await opened();
  await act(async () => {
    next.onPendingChange?.(true);
    (next.action?.errorMessages?.['VALIDATION:INPUT:INVALID'] as (v: unknown) => string)(
      solarOwnedError(['title', 'profileId'])
    );
    next.onClose();
  });
  expect(host.querySelector('#solar-contract-title')?.getAttribute('aria-invalid')).not.toBe(
    'true'
  );
});
it('fences actor/source scope entry and stale private callbacks without clearing the new draft', async () => {
  await mount();
  await valid();
  await submit();
  const old = await opened();
  await mount('new-opaque-staff', solarRequestId, 'new-source');
  await valid();
  await set('solar-contract-title', 'New private draft');
  await act(async () => {
    old.onDenied?.();
    old.onUnconfirmed?.();
    old.onClose();
    await old.onSuccess(createdContract);
  });
  expect(denied).not.toHaveBeenCalled();
  expect(created).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('#solar-contract-title')!.value).toBe(
    'New private draft'
  );
});
it.each([401, 403, 404])(
  'withdraws current private options/drafts on options %s',
  async (status) => {
    respond = async () => Response.json({}, { status });
    await mount();
    await vi.waitFor(() => expect(denied).toHaveBeenCalledOnce());
    expect(host.querySelector('#solar-contract-title')).toBeNull();
    expect(owner).toBeNull();
  }
);
it('withdraws current held preview denial even after draft edit and releases parent owner', async () => {
  let finish!: (value: Response) => void;
  respond = async (url, init) =>
    url.endsWith('/review')
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : defaultResponse(url, init);
  await mount();
  await valid();
  await submit();
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await set('solar-contract-title', 'New draft');
  await act(async () => finish(Response.json({}, { status: 403 })));
  await vi.waitFor(() => expect(denied).toHaveBeenCalledOnce());
  expect(owner).toBeNull();
  expect(host.querySelector('#solar-contract-title')).toBeNull();
});
it('blocks synthetic child submit when a sibling owns the synchronous parent guard', async () => {
  await mount();
  await valid();
  owner = {};
  await submit();
  expect(calls.filter((call) => call.url.endsWith('/review'))).toHaveLength(0);
});
it('keeps raw hidden commercial drafts and ordered rows through mode changes', async () => {
  await mount();
  await valid();
  await set('solar-contract-value-kind', 'variable');
  await set('solar-contract-variable-description', '  Original variable rule  ');
  await set('solar-contract-value-kind', 'fixed');
  await set('solar-contract-fixed-amount', '0');
  await set('solar-contract-value-kind', 'variable');
  expect(
    host.querySelector<HTMLTextAreaElement>('#solar-contract-variable-description')!.value
  ).toBe('  Original variable rule  ');
  await click('solar-contract-add-line');
  expect(host.querySelector('#solar-contract-line-1-description')).not.toBeNull();
  await set('solar-contract-line-1-description', 'Second');
  await set('solar-contract-line-1-unit-price', '0');
  await submit();
  const dialog = await opened();
  expect((dialog.action?.body as SolarContractBody).commercialValue).toEqual({
    kind: 'variable',
    description: 'Original variable rule',
  });
  expect(
    (dialog.action?.body as SolarContractBody).invoiceLines.map((row) => row.description)
  ).toEqual(['Deposit', 'Second']);
});
it('parent shared owner blocks lane/row/final/guidance actions and clears only selected private data on current denial', async () => {
  const row = {
    id: solarRequestId,
    profile_id: solarProfileId,
    profile_name: 'Solar buyer',
    request_status: 'approved',
    postal_status: 'received',
    courier: null,
    tracking_number: null,
    send_date: null,
    receipt_image_id: null,
    staff_notes: null,
    created_at: '2026-10-01T00:00:00.000Z',
  };
  respond = async (url, init) =>
    url.includes('postal-queue')
      ? Response.json({ requests: [row], nextBefore: solarCreatedId })
      : url.endsWith('postal-guidance')
        ? Response.json({
            fa: 'راهنما',
            en: 'Guidance',
            destinationAddress: '',
            contactDetails: '',
            originals: [],
          })
        : defaultResponse(url, init);
  await act(async () =>
    root.render(
      <QueryProvider>
        <AccountUserProvider value="opaque-staff">
          <AdminSolarPostalPage />
        </AccountUserProvider>
      </QueryProvider>
    )
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.textContent).toContain('Solar buyer');
  });
  await act(async () =>
    [...host.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Solar buyer'))!
      .click()
  );
  await valid();
  await submit();
  const dialog = await opened();
  expect(host.querySelector<HTMLSelectElement>('#solar-postal-lane')!.disabled).toBe(true);
  const save = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('Save postal guidance')
  )!;
  expect(save.disabled).toBe(true);
  const more = [...host.querySelectorAll('button')].find((button) =>
    button.textContent?.includes('More requests')
  )!;
  expect(more.disabled).toBe(true);
  const count = calls.length;
  await act(async () =>
    host
      .querySelector('form:not([data-testid="solar-contract-form"])')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  expect(calls).toHaveLength(count);
  await act(async () => dialog.onDenied?.());
  expect(host.textContent).not.toContain('Solar buyer');
  expect(host.querySelector('#solar-contract-title')).toBeNull();
  expect(host.textContent).toContain('Guidance');
});

it('complete current missing write withdraws selected private form while malformed envelope cannot unlock', async () => {
  await mount();
  await valid();
  await submit();
  const dialog = await opened();
  await act(async () => {
    dialog.onPendingChange?.(true);
    (dialog.action?.errorMessages?.['NOT_FOUND:RESOURCE'] as (value: unknown) => string)({
      error: { code: 'NOT_FOUND:RESOURCE', message: 'missing', correlationId: 'broken' },
    });
    dialog.onClose();
  });
  expect(owner).not.toBeNull();
  expect(denied).not.toHaveBeenCalled();
  await click('solar-contract-retry');
  const retry = await opened();
  await act(async () => {
    (retry.action?.errorMessages?.['NOT_FOUND:RESOURCE'] as (value: unknown) => string)({
      error: { code: 'NOT_FOUND:RESOURCE', message: 'missing', correlationId: solarCreatedId },
    });
  });
  expect(denied).toHaveBeenCalledOnce();
  expect(owner).toBeNull();
  expect(host.querySelector('#solar-contract-title')).toBeNull();
});
