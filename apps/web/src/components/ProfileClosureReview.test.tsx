import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProfileClosureReview } from './ProfileClosureReview.js';

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
