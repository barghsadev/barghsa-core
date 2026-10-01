import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CustomerTicketsPage, StaffTicketsPage } from './TicketsPage.js';
import {
  supportTicket,
  supportQueue,
  supportPeople,
  supportTeams,
  supportComments,
} from '../test/support-queue-fixtures.js';

const search = vi.hoisted(() => ({ value: {} as { scope?: string; ticketId?: string } }));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => search.value,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (value: string) => value, notice: null }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  search.value = {};
  document.documentElement.lang = 'fa';
});
function button(host: ParentNode, label: string) {
  const found = Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent === label || item.getAttribute('aria-label') === label
  );
  expect(found, label).toBeDefined();
  return found!;
}
async function mount(Page: ComponentType) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Page />));
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
function data(url: string) {
  if (url.includes('?')) return supportQueue;
  if (url.endsWith('/comments')) return supportComments;
  if (url.endsWith('/assignees')) return supportPeople;
  if (url.endsWith('/teams')) return supportTeams;
  if (url.endsWith('/options')) return { profiles: [], records: [] };
  return supportTicket;
}
async function change(host: ParentNode, selector: string, value: string) {
  const field = host.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    selector
  )!;
  const prototype =
    field.tagName === 'SELECT'
      ? HTMLSelectElement.prototype
      : field.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(
      new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })
    );
  });
}
for (const Page of [CustomerTicketsPage, StaffTicketsPage]) {
  it(`${Page.name}: failed page recovery keeps accepted rows, selected conversation and drafts; retry only reads that page`, async () => {
    let status = 503;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options?: RequestInit) => {
        calls.push(url);
        if (options?.method) return new Response('{}', { status: 409 });
        if (url.includes('?') && status !== 200) return new Response('{}', { status });
        return Response.json(data(url));
      })
    );
    const { host, close } = await mount(Page);
    try {
      status = 200;
      await act(async () => button(host, 'Retry').click());
      await act(async () => button(host, supportTicket.subject).click());
      await change(host, '#ticket-reply', 'Unsaved response');
      const beforeView = calls.length;
      await act(async () => button(host, 'Table').click());
      await act(async () => button(host, 'Cards').click());
      expect(calls).toHaveLength(beforeView);
      expect(host.querySelector<HTMLTextAreaElement>('#ticket-reply')?.value).toBe(
        'Unsaved response'
      );
      if (Page === StaffTicketsPage) {
        await act(async () =>
          host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click()
        );
        await change(host, '#ticket-status-reason', 'Awaiting another document');
        await change(host, '#ticket-team', 'team');
        await change(host, '#ticket-assignee', 'other');
      }
      await act(async () => button(host, 'Send reply').click());
      expect(host.textContent).toContain('changed or needs reopening');
      status = 503;
      await act(async () => button(host, 'Next').click());
      expect(host.querySelector('[data-slot="ticket-queue-records"]')?.textContent).toContain(
        supportTicket.subject
      );
      expect(host.querySelector('h2')?.textContent).toBe(supportTicket.subject);
      expect(host.querySelector<HTMLTextAreaElement>('#ticket-reply')?.value).toBe(
        'Unsaved response'
      );
      expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('1');
      const failedQuery = calls.at(-1)!;
      expect(new URL(failedQuery, 'https://local').searchParams.get('page')).toBe('2');
      const count = calls.length;
      status = 200;
      await act(async () => button(host, 'Retry').click());
      expect(calls.slice(count)).toEqual([failedQuery]);
      expect(host.textContent).toContain('changed or needs reopening');
      expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('2');
      expect(host.querySelector<HTMLTextAreaElement>('#ticket-reply')?.value).toBe(
        'Unsaved response'
      );
      if (Page === StaffTicketsPage) {
        expect(host.querySelector<HTMLTextAreaElement>('#ticket-status-reason')?.value).toBe(
          'Awaiting another document'
        );
        expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(true);
        expect(host.querySelector<HTMLSelectElement>('#ticket-assignee')?.value).toBe('other');
        expect(host.querySelector<HTMLSelectElement>('#ticket-team')?.value).toBe('team');
      }
    } finally {
      await close();
    }
  });
}
it('queue permission denial invalidates a racing detail response and clears selected work', async () => {
  let status = 200;
  let finish: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith(supportTicket.id))
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      if (url.includes('?') && status !== 200) return new Response('{}', { status });
      return Response.json(data(url));
    })
  );
  const { host, close } = await mount(StaffTicketsPage);
  try {
    await act(async () => button(host, supportTicket.subject).click());
    status = 403;
    await act(async () => button(host, 'Refresh tickets').click());
    await act(async () => finish!(Response.json(supportTicket)));
    expect(host.querySelector('[data-slot="ticket-queue-records"]')).toBeNull();
    expect(host.querySelector('article')).toBeNull();
    expect(host.querySelector('[data-slot="list-content"] button')).toBeNull();
    expect(host.textContent).toContain('no longer have permission');
  } finally {
    await close();
  }
});
it('detail failure retries only the selected ticket and comments, without reloading the queue', async () => {
  let status = 503;
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return url.endsWith(supportTicket.id) && status !== 200
        ? new Response('{}', { status })
        : Response.json(data(url));
    })
  );
  const { host, close } = await mount(CustomerTicketsPage);
  try {
    await act(async () => button(host, supportTicket.subject).click());
    expect(host.querySelector('[data-slot="ticket-queue-records"]')).not.toBeNull();
    const count = calls.length;
    status = 200;
    await act(async () => button(host, 'Retry').click());
    expect(calls.slice(count)).toEqual([
      `/api/tickets/${supportTicket.id}`,
      `/api/tickets/${supportTicket.id}/comments`,
    ]);
    expect(host.querySelector('h2')?.textContent).toBe(supportTicket.subject);
    expect(host.textContent).toContain('Public answer');
    expect(host.textContent).not.toContain('Private staff reasoning');
  } finally {
    await close();
  }
});
it('ticket creation options recover locally while preserving text and file input identity', async () => {
  let status = 503;
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return url.endsWith('/options') && status !== 200
        ? new Response('{}', { status })
        : Response.json(data(url));
    })
  );
  const { host, close } = await mount(CustomerTicketsPage);
  try {
    await act(async () => button(host, 'Create ticket').click());
    await change(host, '#ticket-subject', 'Draft subject');
    await change(host, '#ticket-body', 'Draft body');
    const fileInput = host.querySelector('#ticket-files');
    const count = calls.length;
    status = 200;
    await act(async () => button(host, 'Retry').click());
    expect(calls.slice(count)).toEqual(['/api/tickets/options']);
    expect(host.querySelector<HTMLInputElement>('#ticket-subject')?.value).toBe('Draft subject');
    expect(host.querySelector<HTMLTextAreaElement>('#ticket-body')?.value).toBe('Draft body');
    expect(host.querySelector('#ticket-files')).toBe(fileInput);
  } finally {
    await close();
  }
});
it('assignment resource failure recovers independently from ticket and reply draft', async () => {
  let status = 503;
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return url.endsWith('/teams') && status !== 200
        ? new Response('{}', { status })
        : Response.json(data(url));
    })
  );
  const { host, close } = await mount(StaffTicketsPage);
  try {
    await act(async () => button(host, supportTicket.subject).click());
    await change(host, '#ticket-reply', 'Reply draft');
    expect(host.querySelector<HTMLSelectElement>('#ticket-team')?.matches(':disabled')).toBe(true);
    const count = calls.length;
    status = 200;
    await act(async () => button(host, 'Retry').click());
    expect(calls.slice(count)).toEqual([
      '/api/staff/tickets/assignees',
      '/api/staff/tickets/teams',
    ]);
    expect(host.querySelector<HTMLTextAreaElement>('#ticket-reply')?.value).toBe('Reply draft');
    expect(host.querySelector<HTMLSelectElement>('#ticket-team')?.matches(':disabled')).toBe(false);
    expect(host.textContent).toContain('Private staff reasoning');
  } finally {
    await close();
  }
});
it('a malformed queue refresh retains accepted rows, while a changed filter cannot show older rows', async () => {
  let malformed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(url.includes('?') && malformed ? { data: null } : data(url))
    )
  );
  const { host, close } = await mount(CustomerTicketsPage);
  try {
    malformed = true;
    await act(async () => button(host, 'Refresh tickets').click());
    expect(host.querySelector('[data-slot="ticket-queue-records"]')?.textContent).toContain(
      supportTicket.subject
    );
    await change(host, '#ticket-filter', 'resolved');
    expect(host.querySelector('[data-slot="ticket-queue-records"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  } finally {
    await close();
  }
});
it('active-profile deep links still load their selected ticket when the queue is empty', async () => {
  search.value = { scope: 'active', ticketId: supportTicket.id };
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return Response.json(url.includes('?') ? { data: [], totalPages: 1 } : data(url));
    })
  );
  const { host, close } = await mount(CustomerTicketsPage);
  try {
    expect(host.querySelector('h2')?.textContent).toBe(supportTicket.subject);
    expect(host.textContent).toContain('No tickets');
    expect(
      new URL(
        calls.find((url) => url.includes('?'))!,
        'https://local'
      ).searchParams.get('scope')
    ).toBe('active');
  } finally {
    await close();
  }
});

