import { QueryComponentProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { tSolar } from '@barghsa/i18n/solar';
import { ErrorCodes } from '@barghsa/shared/errors';
import { AdminSolarPostalPage } from './AdminSolarPostalPage.js';
import {
  firstSolar,
  olderSolar,
  solarGuidance,
  solarPostal,
} from '../test/solar-staff-fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});
const invalid = (fields: unknown[]) =>
  Response.json(
    {
      error: {
        code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
        fields,
        message: 'Private rejected payload',
      },
    },
    { status: 400 }
  );
const review = (decision: string, reason: string | null = null) => ({
  hash: 'a'.repeat(64),
  data: {
    requestId: firstSolar,
    currentRequestStatus: 'waiting_for_postal_submission',
    currentPostalStatus: 'shipped',
    currentStatus: 'final_review',
    postalStatus: 'received',
    courier: 'Post',
    trackingNumber: 'TRACK-1',
    sendDate: '2026-09-23',
    receiptImageId: null,
    reason,
    postalOutcome: decision,
    requestOutcome: 'waiting_for_postal_submission',
    outcome: decision === 'approve' ? 'approved' : 'rejected',
  },
});
function read(url: string, final = false) {
  if (url.endsWith('/settings/timezone')) return { timezone: 'UTC' };
  if (url.endsWith('/postal-guidance')) return solarGuidance;
  return {
    requests: [
      final
        ? { ...solarPostal(), request_status: 'final_review', postal_status: 'received' }
        : solarPostal(),
      solarPostal(olderSolar),
    ],
    nextBefore: null,
  };
}
function button(container: ParentNode, text: string) {
  const match = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === text
  );
  expect(match, text).toBeDefined();
  return match!;
}
async function mount(
  handler: (url: string, options?: RequestInit) => Promise<Response>,
  locale: 'en' | 'fa' = 'en'
) {
  document.documentElement.lang = locale;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(handler));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(<QueryComponentProvider>{<AdminSolarPostalPage />}</QueryComponentProvider>)
  );
  const change = async (id: string, value: string) =>
    act(async () => {
      const element = container.querySelector<HTMLTextAreaElement>(`#${id}`)!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        element,
        value
      );
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const click = async (text: string, owner: ParentNode = container) =>
    act(async () => button(owner, text).click());
  const select = async () =>
    act(async () =>
      [...container.querySelectorAll('button')]
        .find((item) => item.textContent?.includes('First solar buyer'))!
        .click()
    );
  const submit = async () =>
    act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
  return {
    container,
    change,
    click,
    select,
    submit,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
const dialog = async () =>
  vi.waitFor(() => expect(document.querySelector('[role=dialog]')).not.toBeNull());

it.each(['en', 'fa'] as const)(
  'reports paired guidance errors with owned focus and stable accessible message space (%s)',
  async (locale) => {
    let writes = 0;
    const view = await mount(async (url, options) => {
      if (options?.method) writes++;
      return Response.json(read(url));
    }, locale);
    try {
      await view.change('solar-postal-guidance-originals-fa', 'One\nTwo');
      await view.change('solar-postal-guidance-originals-en', 'One');
      await view.submit();
      await vi.waitFor(() =>
        expect(view.container.querySelectorAll('[aria-invalid=true]')).toHaveLength(2)
      );
      await vi.waitFor(() =>
        expect(document.activeElement?.id).toBe('solar-postal-guidance-originals-fa')
      );
      expect(writes).toBe(0);
      const form = view.container.querySelector('form')!;
      expect(form.getAttribute('role')).toBeNull();
      expect(form.parentElement?.tagName).toBe('DIV');
      expect(form.parentElement?.getAttribute('role')).toBe('group');
      expect(form.parentElement?.getAttribute('aria-label')).toBe(tSolar('postalGuidance', locale));
      for (const id of [
        'solar-postal-guidance-originals-fa',
        'solar-postal-guidance-originals-en',
      ]) {
        const field = view.container.querySelector(`#${id}`)!;
        expect(view.container.querySelector(`label[for="${id}"]`)).not.toBeNull();
        expect(field.getAttribute('aria-describedby')).toContain(`${id}-message`);
        const message = view.container.querySelector(`#${id}-message`)!;
        const reserved = message.parentElement?.querySelector('[aria-hidden=true]');
        expect(reserved?.textContent).toBe(message.textContent);
        expect(reserved?.classList.contains('invisible')).toBe(true);
        expect(reserved?.classList.contains('col-start-1')).toBe(true);
        expect(message.classList.contains('col-start-1')).toBe(true);
      }
    } finally {
      await view.close();
    }
  }
);

it('verifies the normalized guidance receipt without clearing the selected reason or rereading queues', async () => {
  const writes: unknown[] = [],
    reads: string[] = [];
  const view = await mount(async (url, options) => {
    if (options?.method === 'PUT') {
      const body = JSON.parse(String(options.body));
      writes.push(body);
      return Response.json(body);
    }
    reads.push(url);
    return Response.json(read(url));
  });
  try {
    await view.select();
    await view.change('solar-postal-reason', 'Keep review reason');
    const count = reads.length;
    await view.change('solar-postal-guidance-fa', ' راهنما ');
    await view.change('solar-postal-guidance-en', ' Updated guidance ');
    await view.change('solar-postal-guidance-destination-address', ' New address ');
    await view.change('solar-postal-guidance-contact-details', ' New contact ');
    await view.change('solar-postal-guidance-originals-fa', ' اصل اول \n اصل دوم ');
    await view.change('solar-postal-guidance-originals-en', ' First original \n Second original ');
    await view.submit();
    await dialog();
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
    expect(writes).toEqual([
      {
        fa: 'راهنما',
        en: 'Updated guidance',
        destinationAddress: 'New address',
        contactDetails: 'New contact',
        originals: [
          { fa: 'اصل اول', en: 'First original' },
          { fa: 'اصل دوم', en: 'Second original' },
        ],
      },
    ]);
    expect(reads).toHaveLength(count);
    expect(view.container.querySelector<HTMLTextAreaElement>('#solar-postal-reason')?.value).toBe(
      'Keep review reason'
    );
    expect(
      view.container.querySelector<HTMLTextAreaElement>('#solar-postal-guidance-en')?.value
    ).toBe('Updated guidance');
  } finally {
    await view.close();
  }
});

it('focuses only safe server-owned guidance fields after closing confirmation and keeps mixed private errors generic', async () => {
  let fields: unknown[] = ['originalsEn'];
  const view = await mount(async (url, options) =>
    options?.method === 'PUT' ? invalid(fields) : Response.json(read(url))
  );
  try {
    await view.change('solar-postal-guidance-originals-fa', 'اصل');
    await view.change('solar-postal-guidance-originals-en', 'Original');
    await view.submit();
    await dialog();
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
    await vi.waitFor(() =>
      expect(document.activeElement?.id).toBe('solar-postal-guidance-originals-en')
    );
    expect(
      view.container.querySelector<HTMLTextAreaElement>('#solar-postal-guidance-originals-en')
        ?.value
    ).toBe('Original');
    fields = ['en', 'private_revision'];
    await view.change('solar-postal-guidance-originals-en', 'Corrected original');
    await view.submit();
    await dialog();
    await view.click('Confirm', document);
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    expect(
      view.container.querySelector('#solar-postal-guidance-en')?.getAttribute('aria-invalid')
    ).not.toBe('true');
    expect(document.body.textContent).not.toContain('private_revision');
    expect(document.body.textContent).not.toContain('Private rejected payload');
  } finally {
    await view.close();
  }
});

it('does not restore a denied guidance write grant from a successful guidance read and preserves independent reason', async () => {
  let writes = 0,
    reads = 0;
  const view = await mount(async (url, options) => {
    if (options?.method === 'PUT') {
      writes++;
      return new Response('{}', { status: 403 });
    }
    if (url.endsWith('/postal-guidance')) reads++;
    return Response.json(read(url));
  });
  try {
    await view.select();
    await view.change('solar-postal-reason', 'Independent reason');
    await view.change('solar-postal-guidance-en', 'Denied guidance draft');
    await view.submit();
    await dialog();
    await view.click('Confirm', document);
    expect(button(document, 'Confirm').disabled).toBe(true);
    await view.click('Cancel', document);
    await view.click(tSolar('postalGuidanceReload', 'en'));
    expect(reads).toBe(2);
    expect(button(view.container, tSolar('postalSaveGuidance', 'en')).disabled).toBe(true);
    expect(
      view.container.querySelector<HTMLTextAreaElement>('#solar-postal-guidance-en')?.value
    ).toBe('Denied guidance draft');
    expect(view.container.querySelector<HTMLTextAreaElement>('#solar-postal-reason')?.value).toBe(
      'Independent reason'
    );
    expect(
      view.container.querySelector<HTMLTextAreaElement>('#solar-postal-reason')?.disabled
    ).toBe(false);
    await view.submit();
    expect(writes).toBe(1);
  } finally {
    await view.close();
  }
});

it('retains guidance and reason drafts after an unconfirmed receipt until a fresh successful guidance reload', async () => {
  let writes = 0,
    reads = 0,
    failedRead = true;
  const view = await mount(async (url, options) => {
    if (options?.method === 'PUT') {
      writes++;
      return Response.json({
        ...JSON.parse(String(options.body)),
        contactDetails: 'Mismatched contact',
      });
    }
    if (url.endsWith('/postal-guidance') && ++reads > 1 && failedRead)
      return new Response('{}', { status: 503 });
    return Response.json(read(url));
  });
  try {
    await view.select();
    await view.change('solar-postal-reason', 'Keep reason');
    await view.change('solar-postal-guidance-en', 'Unconfirmed draft');
    await view.submit();
    await dialog();
    await view.click('Confirm', document);
    expect(button(document, 'Confirm').disabled).toBe(true);
    await view.click('Cancel', document);
    await view.submit();
    expect(writes).toBe(1);
    await view.click(tSolar('postalGuidanceReload', 'en'));
    expect(button(view.container, tSolar('postalSaveGuidance', 'en')).disabled).toBe(true);
    failedRead = false;
    await view.click(tSolar('postalGuidanceReload', 'en'));
    await vi.waitFor(() =>
      expect(button(view.container, tSolar('postalSaveGuidance', 'en')).disabled).toBe(false)
    );
    expect(
      view.container.querySelector<HTMLTextAreaElement>('#solar-postal-guidance-en')?.value
    ).toBe('Unconfirmed draft');
    expect(view.container.querySelector<HTMLTextAreaElement>('#solar-postal-reason')?.value).toBe(
      'Keep reason'
    );
  } finally {
    await view.close();
  }
});

it('validates issue reasons before preview and preserves captured hash and drafts after a failed confirmation', async () => {
  const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
  const view = await mount(async (url, options) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(String(options.body));
      writes.push({ url, body });
      return url.endsWith('/review')
        ? Response.json(review(body.decision, body.reason))
        : invalid(['reason']);
    }
    return Response.json(read(url));
  });
  try {
    await view.select();
    await view.change('solar-postal-reason', 'x'.repeat(1001));
    await view.click(tSolar('postal_mark-incomplete', 'en'));
    await vi.waitFor(() =>
      expect(view.container.querySelector('#solar-postal-reason-message')?.textContent).toBe(
        tSolar('postalReasonInvalid', 'en')
      )
    );
    expect(writes).toEqual([]);
    await view.change('solar-postal-reason', 'x'.repeat(1000));
    await view.change('solar-postal-guidance-en', 'Independent guidance');
    await view.click(tSolar('postal_mark-incomplete', 'en'));
    await dialog();
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('solar-postal-reason'));
    expect(writes[0]?.body).toEqual({ decision: 'incomplete', reason: 'x'.repeat(1000) });
    expect(writes[1]?.body).toEqual({
      reason: 'x'.repeat(1000),
      expectedReviewHash: 'a'.repeat(64),
    });
    expect(
      view.container.querySelector<HTMLTextAreaElement>('#solar-postal-reason')?.value
    ).toHaveLength(1000);
    expect(
      view.container.querySelector<HTMLTextAreaElement>('#solar-postal-guidance-en')?.value
    ).toBe('Independent guidance');
  } finally {
    await view.close();
  }
});

it.each(['received', 'approve'] as const)(
  '%s bypasses an irrelevant invalid reason and retains it after an uncertain write',
  async (decision) => {
    const writes: Array<Record<string, unknown>> = [];
    const view = await mount(async (url, options) => {
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        writes.push(body);
        return url.endsWith('/review')
          ? Response.json(review(body.decision))
          : new Response('{}', { status: 503 });
      }
      return Response.json(read(url, decision === 'approve'));
    });
    try {
      await view.select();
      await view.change('solar-postal-reason', 'x'.repeat(1001));
      await view.click(
        tSolar(decision === 'received' ? 'postal_confirm-received' : 'solarFinalApprove', 'en')
      );
      await dialog();
      await view.click('Confirm', document);
      expect(writes[0]).toEqual({ decision });
      expect(writes[1]).toEqual({ expectedReviewHash: 'a'.repeat(64) });
      expect(
        view.container.querySelector<HTMLTextAreaElement>('#solar-postal-reason')?.value
      ).toHaveLength(1001);
      expect(button(document, 'Confirm').disabled).toBe(true);
    } finally {
      await view.close();
    }
  }
);
