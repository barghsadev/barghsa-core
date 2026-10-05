import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProfileClosureReview } from './ProfileClosureReview.js';
import type { TicketCoordination, TicketOwner } from '../lib/ticket-form.js';

const ticketId = '11111111-1111-7111-8111-111111111111';
const basePreview = {
  eligible: true,
  completedAt: null,
  anonymizeProfile: false,
  blockers: [{ code: 'securityReview', count: 1 }],
  retained: { invoices: 1 },
  exportTicketId: null,
  previewVersion: 'a'.repeat(64),
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(onCompleted = vi.fn()) {
  await act(async () =>
    root.render(<ProfileClosureReview ticketId={ticketId} locale="en" onCompleted={onCompleted} />)
  );
  return onCompleted;
}

it('shows blockers and retained records without offering approval', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ...basePreview,
        eligible: false,
        blockers: [
          { code: 'unpaidInvoice', count: 1 },
          { code: 'securityReview', count: 1 },
        ],
      }),
    }))
  );
  await render();
  expect(container.textContent).toContain('Unpaid invoices');
  expect(container.textContent).toContain('Invoices: 1');
  expect(container.textContent).toContain('Resolve the blockers');
  expect(container.textContent).not.toContain('Approve and close profile');
});

it('requires explicit review and password step-up before executing', async () => {
  let completed = false;
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/step-up')) return { ok: true, json: async () => ({}) };
      if (url.endsWith('/execute-closure')) {
        expect(JSON.parse(init?.body as string)).toEqual({
          previewVersion: basePreview.previewVersion,
          confirmation: 'CLOSE_PROFILE',
        });
        completed = true;
        return { ok: true, json: async () => ({ created: true }) };
      }
      return {
        ok: true,
        json: async () => ({
          ...basePreview,
          completedAt: completed ? '2026-09-29T00:00:00Z' : null,
        }),
      };
    })
  );
  const onCompleted = await render();
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === 'Approve and close profile'
  )!;
  expect(button.disabled).toBe(true);
  await act(async () => {
    (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    const password = container.querySelector('input[type="password"]') as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      password,
      'secret'
    );
    password.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(button.disabled).toBe(false);
  await act(async () => {
    (container.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
  });
  expect(calls).toContain('POST /api/auth/step-up');
  expect(calls).toContain(`POST /api/staff/tickets/${ticketId}/execute-closure`);
  expect(calls.indexOf('POST /api/auth/step-up')).toBeLessThan(
    calls.indexOf(`POST /api/staff/tickets/${ticketId}/execute-closure`)
  );
  expect(onCompleted).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('The profile is closed');
});
it('claims the ticket before manual preview reads and rejects simultaneous closure execution', async () => {
  let owner: TicketOwner | null = null;
  let finish!: (response: Response) => void;
  let reads = 0;
  const coordination: TicketCoordination = {
    claim: (next) => {
      if (owner) return false;
      owner = next;
      return true;
    },
    release: (next) => {
      if (owner === next) owner = null;
    },
    isLocked: (next) => !!owner && (!next || owner !== next),
    isCurrent: () => true,
    denied: vi.fn(),
  };
  const fetcher = vi.fn(async (_url: string) => {
    if (++reads === 1) return Response.json(basePreview);
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(
      <ProfileClosureReview
        ticketId={ticketId}
        locale="en"
        onCompleted={vi.fn()}
        coordination={coordination}
      />
    )
  );
  await act(async () => {
    container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    const password = container.querySelector<HTMLInputElement>('input[type=password]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      password,
      'secret'
    );
    password.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const refresh = container.querySelector<HTMLButtonElement>('button[type=button]')!;
  const form = container.querySelector('form')!;
  await act(async () => {
    refresh.click();
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(owner).toBe('closure');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every((call) => !String(call[0]).endsWith('/step-up'))).toBe(true);
  await act(async () => finish(Response.json(basePreview)));
  expect(owner).toBeNull();
});
it.each([401, 422])(
  'closure step-up %s withdraws expired authority while preserving wrong-password feedback',
  async (status) => {
    const denied = vi.fn();
    const coordination: TicketCoordination = {
      claim: () => true,
      release: vi.fn(),
      isLocked: () => false,
      isCurrent: () => true,
      denied,
    };
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith('/step-up')
        ? Response.json({ error: { code: 'failure' } }, { status })
        : Response.json(basePreview)
    );
    vi.stubGlobal('fetch', fetcher);
    await act(async () =>
      root.render(
        <ProfileClosureReview
          ticketId={ticketId}
          locale="en"
          onCompleted={vi.fn()}
          coordination={coordination}
        />
      )
    );
    await act(async () => {
      container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
      const password = container.querySelector<HTMLInputElement>('input[type=password]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        password,
        'secret'
      );
      password.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `/api/staff/tickets/${ticketId}/closure-preview`,
      '/api/auth/step-up',
    ]);
    expect(container.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');
    if (status === 401) expect(denied).toHaveBeenCalledOnce();
    else {
      expect(denied).not.toHaveBeenCalled();
      expect(container.querySelector('[role=alert]')).not.toBeNull();
    }
  }
);
