import { act, StrictMode, useState, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContractSignaturePanel } from './ContractSignaturePanel.js';
import { ContractDetail } from './ContractDetail.js';
import { ContractsWorkspace } from './ContractsWorkspace.js';
import type { ContractFinancialReviewDialog } from './ContractFinancialReviewDialog.js';
import type { TeamActionDialog } from './TeamActionDialog.js';
import type { ContractActivationPanel } from './ContractActivationPanel.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { en, fa } from '@barghsa/i18n/contracts';
import {
  actor,
  contractId,
  versionId,
  profileId,
  documentId,
  signingView,
  signingDocument,
  signingSource,
  signingReview,
  signingReceipt,
  changesReceipt,
} from '../test/contract-review-signature-fixtures.js';
import { useListQuery, writeListQuery } from '../hooks/useListQuery.js';
import { staffContractsSearch, staffContractQueryOptions } from '../lib/record-list-query.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { refreshProfileContext } from '../lib/profile-context.js';
const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  legacyCalls: 0,
  dialog: null as ComponentProps<typeof ContractFinancialReviewDialog> | null,
  team: null as ComponentProps<typeof TeamActionDialog> | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ status: 'ready', notice: null, format: String }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: String, money: String }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/contracts">{children}</a>,
}));
vi.mock('./ContractFinancialReviewDialog.js', () => ({
  ContractFinancialReviewDialog: (props: ComponentProps<typeof ContractFinancialReviewDialog>) => {
    harness.dialog = props;
    return <div role="dialog">Captured review</div>;
  },
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: (props: ComponentProps<typeof TeamActionDialog>) => {
    harness.team = props;
    return <div role="dialog">Captured reason</div>;
  },
}));
vi.mock('./ContractCancellationPanel.js', () => ({
  ContractCancellationPanel: () => (
    <button
      onClick={() => {
        ++harness.legacyCalls;
      }}
    >
      Legacy cancellation refresh
    </button>
  ),
}));
vi.mock('./ContractActivationPanel.js', () => ({
  ContractActivationPanel: ({ coordination }: ComponentProps<typeof ContractActivationPanel>) => (
    <button
      disabled={!!coordination?.blocked()}
      onClick={() => {
        if (coordination?.blocked()) return;
        ++harness.legacyCalls;
      }}
    >
      Legacy activation refresh
    </button>
  ),
}));
vi.mock('./ContractDraftEditor.js', () => ({ ContractDraftEditor: () => null }));
vi.mock('./DocumentUpload.js', () => ({ DocumentUpload: () => null }));
vi.mock('./DocumentsWorkspace.js', () => ({
  DocumentResults: () => (
    <button
      onClick={() => {
        ++harness.legacyCalls;
      }}
    >
      Legacy documents refresh
    </button>
  ),
}));
function LegacyWorkspaceCompanion({ name }: { name: string }) {
  return (
    <form
      data-testid={'legacy-' + name}
      onSubmit={(event) => {
        event.preventDefault();
        ++harness.legacyCalls;
      }}
    >
      <button type="button" onClick={() => ++harness.legacyCalls}>
        Legacy {name} refresh
      </button>
    </form>
  );
}
vi.mock('./ContractRefundQueue.js', () => ({
  ContractRefundQueue: () => <LegacyWorkspaceCompanion name="refund" />,
}));
vi.mock('./ContractCancellationRequestQueue.js', () => ({
  ContractCancellationRequestQueue: () => <LegacyWorkspaceCompanion name="cancellation-request" />,
}));
vi.mock('./ContractActivationRules.js', () => ({
  ContractActivationRules: () => <LegacyWorkspaceCompanion name="activation-rules" />,
}));
vi.mock('./ContractDetailLoader.js', () => ({
  ContractDetailLoader: (props: ComponentProps<typeof ContractDetail>) => {
    const [claim] = useState({});
    return (
      <div data-testid="loaded-contract">
        {props.id}
        <button onClick={() => props.coordination?.acquire(claim)}>Claim immediately</button>
        <button onClick={props.onClose}>Close outer</button>
        <button onClick={() => props.coordination?.release(claim)}>Release preparation</button>
      </div>
    );
  },
}));
let host: HTMLDivElement, root: Root;
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => {
  harness.locale = 'en';
  harness.legacyCalls = 0;
  harness.dialog = null;
  harness.team = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(node: ReactNode, who = actor) {
  await act(async () => root.render(<AccountUserProvider value={who}>{node}</AccountUserProvider>));
}
const panel = (staff = false, onDenied = vi.fn()) => (
  <ContractSignaturePanel
    id={contractId}
    versionId={versionId}
    profileId={profileId}
    staff={staff}
    onChanged={() => {}}
    onDenied={onDenied}
    source={signingSource()}
  />
);
function button(text: string) {
  const found = [...host.querySelectorAll('button')].find((el) => el.textContent === text);
  expect(found, text).toBeDefined();
  return found!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function value(id: string, text: string) {
  const input = host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    '#' + id
  )!;
  expect(input).not.toBeNull();
  const proto =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, text);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
async function selectRecord() {
  await value('signature-signed', documentId(2));
  await act(async () =>
    host.querySelector<HTMLInputElement>('#signature-acknowledgement')!.click()
  );
}
function install(staff = false, preview?: () => Promise<Response>) {
  const view = signingView(staff),
    docs = [signingDocument(1, 'original'), signingDocument()];
  const fetcher = vi.fn(async (raw: string, options?: RequestInit) =>
    raw.includes('/signature?')
      ? response(view)
      : raw.includes('/signature/review')
        ? preview
          ? preview()
          : response(
              signingReview(
                view,
                docs.find(
                  (doc) =>
                    doc.id === JSON.parse(String(options?.body)).signedDocumentId ||
                    doc.id === JSON.parse(String(options?.body)).originalDocumentId
                )!,
                JSON.parse(String(options?.body)).action === 'request'
              )
            )
        : response({ documents: docs, nextBefore: null })
  );
  vi.stubGlobal('fetch', fetcher);
  return { view, docs, fetcher };
}
for (const locale of ['en', 'fa'] as const)
  it(`${locale}: links touched document errors and focuses the first invalid control`, async () => {
    harness.locale = locale;
    install();
    await render(panel());
    const words = locale === 'en' ? en : fa;
    await click(words.recordSignature);
    await vi.waitFor(() => {
      expect(host.querySelector('#signature-signed')?.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement?.id).toBe('signature-signed');
      expect(
        host.querySelector('#signature-signed')?.getAttribute('aria-describedby')
      ).toBeTruthy();
    });
    expect(harness.dialog).toBeNull();
  });
it('suppresses duplicate read-only previews and stale edited success while keeping raw selections', async () => {
  let finish!: (response: Response) => void;
  const saved = install(
    false,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render(panel());
  await selectRecord();
  await act(async () => {
    button(en.recordSignature).click();
    button(en.recordSignature).click();
  });
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect(
    saved.fetcher.mock.calls.filter(([path]) => path.includes('/signature/review'))
  ).toHaveLength(1);
  await value('signature-signed', '');
  await act(async () => finish(response(signingReview(saved.view, saved.docs[1]!))));
  expect(harness.dialog).toBeNull();
  expect(host.querySelector<HTMLSelectElement>('#signature-signed')!.value).toBe('');
});
it('suppresses stale edited owned preview errors but withdraws current denied source', async () => {
  let finish!: (response: Response) => void;
  const onDenied = vi.fn();
  install(
    false,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render(panel(false, onDenied));
  await selectRecord();
  await act(async () => button(en.recordSignature).click());
  await vi.waitFor(() => expect(finish).toBeDefined());
  await value('signature-signed', '');
  await act(async () =>
    finish(
      response(
        {
          error: {
            code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            message: 'Invalid',
            correlationId: documentId(5),
            fields: ['signedDocumentId'],
          },
        },
        400
      )
    )
  );
  expect(host.querySelector('#signature-signed')?.getAttribute('aria-invalid')).not.toBe('true');
  expect(onDenied).not.toHaveBeenCalled();
  await selectRecord();
  await act(async () => button(en.recordSignature).click());
  await act(async () => finish(response({}, 403)));
  expect(onDenied).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain('original.pdf');
});
it('keeps the same captured body/hash/key through unknown and rejected uncertain retries; GET cannot unlock it', async () => {
  const saved = install();
  await render(panel());
  await selectRecord();
  await click(en.recordSignature);
  await vi.waitFor(() => expect(harness.dialog).not.toBeNull());
  const original = harness.dialog!,
    body = JSON.stringify(original.action.body);
  await act(async () => {
    original.onPendingChange?.(true);
    original.onUnconfirmed?.();
  });
  expect(host.querySelector('[role=dialog]')).toBeNull();
  expect(button(en.refresh).disabled).toBe(true);
  const readCount = saved.fetcher.mock.calls.length;
  await click(en.refresh);
  expect(saved.fetcher.mock.calls.length).toBe(readCount);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid=contract-signature-retry]')!.click()
  );
  const retry = harness.dialog!;
  expect(JSON.stringify(retry.action.body)).toBe(body);
  expect(retry.review).toEqual(original.review);
  const mapped = retry.action.errorMessages?.[ErrorCodes.CONFLICT_STATE.code];
  expect(typeof mapped).toBe('function');
  await act(async () => {
    if (typeof mapped === 'function')
      mapped({
        error: {
          code: ErrorCodes.CONFLICT_STATE.code,
          message: 'Conflict',
          correlationId: documentId(7),
        },
      });
    retry.onClose();
  });
  expect(button(en.refresh).disabled).toBe(true);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid=contract-signature-retry]')!.click()
  );
  expect(JSON.stringify(harness.dialog!.action.body)).toBe(body);
  await act(async () =>
    harness.dialog!.onSuccess(signingReceipt(saved.view, saved.docs[1]!, original.review!, false))
  );
  expect(host.querySelector('[data-testid=contract-signature-retry]')).toBeNull();
});
it('rejects a changed full receipt and leaves its immutable retry available', async () => {
  const saved = install(true);
  await render(panel(true));
  await selectRecord();
  await click(en.recordSignature);
  await vi.waitFor(() => expect(harness.dialog).not.toBeNull());
  const props = harness.dialog!,
    review = structuredClone(props.review!);
  review.data.contract.content = { title: 'Foreign terms' };
  await expect(
    props.onSuccess(signingReceipt(saved.view, saved.docs[1]!, review, true))
  ).rejects.toThrow('signature receipt');
  await act(async () => {
    props.onPendingChange?.(true);
    props.onUnconfirmed?.();
  });
  expect(host.querySelector('[data-testid=contract-signature-retry]')).not.toBeNull();
});
it('clears only the owning original selection after a valid new request', async () => {
  const saved = install(true);
  await render(panel(true));
  await value('signature-signed', documentId(2));
  await value('signature-original', documentId(1));
  await click(en.prepareSignature);
  await vi.waitFor(() => expect(harness.dialog).not.toBeNull());
  const props = harness.dialog!;
  await act(async () =>
    props.onSuccess(signingReceipt(saved.view, saved.docs[0]!, props.review!, true))
  );
  expect(host.querySelector<HTMLSelectElement>('#signature-signed')?.value).toBe(documentId(2));
  expect(host.querySelector<HTMLSelectElement>('#signature-original')?.value).toBe('');
});
it.each(['actor', 'profile'] as const)(
  'fences obsolete signature callbacks after %s changes',
  async (kind) => {
    install();
    const denied = vi.fn();
    await render(panel(false, denied));
    await selectRecord();
    await click(en.recordSignature);
    await vi.waitFor(() => expect(harness.dialog).not.toBeNull());
    const old = harness.dialog!;
    if (kind === 'actor') await render(panel(false, denied), 'another-user');
    else await act(async () => refreshProfileContext());
    await act(async () => old.onDenied?.());
    expect(denied).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLInputElement>('#signature-acknowledgement')?.checked).toBe(false);
  }
);
function detailFetch() {
  const source = signingSource({ state: 'AwaitingStaffReview' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (raw: string) =>
      raw.includes('/versions')
        ? response({ versions: [source.version], nextBefore: null })
        : raw.includes('/signature?')
          ? response(
              signingView(true, {
                state: 'AwaitingStaffReview',
                canRequest: false,
                canRecord: false,
                request: null,
              })
            )
          : response(source.contract)
    )
  );
  return source;
}
for (const locale of ['en', 'fa'] as const)
  it(`${locale}: request-changes validates full raw reason and duplicate submit captures once`, async () => {
    harness.locale = locale;
    detailFetch();
    await render(<ContractDetail id={contractId} staff onClose={() => {}} onChanged={() => {}} />);
    const words = locale === 'en' ? en : fa;
    await value('contract-change-reason', 'x'.repeat(1001));
    await click(words['request-changes']);
    await vi.waitFor(() => {
      expect(host.querySelector('#contract-change-reason')?.getAttribute('aria-invalid')).toBe(
        'true'
      );
      expect(document.activeElement?.id).toBe('contract-change-reason');
    });
    expect(harness.team).toBeNull();
    await value('contract-change-reason', '  durable reason  ');
    await act(async () => {
      button(words['request-changes']).click();
      button(words['request-changes']).click();
    });
    await vi.waitFor(() => expect(harness.team).not.toBeNull());
    expect(harness.team!.action?.body).toMatchObject({
      reason: 'durable reason',
      expectedVersionId: versionId,
    });
    expect(harness.team!.action?.body).not.toHaveProperty('expectedReviewHash');
    const old = harness.team!;
    await act(async () => old.onClose());
    await value('contract-change-reason', 'fresh independent reason');
    await click(words['request-changes']);
    await vi.waitFor(() => expect(harness.team).not.toBe(old));
    const fresh = harness.team!,
      body = JSON.stringify(fresh.action!.body);
    await act(async () => {
      old.onPendingChange?.(true);
      old.onDenied?.();
      old.onClose();
    });
    expect(JSON.stringify(harness.team!.action!.body)).toBe(body);
    expect(host.querySelector<HTMLTextAreaElement>('#contract-change-reason')!.value).toBe(
      'fresh independent reason'
    );
  });
