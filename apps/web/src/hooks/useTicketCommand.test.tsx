import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useTicketCommand } from './useTicketCommand.js';

afterEach(() => vi.unstubAllGlobals());

it('withdraws captured private work on current grant loss and fences a late receipt and old-owner release from a fresh scope', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  vi.stubGlobal('fetch', fetcher);
  const denied = vi.fn(),
    accepted = vi.fn();
  let command!: ReturnType<typeof useTicketCommand>;
  function Harness({ scope, granted }: { scope: string; granted: boolean }) {
    command = useTicketCommand(scope, denied, () => granted);
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(<QueryProvider>{<Harness scope="actor/profile/ticket" granted />}</QueryProvider>)
    );
    const previous = command.coordination;
    let pending!: Promise<boolean>;
    await act(async () => {
      expect(previous.claim('reply-public')).toBe(true);
      pending = command.submit({
        owner: 'reply-public',
        path: '/api/tickets/ticket/comments',
        method: 'POST',
        status: 201,
        body: { body: 'Captured private draft', visibility: 'public', submissionId: 'captured-id' },
        confirmed: (value) => !!value && typeof value === 'object' && 'id' in value,
        accepted,
      });
    });
    expect(fetcher).toHaveBeenCalledOnce();
    await act(async () =>
      root.render(
        <QueryProvider>{<Harness scope="actor/profile/ticket" granted={false} />}</QueryProvider>
      )
    );
    expect(denied).toHaveBeenCalledOnce();
    expect(command.locked).toBeNull();
    await act(async () =>
      root.render(<QueryProvider>{<Harness scope="fresh/profile/ticket" granted />}</QueryProvider>)
    );
    await act(async () => {
      expect(command.coordination.claim('reply-public')).toBe(true);
      previous.release('reply-public');
    });
    expect(command.locked).toBe('reply-public');
    await act(async () => {
      finish(Response.json({ id: 'receipt' }, { status: 201 }));
      expect(await pending).toBe(false);
    });
    expect(accepted).not.toHaveBeenCalled();
    expect(command.locked).toBe('reply-public');
    await act(async () => command.coordination.release('reply-public'));
    expect(command.locked).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
