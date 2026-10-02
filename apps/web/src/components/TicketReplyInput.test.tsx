import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TicketReplyInput } from './TicketReplyInput.js';
import { t } from '@barghsa/i18n/app';
import { documentText } from '@barghsa/i18n/documents';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function selectAndPreview(bodyChange = vi.fn()) {
  await act(async () =>
    root.render(
      <TicketReplyInput
        ticketId="ticket"
        profileId={null}
        locale="fa"
        staff={false}
        busy={false}
        body="private draft"
        onBodyChange={bodyChange}
        internal={false}
        onInternalChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    )
  );
  const input = host.querySelector('input[type=file]')!;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File(['%PDF-'], 'proof.pdf', { type: 'application/pdf' })],
  });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  const button = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${documentText('preview', 'fa')}: proof.pdf"]`
  )!;
  await act(async () => button.click());
  return button;
}
it.each([401, 403])(
  'clears private reply and attachment on preview access denial %s without reserving an upload',
  async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal('fetch', fetcher);
    const bodyChange = vi.fn();
    await selectAndPreview(bodyChange);
    expect(bodyChange).toHaveBeenCalledWith('');
    expect(host.textContent).not.toContain('proof.pdf');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![0]).toBe('/api/upload/preview');
    expect(
      host.querySelector(`[aria-label="${t('tickets.removeFile', 'fa')} proof.pdf"]`)
    ).toBeNull();
  }
);
it('hiding a pending reply preview aborts its processing and preserves the selected draft', async () => {
  const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetcher);
  const bodyChange = vi.fn();
  const toggle = await selectAndPreview(bodyChange);
  const signal = fetcher.mock.calls[0]![1].signal as AbortSignal;
  await act(async () => toggle.click());
  expect(signal.aborted).toBe(true);
  expect(host.textContent).toContain('proof.pdf');
  expect(bodyChange).not.toHaveBeenCalled();
  expect(host.querySelector('[data-slot=file-preview]')).toBeNull();
});