it('request-changes keeps an unknown command through version/close/read gates and accepts the actual history-free result', async () => {
  const source = detailFetch(),
    changed = vi.fn(),
    closed = vi.fn();
  await render(<ContractDetail id={contractId} staff onClose={closed} onChanged={changed} />);
  await value('contract-change-reason', 'durable reason');
  await click(en['request-changes']);
  await vi.waitFor(() => expect(harness.team).not.toBeNull());
  const original = harness.team!,
    body = JSON.stringify(original.action!.body);
  await act(async () => {
    original.onPendingChange?.(true);
    original.onUnconfirmed?.();
  });
  expect(button(en.close).disabled).toBe(true);
  await click(en.close);
  expect(closed).not.toHaveBeenCalled();
  await act(async () => {
    button('Legacy cancellation refresh').dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    button('Legacy activation refresh').dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    button('Legacy documents refresh').dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
  });
  expect(harness.legacyCalls).toBe(0);
  expect(host.querySelector('[data-testid=contract-review-retry]')).not.toBeNull();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid=contract-review-retry]')!.click()
  );
  expect(JSON.stringify(harness.team!.action!.body)).toBe(body);
  await act(async () => harness.team!.onSuccess(changesReceipt(source)));
  expect(changed).toHaveBeenCalledOnce();
});
it('claims the actual outer workspace synchronously before another row or filter submit can unmount it', async () => {
  const rows = [
    { ...signingSource().contract, versionId, versionNumber: 2 },
    { ...signingSource().contract, id: documentId(8), versionId, versionNumber: 3 },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response({ contracts: rows, nextBefore: documentId(9) }))
  );
  await render(<ContractsWorkspace staff />);
  await click(`${en.electricity} · ${en.version} 2`);
  const companions = ['refund', 'cancellation-request', 'activation-rules'];
  await act(async () => {
    for (const name of companions) button(`Legacy ${name} refresh`).click();
  });
  expect(harness.legacyCalls).toBe(3);
  await act(async () => {
    button('Claim immediately').click();
    for (const name of companions) {
      button(`Legacy ${name} refresh`).dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true })
      );
      host
        .querySelector(`[data-testid="legacy-${name}"]`)!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
    button(`${en.electricity} · ${en.version} 3`).click();
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    button('Close outer').click();
  });
  expect(host.querySelector('[data-testid=loaded-contract]')?.textContent).toContain(contractId);
  expect(button(`${en.electricity} · ${en.version} 3`).disabled).toBe(true);
  expect(button(en.apply).disabled).toBe(true);
  expect(button(en.refresh).disabled).toBe(true);
  expect(harness.legacyCalls).toBe(3);
  for (const name of companions)
    expect(button(`Legacy ${name} refresh`).matches(':disabled')).toBe(true);
  await click('Release preparation');
  await act(async () => {
    for (const name of companions) {
      expect(button(`Legacy ${name} refresh`).matches(':disabled')).toBe(false);
      host
        .querySelector(`[data-testid="legacy-${name}"]`)!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  });
  expect(harness.legacyCalls).toBe(6);
});

