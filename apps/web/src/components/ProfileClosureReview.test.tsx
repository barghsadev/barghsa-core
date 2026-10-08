import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProfileClosureReview } from './ProfileClosureReview.js';
import { useTicketCommand } from '../hooks/useTicketCommand.js';
import type { TicketCoordination, TicketOwner } from '../lib/ticket-form.js';

import { AccountUserProvider } from '../hooks/useAccountUser.js';
import {
  actualClosurePreview,
  actualStepUp,
  lifecycleInstant,
  lifecycleTicketId as ticketId,
} from './profile-lifecycle-test-fixture.js';
const basePreview = actualClosurePreview();
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
    root.render(
      <QueryProvider>
        {
          <AccountUserProvider value="staff/opaque">
            <ProfileClosureReview ticketId={ticketId} locale="en" onCompleted={onCompleted} />
          </AccountUserProvider>
        }
      </QueryProvider>
    )
  );
  return onCompleted;
}

it('shows blockers and retained records without offering approval', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ...basePreview,
        eligible: false,
        blockers: actualClosurePreview().blockers.map((b) =>
          b.code === 'unpaidInvoice' ? { ...b, count: 1 } : b
        ),
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
      if (url.endsWith('/step-up')) return Response.json(actualStepUp());
      if (url.endsWith('/execute-closure')) {
        expect(JSON.parse(init?.body as string)).toEqual({
          previewVersion: basePreview.previewVersion,
          confirmation: 'CLOSE_PROFILE',
        });
        completed = true;
        return Response.json({
          ...basePreview,
          completedAt: lifecycleInstant,
          anonymized: false,
          created: true,
        });
      }
      return Response.json({
        ...basePreview,
        completedAt: completed ? lifecycleInstant : null,
        anonymized: completed ? false : null,
      });
    })
  );
  const onCompleted = await render();
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === 'Approve and close profile'
  )!;
  expect(button.disabled).toBe(false);
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
    await vi.dynamicImportSettled();
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
      <QueryProvider>
        {
          <AccountUserProvider value="staff/opaque">
            <ProfileClosureReview
              ticketId={ticketId}
              locale="en"
              onCompleted={vi.fn()}
              coordination={coordination}
            />
          </AccountUserProvider>
        }
      </QueryProvider>
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
    await vi.dynamicImportSettled();
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
        <QueryProvider>
          {
            <AccountUserProvider value="staff/opaque">
              <ProfileClosureReview
                ticketId={ticketId}
                locale="en"
                onCompleted={vi.fn()}
                coordination={coordination}
              />
            </AccountUserProvider>
          }
        </QueryProvider>
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
    await submitApproval();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `/api/staff/tickets/${ticketId}/closure-preview`,
      '/api/auth/step-up',
    ]);
    if (status === 422)
      expect(container.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe(
        'secret'
      );
    if (status === 401) expect(denied).toHaveBeenCalledOnce();
    else {
      expect(denied).not.toHaveBeenCalled();
      expect(container.querySelector('[role=alert]')).not.toBeNull();
    }
  }
);

