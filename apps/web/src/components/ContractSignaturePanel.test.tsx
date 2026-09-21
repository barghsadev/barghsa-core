import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContractSignaturePanel } from './ContractSignaturePanel.js';
import type { TeamAction } from './TeamActionDialog.js';
import { en, fa } from '@barghsa/i18n/contracts';
const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  action: null as TeamAction | null,
  result: null as unknown,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (value: string) => value }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: (value: number) => String(value) }),
}));
// Panel tests cover intent selection; the review dialog has its own boundary tests.
vi.mock('./ContractFinancialReviewDialog.js', async () => {
  const { TeamActionDialog } = await import('./TeamActionDialog.js');
  return { ContractFinancialReviewDialog: TeamActionDialog };
});
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onClose,
    onSuccess,
  }: {
    action: TeamAction;
    onClose: () => void;
    onSuccess: (result: unknown) => Promise<void>;
  }) => {
    harness.action = action;
    return (
      <div role="dialog">
        <button onClick={() => void onSuccess(harness.result)}>Confirm action</button>
        <button onClick={onClose}>Close confirmation</button>
      </div>
    );
  },
}));
import type { ContractSignatureData } from '../lib/contracts.js';
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  harness.locale = 'en';
  harness.action = null;
  harness.result = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(node: ReactNode) {
  await act(async () => root.render(node));
}
function button(text: string) {
  const match = [...container.querySelectorAll('button')].find((item) => item.textContent === text);
  expect(match, text).toBeDefined();
  return match!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function value(selector: string, text: string) {
  const input = container.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    selector
  )!;
  const prototype =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}

const ID = '11111111-1111-4111-8111-111111111111',
  VERSION = '22222222-2222-4222-8222-222222222222',
  PROFILE = '33333333-3333-4333-8333-333333333333';
const changed = vi.fn();
function view(extra: Partial<ContractSignatureData> = {}): ContractSignatureData {
  return {
    contractId: ID,
    versionId: VERSION,
    isCurrent: true,
    state: 'AwaitingSignature',
    canRequest: false,
    canRecord: true,
    request: {
      id: 'request-2',
      requestNumber: 2,
      originalDocumentId: 'original',
      originalName: 'original.pdf',
      documentState: 'Approved',
      requestedAt: '2026-09-21T00:00:00Z',
    },
    signature: null,
    ...extra,
  };
}
function doc(id: string, role = 'signed', extra = {}) {
  return {
    id,
    businessRecordId: ID,
    contractVersionId: VERSION,
    state: 'Approved',
    contractRole: role,
    detectedMime: 'application/pdf',
    originalName: id + '.pdf',
    ...extra,
  };
}
function panel(staff = false, versionId = VERSION) {
  return (
    <ContractSignaturePanel
      id={ID}
      versionId={versionId}
      profileId={PROFILE}
      staff={staff}
      onChanged={changed}
    />
  );
}
for (const locale of ['en', 'fa'] as const)
  it(`${locale}: captures exact request, version and copy only after acknowledgement`, async () => {
    harness.locale = locale;
    const words = locale === 'fa' ? fa : en;
    const fetcher = vi.fn(async (raw: string) =>
      raw.includes('/signature?')
        ? response(view())
        : response({
            documents: [
              doc('signed'),
              doc('original', 'original'),
              doc('wrong-version', 'signed', { contractVersionId: 'old' }),
              doc('wrong-contract', 'signed', { businessRecordId: 'other' }),
              doc('unapproved', 'signed', { state: 'Available' }),
            ],
            nextBefore: null,
          })
    );
    vi.stubGlobal('fetch', fetcher);
    await render(panel());
    expect(container.textContent).toContain('original.pdf');
    expect([...container.querySelectorAll('option')].map((item) => item.value)).toEqual([
      '',
      'signed',
    ]);
    expect(button(words.recordSignature).disabled).toBe(true);
    await value('#signature-signed', 'signed');
    expect(button(words.recordSignature).disabled).toBe(true);
    await act(async () =>
      container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click()
    );
    await click(words.recordSignature);
    expect(harness.action?.path).toBe(`/api/contracts/${ID}/signature`);
    expect(harness.action?.body).toMatchObject({
      expectedVersionId: VERSION,
      requestId: 'request-2',
      signedDocumentId: 'signed',
      idempotencyKey: expect.any(String),
    });
    await click('Close confirmation');
    await value('#signature-signed', '');
    expect(container.querySelector<HTMLInputElement>('input')!.checked).toBe(false);
    await value('#signature-signed', 'signed');
    await act(async () => container.querySelector<HTMLInputElement>('input')!.click());
    await click(words.recordSignature);
    await click('Confirm action');
    expect(changed).toHaveBeenCalled();
    const query = new URL(
      fetcher.mock.calls.find(([path]) => path.includes('/documents?'))![0],
      'https://app.test'
    ).searchParams;
    expect(query.get('contractVersionId')).toBe(VERSION);
    expect(query.get('state')).toBe('Approved');
  });