it('resumes an interrupted actual query-bound More page after read-only preparation releases its owner', async () => {
  const row = { ...signingSource().contract, versionId, versionNumber: 2 },
    cursor = documentId(9);
  let finish!: (value: Response) => void,
    moreCount = 0;
  const fetcher = vi.fn(async (raw: string) => {
    if (new URL(raw, 'https://app.test').searchParams.get('before') === cursor) {
      ++moreCount;
      if (moreCount === 1)
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return response({
        contracts: [{ ...row, id: documentId(8), versionNumber: 3 }],
        nextBefore: null,
      });
    }
    return response({ contracts: [row], nextBefore: cursor });
  });
  vi.stubGlobal('fetch', fetcher);
  let moveSelection!: (id: string) => void;
  function QueryWorkspace() {
    const [raw, setRaw] = useState<Record<string, unknown>>({ contractId });
    moveSelection = (id) => setRaw((value) => ({ ...value, contractId: id }));
    const parsed = staffContractsSearch(raw),
      queue = useListQuery(staffContractQueryOptions, parsed, (change) =>
        setRaw((value) => staffContractsSearch(change(value)))
      );
    return (
      <ContractsWorkspace
        staff
        queries={{
          queue,
          selected: typeof parsed.contractId === 'string' ? parsed.contractId : null,
          select: (id, options) =>
            setRaw((value) =>
              staffContractsSearch({
                ...value,
                contractId: id ?? undefined,
                ...(options?.resetCursor ? { cursor: undefined } : {}),
              })
            ),
          apply: (search, filters) =>
            setRaw((value) =>
              staffContractsSearch(
                writeListQuery(value, staffContractQueryOptions, { search, filters })
              )
            ),
        }}
      />
    );
  }
  await render(<QueryWorkspace />);
  await click(en.next);
  await vi.waitFor(() => expect(finish).toBeDefined());
  await click('Claim immediately');
  await act(async () => moveSelection(documentId(8)));
  expect(host.querySelector('[data-testid=loaded-contract]')?.textContent).toContain(contractId);
  await click('Release preparation');
  expect(host.querySelector('[data-testid=loaded-contract]')?.textContent).toContain(documentId(8));
  await vi.waitFor(() => expect(moreCount).toBe(2));
  expect(host.textContent).toContain(`${en.electricity} · ${en.version} 3`);
  await act(async () => finish(response({ contracts: [], nextBefore: cursor })));
  expect(host.textContent).toContain(`${en.electricity} · ${en.version} 3`);
  expect(button(en.refresh).disabled).toBe(false);
});

