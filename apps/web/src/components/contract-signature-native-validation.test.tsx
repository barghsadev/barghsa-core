import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type * as SchemaModule from '../lib/contract-review-signature-form-schemas.js';
import { ContractSignaturePanel } from './ContractSignaturePanel.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import {
  contractId,
  versionId,
  profileId,
  signingView,
  signingDocument,
  actor,
} from '../test/contract-review-signature-fixtures.js';
const held = vi.hoisted(() => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, ready };
});
vi.mock('../lib/contract-review-signature-form-schemas.js', async (importOriginal) => {
  await held.ready;
  return await importOriginal<typeof SchemaModule>();
});
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ status: 'ready', notice: null, format: String }),
}));
it('keeps the authoritative empty signed-copy error after native blur, companion acknowledgement and duplicate held-import submits', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const fetcher = vi.fn(
    async (path: string) =>
      new Response(
        JSON.stringify(
          path.includes('/signature?')
            ? signingView()
            : { documents: [signingDocument()], nextBefore: null }
        )
      )
  );
  vi.stubGlobal('fetch', fetcher);
  try {
    await act(async () =>
      root.render(
        <AccountUserProvider value={actor}>
          <ContractSignaturePanel
            id={contractId}
            versionId={versionId}
            profileId={profileId}
            staff={false}
            onChanged={() => {}}
          />
        </AccountUserProvider>
      )
    );
    const select = host.querySelector<HTMLSelectElement>('#signature-signed')!,
      checkbox = host.querySelector<HTMLInputElement>('#signature-acknowledgement')!,
      form = host.querySelector('form')!;
    await act(async () => {
      select.focus();
      select.blur();
      checkbox.click();
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => held.release());
    await vi.waitFor(() => {
      expect(select.getAttribute('aria-invalid')).toBe('true');
      expect(select.getAttribute('aria-describedby')).toBeTruthy();
      expect(document.activeElement).toBe(select);
    });
    expect(host.textContent).toContain('Select an eligible approved document.');
    expect(fetcher.mock.calls.every(([path]) => !path.includes('/signature/review'))).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