it('staff prepares the first request or a numbered replacement using only approved original PDFs', async () => {
  let request: ContractSignatureData['request'] = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (raw: string) =>
      raw.includes('/signature?')
        ? response(view({ canRequest: true, canRecord: false, request }))
        : response({
            documents: [
              doc('original', 'original'),
              doc('image', 'original', { detectedMime: 'image/png' }),
              doc('signed'),
            ],
            nextBefore: null,
          })
    )
  );
  await render(panel(true));
  expect(container.textContent).toContain(en.noSignatureRequest);
  expect(button(en.prepareSignature).disabled).toBe(true);
  await value('#signature-original', 'original');
  await click(en.prepareSignature);
  expect(harness.action?.body).toMatchObject({
    expectedRequestId: null,
    originalDocumentId: 'original',
    expectedVersionId: VERSION,
  });
  expect(harness.action?.path).toBe(`/api/admin/contracts/${ID}/signature-request`);
  await click('Close confirmation');
  request = view().request;
  await click(en.refresh);
  await value('#signature-original', 'original');
  await click(en.prepareSignature);
  expect(harness.action?.body).toMatchObject({ expectedRequestId: 'request-2' });
});
it('shows historical evidence with separate recorder and uploader roles without mutation controls', async () => {
  const fetcher = vi.fn(async () =>
    response(
      view({
        isCurrent: false,
        canRecord: false,
        signature: {
          requestId: 'request-2',
          signedDocumentId: 'signed',
          originalName: 'signed.pdf',
          documentState: 'Approved',
          recordedAt: '2026-09-21T01:00:00Z',
          recordedByType: 'staff',
          uploadedByType: 'customer',
        },
      })
    )
  );
  vi.stubGlobal('fetch', fetcher);
  await render(panel());
  expect(container.textContent).toContain('Recorded by: Staff');
  expect(container.textContent).toContain('Uploaded by: Customer');
  expect(container.querySelector('select')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('retries failed loads and paginated documents, deduplicating repeated rows', async () => {
  let fail = true,
    moreFail = true;
  const fetcher = vi.fn(async (raw: string) => {
    if (fail) return response({}, 503);
    if (raw.includes('/signature?')) return response(view());
    if (raw.includes('before=')) {
      if (moreFail) return response({}, 503);
      return response({ documents: [doc('first'), doc('second')], nextBefore: null });
    }
    return response({ documents: [doc('first')], nextBefore: 'cursor' });
  });
  vi.stubGlobal('fetch', fetcher);
  await render(panel());
  expect(container.querySelector('[role=alert]')).not.toBeNull();
  fail = false;
  await click(en.refresh);
  await click(en.next);
  expect(container.querySelector('[role=alert]')).not.toBeNull();
  moreFail = false;
  await click(en.next);
  expect([...container.querySelectorAll('option')].map((item) => item.value)).toEqual([
    '',
    'first',
    'second',
  ]);
  expect(container.querySelector('[role=alert]')).toBeNull();
});
it('aborts old version loads and closes any confirmation when scope changes', async () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (raw: string, options: RequestInit) => {
      signals.push(options.signal!);
      return raw.includes('/signature?')
        ? response(view())
        : response({ documents: [doc('signed')], nextBefore: null });
    })
  );
  await render(panel());
  await value('#signature-signed', 'signed');
  await act(async () => container.querySelector<HTMLInputElement>('input')!.click());
  await click(en.recordSignature);
  expect(container.querySelector('[role=dialog]')).not.toBeNull();
  const old = signals[0]!;
  await render(panel(false, 'new-version'));
  expect(old.aborted).toBe(true);
  expect(container.querySelector('[role=dialog]')).toBeNull();
});