it('queue recovery preserves the mounted closure review, confirmation and password; denial removes them', async () => {
  let status = 200;
  let previewReads = 0;
  const closureTicket = { ...supportTicket, privacyRequestType: 'closure' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/closure-preview')) {
        previewReads++;
        return Response.json({
          eligible: true,
          blockers: [],
          retained: {},
          previewVersion: 'current',
          anonymizeProfile: false,
          completedAt: null,
          exportTicketId: null,
        });
      }
      if (url.includes('?'))
        return status === 200
          ? Response.json({
              ...supportQueue,
              data: [closureTicket],
              viewer: { ...supportQueue.viewer, canApproveClosure: true },
            })
          : new Response('{}', { status });
      return Response.json(url.endsWith(supportTicket.id) ? closureTicket : data(url));
    })
  );
  const { host, close } = await mount(StaffTicketsPage);
  try {
    await act(async () => button(host, supportTicket.subject).click());
    await change(host, '#closure-password', 'Local draft password');
    const password = host.querySelector<HTMLInputElement>('#closure-password')!;
    const confirmation = password
      .closest('section')!
      .querySelector<HTMLInputElement>('input[type=checkbox]')!;
    await act(async () => confirmation.click());
    status = 503;
    await act(async () => button(host, 'Refresh tickets').click());
    status = 200;
    await act(async () => button(host, 'Retry').click());
    expect(host.querySelector('#closure-password')).toBe(password);
    expect(password.value).toBe('Local draft password');
    expect(confirmation.checked).toBe(true);
    expect(previewReads).toBe(1);
    status = 403;
    await act(async () => button(host, 'Refresh tickets').click());
    expect(host.querySelector('#closure-password')).toBeNull();
    expect(host.querySelector('article')).toBeNull();
  } finally {
    await close();
  }
});

