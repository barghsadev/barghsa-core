import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { en } from '@barghsa/i18n/contracts';
import { ContractDetail } from './ContractDetail.js';
import { ContractDraftEditor } from './ContractDraftEditor.js';
import { ContractsWorkspace } from './ContractsWorkspace.js';
import type * as DraftModule from './ContractDraftForm.js';
import type { ContractCancellationPanel } from './ContractCancellationPanel.js';
import type { ContractActivationPanel } from './ContractActivationPanel.js';
import type { ContractFinancialReviewDialog } from './ContractFinancialReviewDialog.js';
import type { TeamActionDialog } from './TeamActionDialog.js';
import {
  signingSource,
  signingView,
  signingDocument,
  signingReview,
  actor,
  contractId,
} from '../test/contract-review-signature-fixtures.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
const harness = vi.hoisted(() => ({
  release: null as (() => void) | null,
  loads: 0,
  fail: false,
  team: null as ComponentProps<typeof TeamActionDialog> | null,
  review: null as ComponentProps<typeof ContractFinancialReviewDialog> | null,
  cancellation: null as ComponentProps<typeof ContractCancellationPanel> | null,
  activation: null as ComponentProps<typeof ContractActivationPanel> | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('./ContractDraftForm.js', async (importOriginal) => {
  await new Promise<void>((resolve) => {
    harness.release = resolve;
  });
  const actual = await importOriginal<typeof DraftModule>();
  return {
    get default() {
      ++harness.loads;
      if (harness.fail) throw new Error('Unavailable authoring chunk');
      return actual.default;
    },
  };
});
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: (props: ComponentProps<typeof TeamActionDialog>) => {
    harness.team = props;
    return <div role="dialog">Draft confirmation</div>;
  },
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ status: 'ready', notice: null, format: String }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: String, money: String }),
}));
vi.mock('./ContractCancellationPanel.js', () => ({
  ContractCancellationPanel: (props: ComponentProps<typeof ContractCancellationPanel>) => {
    harness.cancellation = props;
    return null;
  },
}));
vi.mock('./ContractActivationPanel.js', () => ({
  ContractActivationPanel: (props: ComponentProps<typeof ContractActivationPanel>) => {
    harness.activation = props;
    return null;
  },
}));
vi.mock('./ContractFinancialReviewDialog.js', () => ({
  ContractFinancialReviewDialog: (props: ComponentProps<typeof ContractFinancialReviewDialog>) => {
    harness.review = props;
    return <div role="dialog">Signature confirmation</div>;
  },
}));
vi.mock('./DocumentsWorkspace.js', () => ({ DocumentResults: () => null }));
vi.mock('./DocumentUpload.js', () => ({ DocumentUpload: () => null }));
vi.mock('./ContractDetailLoader.js', () => ({
  ContractDetailLoader: (props: ComponentProps<typeof ContractDetail>) => (
    <button onClick={() => props.coordination?.acquire({})}>Claim signature owner</button>
  ),
}));
vi.mock('./ContractRefundQueue.js', () => ({ ContractRefundQueue: () => null }));
vi.mock('./ContractCancellationRequestQueue.js', () => ({
  ContractCancellationRequestQueue: () => null,
}));
vi.mock('./ContractActivationRules.js', () => ({ ContractActivationRules: () => null }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.fail = false;
  harness.team = null;
  harness.review = null;
  harness.cancellation = null;
  harness.activation = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
function button(label: string) {
  const found = [...host.querySelectorAll('button')].find((node) => node.textContent === label);
  expect(found, label).toBeDefined();
  return found!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function releaseFormLoad() {
  await vi.waitFor(() => expect(harness.release).not.toBeNull());
  await act(async () => harness.release!());
}
async function value(label: string, raw: string) {
  const field = [...host.querySelectorAll('label')].find((node) => node.textContent === label)!;
  expect(field, label).toBeDefined();
  const control = document.getElementById(field.htmlFor) as
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : control instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype,
      'value'
    )!.set!.call(control, raw);
    control.dispatchEvent(
      new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
it('loads only after opening, cancels a held load and seeds the current source when reopened', async () => {
  const first = signingSource({ state: 'Draft' }),
    saved = vi.fn();
  await act(async () =>
    root.render(
      <AccountUserProvider value={actor}>
        <ContractDraftEditor existing={first} onSaved={saved} />
      </AccountUserProvider>
    )
  );
  expect(harness.release).toBeNull();
  expect(host.querySelector('form')).toBeNull();
  await click(en.draftEdit);
  await vi.waitFor(() => expect(harness.release).not.toBeNull());
  expect(host.textContent).toContain(en.loading);
  const fresh = {
    ...first,
    version: { ...first.version, content: { title: 'New source title', text: 'New source terms' } },
  };
  await act(async () =>
    root.render(
      <AccountUserProvider value={actor}>
        <ContractDraftEditor existing={fresh} onSaved={saved} />
      </AccountUserProvider>
    )
  );
  // The material source key remounts the editor closed; cancel its new held load explicitly.
  expect(host.querySelector('form')).toBeNull();
  await click(en.draftEdit);
  await click(en.draftEdit);
  await act(async () => harness.release!());
  expect(host.querySelector('form')).toBeNull();
  expect(host.querySelector('[role=alert]')).toBeNull();
  await click(en.draftEdit);
  await vi.waitFor(() => expect(host.querySelector('form')).not.toBeNull());
  expect(host.querySelector('input[id$="-title"]')).toHaveProperty('value', 'New source title');
  expect(host.querySelector('textarea[id$="-text"]')).toHaveProperty('value', 'New source terms');
  await value(en.draftTerms, 'Raw unsaved terms');
  await click(en.draftEdit);
  await click(en.draftEdit);
  expect(host.querySelector('textarea[id$="-text"]')).toHaveProperty('value', 'New source terms');
  expect(saved).not.toHaveBeenCalled();
});
it('shows a load error and retries without changing the current amendment source', async () => {
  harness.fail = true;
  const source = signingSource({ state: 'Active' }),
    saved = vi.fn();
  await act(async () =>
    root.render(
      <AccountUserProvider value={actor}>
        <ContractDraftEditor existing={source} amendment onSaved={saved} />
      </AccountUserProvider>
    )
  );
  await click(en.amendmentCreate);
  await releaseFormLoad();
  await vi.waitFor(() => expect(host.querySelector('[role=alert]')).not.toBeNull());
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).toContain(en.error);
  harness.fail = false;
  await click(en.refresh);
  await vi.waitFor(() => expect(host.querySelector('form')).not.toBeNull());
  expect(host.textContent).toContain(en.amendmentBaseNotice);
  await value(en.draftTerms, 'Replacement terms');
  await value(en.contextReason, 'Extend term');
  await click(en.amendmentReview);
  await act(async () => vi.dynamicImportSettled());
  expect(harness.team?.action?.body).toMatchObject({
    expectedVersionId: source.version.id,
    content: { ...source.version.content, text: 'Replacement terms' },
  });
  expect(harness.team?.action?.path).toBe(`/api/admin/contracts/${contractId}/amendments`);
  expect(saved).not.toHaveBeenCalled();
});
it('keeps the real deferred authoring draft behind the synchronous workspace sibling owner', async () => {
  const source = signingSource({ state: 'Draft' });
  window.history.replaceState(null, '', '/?contractId=' + contractId);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            !url.includes('/authoring-options') && url.includes('/contracts')
              ? {
                  contracts: [
                    { ...source.contract, versionId: source.version.id, versionNumber: 2 },
                  ],
                  nextBefore: null,
                }
              : { profiles: [], nextBefore: null }
          )
        )
    )
  );
  await act(async () =>
    root.render(
      <AccountUserProvider value="reviewer">
        <ContractsWorkspace staff />
      </AccountUserProvider>
    )
  );
  await vi.waitFor(() => expect(host.textContent).toContain('Claim signature owner'));
  await click(en.draftCreate);
  await releaseFormLoad();
  await vi.waitFor(() =>
    expect(host.querySelector('form[aria-label="' + en.draftCreate + '"]')).not.toBeNull()
  );
  await value(en.draftTerms, 'Independent raw draft');
  await act(async () => {
    button('Claim signature owner').click();
    button(en.draftReview).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    host
      .querySelector('form[aria-label="' + en.draftCreate + '"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(button(en.draftCreate).matches(':disabled')).toBe(true);
  expect(harness.team).toBeNull();
  expect(host.querySelector('[role=alert]')).toBeNull();
  expect(host.querySelector('textarea[id$="-text"]')).toHaveProperty(
    'value',
    'Independent raw draft'
  );
});

it('blocks an opened local amendment and retained legacy callbacks while an original signature is uncertain', async () => {
  const source = signingSource({
    state: 'Accepted',
    amendmentSupported: true,
    pendingAmendment: null,
  });
  const view = signingView(true, {
    state: 'Accepted',
    canRequest: true,
    canRecord: false,
    request: null,
  });
  const document = signingDocument(1, 'original'),
    changed = vi.fn();
  const fetcher = vi.fn(
    async (url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === 'POST'
            ? signingReview(view, document, true)
            : url.includes('/signature?')
              ? view
              : url.includes('/documents')
                ? { documents: [document], nextBefore: null }
                : url.includes('/versions')
                  ? { versions: [source.version], nextBefore: null }
                  : source.contract
        )
      )
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(
      <AccountUserProvider value={actor}>
        <ContractDetail id={contractId} staff onClose={() => {}} onChanged={changed} />
      </AccountUserProvider>
    )
  );
  await vi.waitFor(() => expect(host.querySelector('#signature-original')).not.toBeNull());
  await click(en.amendmentCreate);
  await releaseFormLoad();
  await vi.waitFor(() =>
    expect(host.querySelector('form[aria-label="' + en.amendmentCreate + '"]')).not.toBeNull()
  );
  await value(en.draftTerms, 'Independent replacement terms');
  await value(en.contextReason, 'Independent amendment reason');
  const oldCancellation = harness.cancellation!,
    oldActivation = harness.activation!;
  await value(en.approvedOriginal, document.id);
  await click(en.prepareSignature);
  await vi.waitFor(() => expect(harness.review).not.toBeNull());
  const captured = harness.review!,
    body = JSON.stringify(captured.action.body);
  await act(async () => {
    captured.onPendingChange?.(true);
    captured.onUnconfirmed?.();
  });
  const calls = fetcher.mock.calls.length;
  const form = host.querySelector('form[aria-label="' + en.amendmentCreate + '"]')!;
  expect(button(en.amendmentCreate).matches(':disabled')).toBe(true);
  expect(button(en.amendmentReview).matches(':disabled')).toBe(true);
  await act(async () => {
    button(en.amendmentCreate).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    button(en.amendmentReview).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    oldCancellation.onChanged();
    oldActivation.onChanged!();
  });
  expect(harness.team).toBeNull();
  expect(changed).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(host.querySelector('textarea[id$="-text"]')).toHaveProperty(
    'value',
    'Independent replacement terms'
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid=contract-signature-retry]')!.click()
  );
  expect(JSON.stringify(harness.review!.action.body)).toBe(body);
  expect(fetcher).toHaveBeenCalledTimes(calls);
});