it('manual parent refresh genuinely rereads the same detail and preserves unconsumed raw reason', async () => {
  const source = signingSource({ state: 'AwaitingStaffReview' }),
    fetcher = vi.fn(async (raw: string) =>
      raw.includes('/versions')
        ? response({ versions: [source.version], nextBefore: null })
        : raw.includes('/signature?')
          ? response(
              signingView(true, {
                state: 'AwaitingStaffReview',
                canRequest: false,
                canRecord: false,
                request: null,
              })
            )
          : response(source.contract)
    );
  vi.stubGlobal('fetch', fetcher);
  const detail = (revision: number) => (
    <StrictMode>
      <ContractDetail
        id={contractId}
        staff
        refreshRevision={revision}
        onClose={() => {}}
        onChanged={() => {}}
      />
    </StrictMode>
  );
  await render(detail(0));
  await value('contract-change-reason', '  independent raw reason  ');
  const initial = fetcher.mock.calls.filter(
    ([path]) => path === '/api/admin/contracts/' + contractId
  ).length;
  await render(detail(1));
  expect(
    fetcher.mock.calls.filter(([path]) => path === '/api/admin/contracts/' + contractId).length
  ).toBe(initial + 1);
  expect(host.querySelector<HTMLTextAreaElement>('#contract-change-reason')!.value).toBe(
    '  independent raw reason  '
  );
});
it('fences a held sibling signature denial after a parent reason command claims the resource', async () => {
  const source = signingSource({ state: 'AwaitingStaffReview' });
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (raw: string) =>
      raw.includes('/versions')
        ? response({ versions: [source.version], nextBefore: null })
        : raw.includes('/signature?')
          ? new Promise<Response>((resolve) => {
              finish = resolve;
            })
          : response(source.contract)
    )
  );
  await render(<ContractDetail id={contractId} staff onClose={() => {}} onChanged={() => {}} />);
  await vi.waitFor(() => expect(finish).toBeDefined());
  await value('contract-change-reason', 'durable current reason');
  await click(en['request-changes']);
  await vi.waitFor(() => expect(harness.team).not.toBeNull());
  const body = JSON.stringify(harness.team!.action!.body);
  await act(async () => finish(response({}, 403)));
  expect(host.querySelector('#contract-change-reason')).not.toBeNull();
  expect(JSON.stringify(harness.team!.action!.body)).toBe(body);
  expect(host.querySelector('[role=dialog]')).not.toBeNull();
});