it('detail permission denial hides its work and offers no retry while the authorized queue stays visible', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith(supportTicket.id)
        ? new Response('{}', { status: 403 })
        : Response.json(data(url))
    )
  );
  const { host, close } = await mount(CustomerTicketsPage);
  try {
    await act(async () => button(host, supportTicket.subject).click());
    expect(host.querySelector('article')).toBeNull();
    expect(host.querySelector('[data-slot="ticket-queue-records"]')?.textContent).toContain(
      supportTicket.subject
    );
    expect(host.querySelector('[role="alert"] button')).toBeNull();
    expect(host.textContent).toContain('no longer have permission');
  } finally {
    await close();
  }
});

it('creation remains unavailable after queue permission denial until a successful authority read', async () => {
  let status = 403;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('?') && status !== 200
        ? new Response('{}', { status })
        : Response.json(data(url))
    )
  );
  const { host, close } = await mount(CustomerTicketsPage);
  try {
    expect(button(host, 'Create ticket').disabled).toBe(true);
    status = 503;
    await act(async () => button(host, 'Refresh tickets').click());
    expect(button(host, 'Create ticket').disabled).toBe(true);
    status = 200;
    await act(async () => button(host, 'Retry').click());
    expect(button(host, 'Create ticket').disabled).toBe(false);
  } finally {
    await close();
  }
});

it('a shrinking queue returns to its last valid page instead of trapping navigation on an empty page', async () => {
  const pages: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const page = Number(new URL(url, 'https://local').searchParams.get('page'));
      pages.push(page);
      return Response.json(page === 2 ? { data: [], totalPages: 1 } : supportQueue);
    })
  );
  const { host, close } = await mount(CustomerTicketsPage);
  try {
    await act(async () => button(host, 'Next').click());
    expect(pages).toEqual([1, 2, 1]);
    expect(host.querySelector('[data-slot="ticket-queue-records"]')?.textContent).toContain(
      supportTicket.subject
    );
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('1');
  } finally {
    await close();
  }
});

it('staff status changes require a reason, keep it after failure, and clear it only after confirmed success', async () => {
  let responseStatus = 409;
  const writes: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method) {
        writes.push(JSON.parse(String(init.body)));
        return new Response('{}', { status: responseStatus });
      }
      return Response.json(data(url));
    })
  );
  const { host, close } = await mount(StaffTicketsPage);
  try {
    await act(async () => button(host, supportTicket.subject).click());
    expect(host.querySelector('[data-slot="ticket-detail"] header')?.textContent).toContain(
      supportTicket.createdAt
    );
    expect(host.querySelector('[data-slot="ticket-detail"] header')?.textContent).toContain('P2');
    expect(button(host, 'Save status').disabled).toBe(true);
    await change(host, '#ticket-status-reason', '   ');
    expect(button(host, 'Save status').disabled).toBe(true);
    await change(host, '#ticket-status-reason', '  Customer confirmed the solution  ');
    await change(host, '#ticket-next-status', 'resolved');
    await act(async () => button(host, 'Save status').click());
    expect(writes).toEqual([{ status: 'resolved', reason: 'Customer confirmed the solution' }]);
    expect(host.querySelector<HTMLTextAreaElement>('#ticket-status-reason')?.value).toBe(
      '  Customer confirmed the solution  '
    );
    responseStatus = 200;
    await act(async () => button(host, 'Save status').click());
    expect(writes).toHaveLength(2);
    expect(host.querySelector<HTMLTextAreaElement>('#ticket-status-reason')?.value).toBe('');
    expect(button(host, 'Save status').disabled).toBe(true);
  } finally {
    await close();
  }
});
