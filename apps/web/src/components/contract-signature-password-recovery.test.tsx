import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ContractSignaturePanel } from './ContractSignaturePanel.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  actor,
  contractId,
  versionId,
  profileId,
  documentId,
  signingView,
  signingDocument,
  signingReview,
  signingReceipt,
} from '../test/contract-review-signature-fixtures.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ status: 'ready', notice: null, format: String }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: String, money: String, percent: String }),
}));
it('actual password step-up and unknown recovery resend the same immutable command without another financial preview', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    changed = vi.fn(),
    view = signingView(true),
    doc = signingDocument(),
    review = signingReview(view, doc);
  let writes = 0;
  const bodies: string[] = [];
  const response = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status });
  const fetcher = vi.fn(async (raw: string, init?: RequestInit) => {
    if (raw.endsWith('/step-up')) return response({ verified: true });
    if (raw.includes('/signature?')) return response(view);
    if (raw.endsWith('/signature/review')) return response(review);
    if (raw.endsWith('/signature')) {
      bodies.push(String(init?.body));
      ++writes;
      return writes === 1
        ? response(
            { error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code }, requiresStepUp: true },
            403
          )
        : writes === 2
          ? response({})
          : response(signingReceipt(view, doc, review, true));
    }
    return response({ documents: [signingDocument(1, 'original'), doc], nextBefore: null });
  });
  vi.stubGlobal('fetch', fetcher);
  const button = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (el) => el.textContent === text
    )!;
  try {
    await act(async () =>
      root.render(
        <AccountUserProvider value={actor}>
          <ContractSignaturePanel
            id={contractId}
            versionId={versionId}
            profileId={profileId}
            staff
            onChanged={changed}
          />
        </AccountUserProvider>
      )
    );
    const select = host.querySelector<HTMLSelectElement>('#signature-signed')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
        select,
        documentId(2)
      );
      select.dispatchEvent(new Event('change', { bubbles: true }));
      host.querySelector<HTMLInputElement>('#signature-acknowledgement')!.click();
    });
    await act(async () => button('Record signed copy').click());
    await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).not.toBeNull());
    await act(async () =>
      document
        .querySelector<HTMLFormElement>('[role=dialog] form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    await vi.waitFor(() => expect(document.querySelector('#team-step-up-password')).not.toBeNull());
    const password = document.querySelector<HTMLInputElement>('#team-step-up-password')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        password,
        'exact-password'
      );
      password.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      document
        .querySelector<HTMLFormElement>('[role=dialog] form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    await vi.waitFor(() =>
      expect(host.querySelector('[data-testid=contract-signature-retry]')).not.toBeNull()
    );
    expect(document.querySelector('[role=dialog]')).toBeNull();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid=contract-signature-retry]')!.click()
    );
    await act(async () =>
      document
        .querySelector<HTMLFormElement>('[role=dialog] form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies).size).toBe(1);
    expect(fetcher.mock.calls.filter(([raw]) => raw.endsWith('/signature/review'))).toHaveLength(1);
    expect(JSON.parse(bodies[0]!)).toMatchObject({
      signedDocumentId: documentId(2),
      expectedReviewHash: review.hash,
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
