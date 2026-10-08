import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { en } from '@barghsa/i18n/contracts';
import DraftForm from './ContractDraftForm.js';
import { contract, version } from '../lib/contract-authoring-form.fixtures.js';
import type * as Schemas from '../lib/contract-review-signature-form-schemas.js';
const harness = vi.hoisted(() => ({ release: null as (() => void) | null, captures: 0 }));
vi.mock('../hooks/useAccountUser.js', () => ({ useAccountUser: () => 'builder' }));
vi.mock('../lib/profile-context.js', () => ({ useProfileContextRevision: () => 0 }));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../lib/contract-review-signature-form-schemas.js', async (importOriginal) => {
  await new Promise<void>((resolve) => {
    harness.release = resolve;
  });
  return await importOriginal<typeof Schemas>();
});
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: () => {
    ++harness.captures;
    return <div role="dialog" />;
  },
}));
it('keeps native touched reason feedback and first-error focus after companion edits and duplicate submit share a held schema import', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root: Root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <QueryProvider>
          {<DraftForm existing={{ contract, version }} amendment={false} onSaved={vi.fn()} />}
        </QueryProvider>
      )
    );
    const reason = host.querySelector<HTMLTextAreaElement>('#contract-draft-changeDescription')!,
      terms = host.querySelector<HTMLTextAreaElement>('#contract-draft-text')!;
    await act(async () => {
      reason.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        reason,
        'x'.repeat(1001)
      );
      reason.dispatchEvent(new Event('input', { bubbles: true }));
      reason.blur();
    });
    await vi.waitFor(() => expect(harness.release).not.toBeNull());
    await act(async () => {
      terms.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        terms,
        ' New terms '
      );
      terms.dispatchEvent(new Event('input', { bubbles: true }));
      terms.blur();
      const form = host.querySelector('form')!;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(harness.captures).toBe(0);
    expect(host.querySelector('button[aria-busy=true]')).not.toBeNull();
    await act(async () => harness.release!());
    await vi.waitFor(() => {
      expect(reason.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(reason);
      const ids = reason.getAttribute('aria-describedby')!.split(' ');
      expect(ids.some((id) => document.getElementById(id)?.getAttribute('role') === 'alert')).toBe(
        true
      );
    });
    expect(reason.value).toHaveLength(1001);
    expect(terms.value).toBe(' New terms ');
    expect(harness.captures).toBe(0);
    expect(host.textContent).toContain(en.contextReason);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
