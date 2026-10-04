import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { t } from '@barghsa/i18n/app';
import { ErrorCodes } from '@barghsa/shared/errors';
import type * as IncreaseSchemas from '../lib/electricity-increase-form-schemas.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { ElectricityIncreasePanel } from './ElectricityIncreasePanel.js';
import {
  contractId,
  versionId,
  profileId,
  invoiceId,
  eligibleState,
  requestRow,
  signatureRow,
  signingState,
} from './electricity-increase-fixtures.js';

const lazy = vi.hoisted(() => ({ wait: null as Promise<void> | null, started: false }));
vi.mock('../lib/electricity-increase-form-schemas.js', async (importOriginal) => {
  lazy.started = true;
  await lazy.wait;
  return importOriginal<typeof IncreaseSchemas>();
});
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ irrDigits: String }),
}));
let host: HTMLDivElement, root: Root;
let requests: Mock<(path: string, init?: RequestInit) => Promise<Response>>;
let read: () => Response | Promise<Response>;
let write: (path: string, body: Record<string, unknown>) => Response | Promise<Response>;
beforeEach(() => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  read = () => Response.json(eligibleState());
  write = () => Response.json(requestRow(), { status: 201 });
  requests = vi.fn(async (path: string, init?: RequestInit) =>
    init?.method === 'POST'
      ? write(path, JSON.parse(String(init.body)) as Record<string, unknown>)
      : read()
  );
  vi.stubGlobal('fetch', requests);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const input = () => host.querySelector<HTMLInputElement>('#electricity-increase-kwh')!;
const posts = () => requests.mock.calls.filter(([, init]) => init?.method === 'POST');
const reads = () => requests.mock.calls.filter(([, init]) => !init?.method);
const retry = () =>
  host.querySelector<HTMLButtonElement>(
    '[data-testid=electricity-increase-retry], [data-testid=electricity-increase-sign-retry]'
  )!;
async function render(
  actor = 'customer',
  overrides: Partial<{ contractId: string; versionId: string; profileId: string }> = {}
) {
  await act(async () =>
    root.render(
      <AccountUserProvider value={actor}>
        <ElectricityIncreasePanel
          contractId={contractId}
          versionId={versionId}
          profileId={profileId}
          {...overrides}
        />
      </AccountUserProvider>
    )
  );
}
async function change(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector('[data-testid=electricity-increase-form]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function clickRetry() {
  await act(async () => retry().click());
}
function error(fields: unknown[] = [], code: string = ErrorCodes.VALIDATION_INPUT_INVALID.code) {
  return {
    error: {
      code,
      message: 'Private server quantity and context',
      correlationId: invoiceId,
      fields,
    },
  };
}
async function consentAndSign() {
  const checkbox = host.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  const button = [...host.querySelectorAll('button')].find((item) =>
    item.textContent?.includes(t('electricity.increase.sign', 'en'))
  )!;
  expect(button.disabled).toBe(true);
  await act(async () => checkbox.click());
  await act(async () => button.click());
}

it('locks before held lazy validation, keeps controls focusable and discards an edited draft result', async () => {
  let release!: () => void;
  lazy.wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await render();
  await change('0');
  await submit();
  await vi.waitFor(() => expect(lazy.started).toBe(true));
  expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  expect(input().disabled).toBe(false);
  input().focus();
  expect(document.activeElement).toBe(input());
  await submit();
  expect(posts()).toHaveLength(0);
  await change('119');
  await act(async () => release());
  await vi.waitFor(() =>
    expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false)
  );
  expect(posts()).toHaveLength(0);
  expect(input().value).toBe('119');
  expect(input().getAttribute('aria-invalid')).not.toBe('true');
});
it.each(['en', 'fa'] as const)(
  'provides linked touched errors and first invalid focus in %s',
  async (locale) => {
    document.documentElement.lang = locale;
    await render();
    expect(input().getAttribute('aria-invalid')).not.toBe('true');
    const label = host.querySelector<HTMLLabelElement>('label')!;
    expect(label.htmlFor).toBe(input().id);
    await change('121');
    expect(input().getAttribute('aria-invalid')).not.toBe('true');
    await act(async () => input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await vi.waitFor(() => expect(input().getAttribute('aria-invalid')).toBe('true'));
    expect(host.textContent).toContain(t('electricity.increaseForm.quantityRange', locale));
    expect(input().getAttribute('aria-describedby')).toContain(
      'electricity-increase-kwh-description'
    );
    expect(input().getAttribute('aria-describedby')).toContain('electricity-increase-kwh-message');
    input().blur();
    await submit();
    await vi.waitFor(() => expect(document.activeElement).toBe(input()));
    expect(posts()).toHaveLength(0);
    expect(input().value).toBe('121');
  }
);
it('normalizes only the captured wire quantity and preserves its raw draft after owned server feedback', async () => {
  write = () => Response.json(error(['requestedKwh']), { status: 400 });
  await render();
  await change(' 120 ');
  await submit();
  await vi.waitFor(() => expect(input().getAttribute('aria-invalid')).toBe('true'));
  expect(JSON.parse(String(posts()[0]?.[1]?.body))).toEqual({
    requestedKwh: '120',
    expectedVersionId: versionId,
    idempotencyKey: expect.any(String),
  });
  expect(input().value).toBe(' 120 ');
  expect(input().disabled).toBe(false);
  await vi.waitFor(() => expect(document.activeElement).toBe(input()));
  expect(host.textContent).toContain(t('electricity.increaseForm.quantityInvalid', 'en'));
  expect(host.textContent).not.toContain('Private server');
  expect(retry()).toBeNull();
});
it.each([
  { fields: ['expectedVersionId'] },
  { fields: ['requestedKwh', 'profileId'] },
  { fields: [['requestedKwh']] },
  { fields: [] },
])('keeps protected, mixed and malformed error metadata generic: $fields', async ({ fields }) => {
  write = () => Response.json(error(fields), { status: 400 });
  await render();
  await change(' 120 ');
  await submit();
  await vi.waitFor(() => expect(posts()).toHaveLength(1));
  expect(input().getAttribute('aria-invalid')).not.toBe('true');
  expect(input().value).toBe(' 120 ');
  expect(host.textContent).toContain(t('electricity.increase.failed', 'en'));
  expect(host.textContent).not.toContain('Private server');
  expect(retry()).toBeNull();
});
it('preserves an unknown full-row response and retries the exact captured command even after a complete rejection', async () => {
  write = () => Response.json(requestRow({ profileId: invoiceId }), { status: 201 });
  await render();
  await change(' 120 ');
  await submit();
  await vi.waitFor(() => expect(retry()).not.toBeNull());
  const body = String(posts()[0]?.[1]?.body);
  expect(input().disabled).toBe(true);
  await submit();
  expect(posts()).toHaveLength(1);
  expect(reads()).toHaveLength(1);
  write = () => Response.json(error(['requestedKwh']), { status: 400 });
  await clickRetry();
  expect(String(posts()[1]?.[1]?.body)).toBe(body);
  expect(input().disabled).toBe(true);
  expect(retry()).not.toBeNull();
  expect(reads()).toHaveLength(1);
  write = () => Response.json(signingState().request, { status: 201 });
  read = () => Response.json(signingState());
  await clickRetry();
  await vi.waitFor(() => expect(reads()).toHaveLength(2));
  expect(String(posts()[2]?.[1]?.body)).toBe(body);
  expect(retry()).toBeNull();
  expect(input()).toBeNull();
  expect(host.textContent).toContain(t('electricity.increase.amendment', 'en'));
});
it('retains an unrecognized complete 4xx as uncertain but permits editing after known legacy validation rejection', async () => {
  write = () => Response.json(error([], 'VALIDATION:INPUT_INVALID'), { status: 400 });
  await render();
  await change('120');
  await submit();
  await vi.waitFor(() => expect(posts()).toHaveLength(1));
  expect(input().disabled).toBe(false);
  expect(retry()).toBeNull();
  write = () => Response.json(error([], 'PRIVATE:UNRECOGNIZED'), { status: 400 });
  await submit();
  await vi.waitFor(() => expect(retry()).not.toBeNull());
  expect(input().disabled).toBe(true);
  expect(reads()).toHaveLength(1);
});
it.each([401, 403, 404])(
  'withdraws private drafts and captured commands on live %s denial',
  async (status) => {
    await render();
    await change(' 120 ');
    write = () => Response.json({}, { status });
    await submit();
    await vi.waitFor(() => expect(input()).toBeNull());
    expect(retry()).toBeNull();
    expect(host.textContent).not.toContain('120');
    expect(host.querySelector('[data-testid=electricity-increase-refresh]')).not.toBeNull();
  }
);
it.each([
  { changed: 'actor', actor: 'another-customer', overrides: {} },
  { changed: 'profile', actor: 'customer', overrides: { profileId: invoiceId } },
  { changed: 'contract', actor: 'customer', overrides: { contractId: invoiceId } },
  { changed: 'version', actor: 'customer', overrides: { versionId: invoiceId } },
])('fences a held write receipt after $changed changes', async ({ actor, overrides }) => {
  let resolve!: (response: Response) => void;
  write = () =>
    new Promise<Response>((done) => {
      resolve = done;
    });
  await render();
  await change(' 120 ');
  await submit();
  await vi.waitFor(() => expect(posts()).toHaveLength(1));
  await render(actor, overrides);
  expect(input().value).toBe('');
  expect(retry()).toBeNull();
  const readCount = reads().length;
  await act(async () => resolve(Response.json(requestRow(), { status: 201 })));
  expect(reads()).toHaveLength(readCount);
  expect(input().value).toBe('');
  expect(host.textContent).not.toContain('Awaiting staff review');
});
it('does not accept a late private read after profile-context invalidation', async () => {
  let resolve!: (response: Response) => void;
  let calls = 0;
  read = () =>
    ++calls === 1
      ? new Promise<Response>((done) => {
          resolve = done;
        })
      : Response.json(eligibleState());
  await render();
  await act(async () => refreshProfileContext());
  await act(async () => resolve(Response.json(signingState())));
  expect(input().value).toBe('');
  expect(host.textContent).not.toContain(t('electricity.increase.amendment', 'en'));
});
it('rejects an obsolete callback before it can borrow a new contract captured attempt', async () => {
  write = () => Response.json({}, { status: 201 });
  await render();
  await change('120');
  await submit();
  await vi.waitFor(() => expect(retry()).not.toBeNull());
  const oldProps = Object.entries(retry()).find(([key]) =>
    key.startsWith('__reactProps$')
  )?.[1] as { onClick: () => void };
  await render('customer', { contractId: invoiceId });
  await change('120');
  await submit();
  await vi.waitFor(() => expect(posts()).toHaveLength(2));
  await act(async () => oldProps.onClick());
  expect(posts()).toHaveLength(2);
  await clickRetry();
  expect(posts()).toHaveLength(3);
  expect(posts()[2]?.[0]).toBe(`/api/electricity/contracts/${invoiceId}/increase`);
  expect(posts()[2]?.[1]?.body).toBe(posts()[1]?.[1]?.body);
});
it('retains consent and the full signing command through step-up and uncertain retries', async () => {
  read = () => Response.json(signingState());
  write = () => Response.json(error([], ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code), { status: 403 });
  await render();
  await consentAndSign();
  await vi.waitFor(() => expect(retry()).not.toBeNull());
  expect(host.querySelector('[href="/settings/security"]')).not.toBeNull();
  expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true);
  const captured = JSON.parse(String(posts()[0]?.[1]?.body)) as Record<string, unknown>;
  expect(captured).toEqual({
    expectedAmendmentSha256: 'a'.repeat(64),
    expectedAdjustmentIrR: '200000',
    expectedReviewHash: 'b'.repeat(64),
    idempotencyKey: expect.any(String),
  });
  write = () => Response.json(signatureRow({ versionId: invoiceId }), { status: 201 });
  await clickRetry();
  expect(retry()).not.toBeNull();
  expect(reads()).toHaveLength(1);
  write = () => Response.json(error([], ErrorCodes.CONFLICT_VERSION.code), { status: 409 });
  await clickRetry();
  expect(retry()).not.toBeNull();
  expect(reads()).toHaveLength(1);
  const saved = signatureRow({
    status: 'awaiting_effective_date',
    adjustmentInvoiceState: 'Paid',
    adjustmentPaidAmount: '200000',
  });
  write = () => Response.json(saved, { status: 201 });
  read = () => Response.json({ ...eligibleState(), canRequest: false, request: saved });
  await clickRetry();
  await vi.waitFor(() => expect(reads()).toHaveLength(2));
  expect(retry()).toBeNull();
  for (const [, init] of posts()) expect(init?.body).toBe(posts()[0]?.[1]?.body);
  expect(host.textContent).toContain(
    t('electricity.increase.status.awaiting_effective_date', 'en')
  );
});