const rawPassword = [' Raw synthetic ', '12A '].join('');
async function fillApproval() {
  await act(async () => {
    container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    const password = container.querySelector<HTMLInputElement>('input[type=password]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      password,
      rawPassword
    );
    password.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submitApproval() {
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
}
it('links native field errors, focuses the first invalid field and sends no mutation', async () => {
  const fetcher = vi.fn(async () => Response.json(basePreview));
  vi.stubGlobal('fetch', fetcher);
  await render();
  await submitApproval();
  const confirmed = container.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  expect(confirmed.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(confirmed);
  const errorId = confirmed
    .getAttribute('aria-describedby')!
    .split(' ')
    .find((id) => document.getElementById(id)?.textContent?.includes('Confirm that'));
  expect(errorId).toBeTruthy();
  expect(fetcher).toHaveBeenCalledOnce();
});
it('requires the actual step-up proof before closure and retains a rejected password draft', async () => {
  const fetcher = vi.fn(async (url: string) =>
    Response.json(url.endsWith('/step-up') ? {} : basePreview)
  );
  vi.stubGlobal('fetch', fetcher);
  const completed = await render();
  await fillApproval();
  await submitApproval();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    `/api/staff/tickets/${ticketId}/closure-preview`,
    '/api/auth/step-up',
  ]);
  expect(container.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe(
    rawPassword
  );
  expect(completed).not.toHaveBeenCalled();
  expect(container.querySelector('[role=alert]')).not.toBeNull();
});
it('retains closure ownership after a malformed completion and retries the original dry-run after language changes', async () => {
  let owner: TicketOwner | null = null;
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
  const writes: unknown[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/step-up')) {
      expect(JSON.parse(String(init!.body)).password).toBe(rawPassword);
      return Response.json(actualStepUp());
    }
    if (url.endsWith('/execute-closure')) {
      writes.push(JSON.parse(String(init!.body)));
      return Response.json(
        writes.length === 1
          ? { created: true }
          : {
              ...basePreview,
              created: false,
              eligible: false,
              previewVersion: 'b'.repeat(64),
              completedAt: lifecycleInstant,
              anonymized: false,
            }
      );
    }
    return Response.json(basePreview);
  });
  vi.stubGlobal('fetch', fetcher);
  const completed = vi.fn();
  const mount = (locale: 'en' | 'fa') =>
    root.render(
      <QueryProvider>
        {
          <AccountUserProvider value="staff/opaque">
            <ProfileClosureReview
              ticketId={ticketId}
              locale={locale}
              onCompleted={completed}
              coordination={coordination}
              disabled={!!owner}
            />
          </AccountUserProvider>
        }
      </QueryProvider>
    );
  await act(async () => mount('en'));
  await fillApproval();
  await act(async () => {
    const form = container.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
  expect(writes).toHaveLength(1);
  expect(completed).not.toHaveBeenCalled();
  expect(owner).toBe('closure');
  expect(coordination.claim('reply-public')).toBe(false);
  await act(async () => mount('fa'));
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'تلاش دوباره با همان درخواست')!
      .click()
  );
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(completed).toHaveBeenCalledOnce();
  expect(owner).toBeNull();
});
it('requires a refreshed preview and renewed consent after a known changed-review conflict', async () => {
  let reads = 0,
    writes = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/step-up')) return Response.json(actualStepUp());
      if (url.endsWith('/execute-closure')) {
        writes++;
        return Response.json({}, { status: 409 });
      }
      return Response.json({
        ...basePreview,
        previewVersion: ++reads === 1 ? 'a'.repeat(64) : 'b'.repeat(64),
      });
    })
  );
  const completed = await render();
  await fillApproval();
  await submitApproval();
  expect(container.textContent).toContain('The closure review has changed');
  expect(container.querySelector('form')).toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('button[type=button]')!.click());
  expect(container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
  expect(container.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe(
    rawPassword
  );
  await submitApproval();
  expect(writes).toBe(1);
  expect(completed).not.toHaveBeenCalled();
});
it('discards a late staff preview after an account change', async () => {
  let finish!: (r: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    )
  );
  await render();
  const old = finish;
  await act(async () =>
    root.render(
      <QueryProvider>
        {
          <AccountUserProvider value="other/staff">
            <ProfileClosureReview ticketId={ticketId} locale="en" onCompleted={vi.fn()} />
          </AccountUserProvider>
        }
      </QueryProvider>
    )
  );
  await act(async () => old(Response.json(basePreview)));
  expect(container.querySelector('form')).toBeNull();
  await act(async () => finish(Response.json(basePreview)));
  expect(container.querySelector('form')).not.toBeNull();
});

it('replays an unresolved closure through the actual reactive ticket coordinator', async () => {
  const writes: unknown[] = [];
  const completed = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/step-up')) return Response.json(actualStepUp());
      if (url.endsWith('/execute-closure')) {
        writes.push(JSON.parse(String(init!.body)));
        return Response.json(
          writes.length === 1
            ? { created: true }
            : {
                ...basePreview,
                created: false,
                eligible: false,
                completedAt: lifecycleInstant,
                anonymized: false,
                previewVersion: 'b'.repeat(64),
              }
        );
      }
      return Response.json(basePreview);
    })
  );
  function Parent() {
    const command = useTicketCommand('closure/test', vi.fn());
    return (
      <ProfileClosureReview
        ticketId={ticketId}
        locale="en"
        onCompleted={completed}
        coordination={command.coordination}
        disabled={command.busy}
      />
    );
  }
  await act(async () =>
    root.render(
      <QueryProvider>
        {
          <AccountUserProvider value="staff/opaque">
            <Parent />
          </AccountUserProvider>
        }
      </QueryProvider>
    )
  );
  await fillApproval();
  await submitApproval();
  expect(writes).toHaveLength(1);
  await act(async () => {
    const password = container.querySelector<HTMLInputElement>('input[type=password]')!;
    password.focus();
    password.blur();
    await vi.dynamicImportSettled();
  });
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Retry the original request')!
      .click()
  );
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(completed).toHaveBeenCalledOnce();
});
