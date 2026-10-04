import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { tSolar } from '@barghsa/i18n/solar';
import { ErrorCodes } from '@barghsa/shared/errors';
import { AdminSolarDocumentsPage } from './AdminSolarDocumentsPage.js';
import {
  firstSolar,
  olderSolar,
  solarDocuments,
  solarFile,
  solarGuidance,
  solarRequest,
} from '../test/solar-staff-fixtures.js';

vi.mock('../components/DocumentDetail.js', () => ({
  DocumentDetail: ({ id }: { id: string }) => <div data-testid="preview">{id}</div>,
}));
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
        message: 'private rejected payload',
      },
    },
    { status: 400 }
  );
const setReview = (description: string | null = null) => ({
  hash: 'a'.repeat(64),
  data: {
    requestId: firstSolar,
    currentStatus: 'documents_under_review',
    documents: [],
    existingRequests: [],
    description,
    nextStatus: description ? 'changes_requested' : 'waiting_for_postal_submission',
  },
});
function read(url: string) {
  if (url.endsWith('/settings/timezone')) return { timezone: 'UTC' };
  if (url.endsWith('/document-guidance')) return solarGuidance;
  if (url.endsWith('/documents'))
    return solarDocuments(url.includes(olderSolar) ? olderSolar : firstSolar);
  if (url.includes('/document-review-queue')) return { documents: [solarFile()], nextBefore: null };
  return { requests: [solarRequest(), solarRequest(olderSolar)], nextBefore: null };
}
function button(container: ParentNode, text: string) {
  const match = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === text
  );
  expect(match, text).toBeDefined();
  return match!;
}
function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set?.call(
    element,
    value
  );
  element.dispatchEvent(new Event('input', { bubbles: true }));
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
  await act(async () => root.render(<AdminSolarDocumentsPage />));
  const change = async (id: string, text: string) =>
    act(async () =>
      fill(container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!, text)
    );
  const click = async (text: string, owner: ParentNode = container) =>
    act(async () => button(owner, text).click());
  const submitGuidance = async () =>
    act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
  return {
    container,
    change,
    click,
    submitGuidance,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
async function waitForDialog() {
  await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).not.toBeNull());
}

it('validates rejection and additional-document intents independently and uses the current description message after a server rejection', async () => {
  const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
  let previews = 0;
  const view = await mount(async (url, options) => {
    if (options?.method === 'POST') {
      const body = JSON.parse(String(options.body));
      writes.push({ url, body });
      if (url.endsWith('/review-set-decision')) {
        if (++previews === 1) return invalid(['description']);
        return Response.json(setReview(body.description));
      }
      return invalid(['description']);
    }
    return Response.json(read(url));
  });
  try {
    await act(async () =>
      [...view.container.querySelectorAll('button')]
        .find((item) => item.textContent?.includes('First solar buyer'))!
        .click()
    );
    await view.change('solar-review-reason', 'x'.repeat(1500));
    await view.click(tSolar('reject', 'en'));
    await vi.waitFor(() =>
      expect(view.container.querySelector('#solar-review-reason-message')?.textContent).toBe(
        tSolar('documentReasonInvalid', 'en')
      )
    );
    expect(writes).toEqual([]);
    await act(async () => {
      await vi.waitFor(() => expect(document.activeElement?.id).toBe('solar-review-reason'));
    });
    await view.click(tSolar('requestAdditional', 'en'));
    await vi.waitFor(() =>
      expect(view.container.querySelector('#solar-review-reason-message')?.textContent).toBe(
        tSolar('documentDescriptionInvalid', 'en')
      )
    );
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(view.container.querySelector('#solar-review-reason-message')?.textContent).not.toBe(
      tSolar('documentReasonInvalid', 'en')
    );
    await view.click(tSolar('requestAdditional', 'en'));
    await waitForDialog();
    expect(writes).toHaveLength(2);
    expect(writes[0]?.body).toEqual({
      decision: 'request_additional',
      description: 'x'.repeat(1500),
    });
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
    expect(writes[2]?.body).toEqual({
      description: 'x'.repeat(1500),
      expectedReviewHash: 'a'.repeat(64),
    });
    expect(view.container.querySelector('#solar-review-reason-message')?.textContent).toBe(
      tSolar('documentDescriptionInvalid', 'en')
    );
    expect(view.container.querySelector('#solar-review-reason-message')?.textContent).not.toBe(
      tSolar('documentReasonInvalid', 'en')
    );
    expect(
      view.container.querySelector<HTMLInputElement>('#solar-review-reason')?.value
    ).toHaveLength(1500);
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('solar-review-reason'));
    expect(view.container.textContent).not.toContain('private rejected payload');
  } finally {
    await view.close();
  }
});

it.each(['en', 'fa'] as const)(
  'reports all guidance errors with associated labels, help and focused owned fields (%s)',
  async (locale) => {
    const writes: string[] = [];
    const view = await mount(async (url, options) => {
      if (options?.method) writes.push(url);
      return Response.json(read(url));
    }, locale);
    try {
      await view.change('solar-guidance-fa', ' ');
      await view.change('solar-guidance-en', 'x'.repeat(4001));
      await view.change('solar-guidance-fa-suggestions', 'One\nTwo');
      await view.change('solar-guidance-en-suggestions', 'One');
      await view.submitGuidance();
      await vi.waitFor(() =>
        expect(view.container.querySelectorAll('[aria-invalid=true]')).toHaveLength(4)
      );
      expect(writes).toEqual([]);
      expect(document.querySelector('[role=dialog]')).toBeNull();
      const guidance = view.container.querySelector('form')!;
      expect(guidance.getAttribute('role')).toBeNull();
      expect(guidance.parentElement?.tagName).toBe('DIV');
      expect(guidance.parentElement?.getAttribute('role')).toBe('group');
      expect(guidance.parentElement?.getAttribute('aria-label')).toBe(
        tSolar('documentGuidance', locale)
      );
      for (const id of [
        'solar-guidance-fa',
        'solar-guidance-en',
        'solar-guidance-fa-suggestions',
        'solar-guidance-en-suggestions',
      ]) {
        const field = view.container.querySelector(`#${id}`)!;
        expect(view.container.querySelector(`label[for="${id}"]`)).not.toBeNull();
        expect(field.getAttribute('aria-describedby')).toContain(`${id}-description`);
        expect(field.getAttribute('aria-describedby')).toContain(`${id}-message`);
        const message = view.container.querySelector(`#${id}-message`)!;
        const reserved = message.parentElement?.querySelector('[aria-hidden=true]');
        expect(reserved?.textContent).toBe(message.textContent);
        expect(reserved?.classList.contains('invisible')).toBe(true);
        expect(reserved?.classList.contains('col-start-1')).toBe(true);
        expect(message.classList.contains('col-start-1')).toBe(true);
      }
      await vi.waitFor(() => expect(document.activeElement?.id).toBe('solar-guidance-fa'));
      expect(view.container.textContent).toContain(tSolar('documentSuggestionsInvalid', locale));
    } finally {
      await view.close();
    }
  }
);

it('successful guidance save verifies the normalized receipt and preserves selected document drafts and preview without queue reloads', async () => {
  const writes: unknown[] = [];
  const reads: string[] = [];
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
    await act(async () =>
      [...view.container.querySelectorAll('button')]
        .find((item) => item.textContent?.includes('First solar buyer'))!
        .click()
    );
    await view.change('solar-review-reason', 'Keep this review note');
    await view.click(tSolar('preview', 'en'));
    const count = reads.length;
    await view.change('solar-guidance-fa', ' راهنمای جدید ');
    await view.change('solar-guidance-en', ' Updated guidance ');
    await view.change('solar-guidance-fa-suggestions', ' سند اول \n\n سند دوم ');
    await view.change('solar-guidance-en-suggestions', ' First file \n Second file ');
    await view.submitGuidance();
    await waitForDialog();
    expect(view.container.querySelector<HTMLInputElement>('#solar-review-reason')?.disabled).toBe(
      true
    );
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
    expect(writes).toEqual([
      {
        fa: 'راهنمای جدید',
        en: 'Updated guidance',
        suggestions: [
          { fa: 'سند اول', en: 'First file' },
          { fa: 'سند دوم', en: 'Second file' },
        ],
      },
    ]);
    expect(reads).toHaveLength(count);
    expect(view.container.querySelector<HTMLInputElement>('#solar-review-reason')?.value).toBe(
      'Keep this review note'
    );
    expect(view.container.querySelector('[data-testid=preview]')).not.toBeNull();
    expect(view.container.querySelector<HTMLTextAreaElement>('#solar-guidance-en')?.value).toBe(
      'Updated guidance'
    );
  } finally {
    await view.close();
  }
});

it('maps only owned guidance field identifiers and focuses the translated list after the dialog closes', async () => {
  let fields: unknown[] = ['suggestionsEn'];
  const view = await mount(async (url, options) =>
    options?.method === 'PUT' ? invalid(fields) : Response.json(read(url))
  );
  try {
    await view.change('solar-guidance-fa-suggestions', 'سند');
    await view.change('solar-guidance-en-suggestions', 'File');
    await view.submitGuidance();
    await waitForDialog();
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
    await vi.waitFor(() =>
      expect(document.activeElement?.id).toBe('solar-guidance-en-suggestions')
    );
    expect(
      view.container.querySelector<HTMLTextAreaElement>('#solar-guidance-en-suggestions')?.value
    ).toBe('File');
    expect(view.container.textContent).toContain(tSolar('documentSuggestionsInvalid', 'en'));
    await view.change('solar-guidance-en-suggestions', 'Corrected file');
    fields = ['en', 'secret_revision'];
    await view.submitGuidance();
    await waitForDialog();
    await view.click('Confirm', document);
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('secret_revision');
    expect(document.body.textContent).not.toContain('private rejected payload');
    expect(
      view.container.querySelector('#solar-guidance-en')?.getAttribute('aria-invalid')
    ).not.toBe('true');
  } finally {
    await view.close();
  }
});

it('blocks an unconfirmed guidance replay until a trusted reload, retaining its dirty draft and document note', async () => {
  let reads = 0,
    writes = 0,
    failedRead = true;
  const view = await mount(async (url, options) => {
    if (options?.method === 'PUT') {
      writes++;
      return Response.json({ ...JSON.parse(String(options.body)), en: 'different receipt' });
    }
    if (url.endsWith('/document-guidance')) {
      reads++;
      if (reads > 1 && failedRead) return new Response('', { status: 503 });
    }
    return Response.json(read(url));
  });
  try {
    await act(async () =>
      [...view.container.querySelectorAll('button')]
        .find((item) => item.textContent?.includes('First solar buyer'))!
        .click()
    );
    await view.change('solar-review-reason', 'Document note');
    await view.change('solar-guidance-en', 'Unsaved guidance draft');
    await view.submitGuidance();
    await waitForDialog();
    await view.click('Confirm', document);
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
    expect(button(document, 'Confirm').disabled).toBe(true);
    await view.click('Cancel', document);
    expect(button(view.container, tSolar('saveGuidance', 'en')).disabled).toBe(true);
    await view.submitGuidance();
    expect(writes).toBe(1);
    await view.click(tSolar('documentGuidanceReload', 'en'));
    expect(button(view.container, tSolar('saveGuidance', 'en')).disabled).toBe(true);
    failedRead = false;
    await view.click(tSolar('documentGuidanceReload', 'en'));
    await vi.waitFor(() =>
      expect(button(view.container, tSolar('saveGuidance', 'en')).disabled).toBe(false)
    );
    expect(view.container.querySelector<HTMLTextAreaElement>('#solar-guidance-en')?.value).toBe(
      'Unsaved guidance draft'
    );
    expect(view.container.querySelector<HTMLInputElement>('#solar-review-reason')?.value).toBe(
      'Document note'
    );
    expect(writes).toBe(1);
  } finally {
    await view.close();
  }
});

it('locks actual pending commands and prevents duplicate form submissions or switching selected documents', async () => {
  let finish: ((response: Response) => void) | undefined;
  let writes = 0;
  const view = await mount(async (url, options) => {
    if (options?.method === 'PUT') {
      writes++;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    return Response.json(read(url));
  });
  try {
    await act(async () =>
      [...view.container.querySelectorAll('button')]
        .find((item) => item.textContent?.includes('First solar buyer'))!
        .click()
    );
    await view.change('solar-review-reason', 'Keep selection');
    await view.submitGuidance();
    await waitForDialog();
    await view.click('Confirm', document);
    expect(finish).toBeDefined();
    const older = [...view.container.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
      item.textContent?.includes('Older solar buyer')
    )!;
    expect(older.disabled).toBe(true);
    await act(async () => older.click());
    await view.submitGuidance();
    expect(writes).toBe(1);
    expect(view.container.querySelector<HTMLInputElement>('#solar-review-reason')?.value).toBe(
      'Keep selection'
    );
    await act(async () =>
      finish!(Response.json({ fa: solarGuidance.fa, en: solarGuidance.en, suggestions: [] }))
    );
    await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
    expect(older.disabled).toBe(false);
  } finally {
    await view.close();
  }
});

it.each(['approve', 'advance'] as const)(
  '%s does not validate unrelated review text and a failed command retains the document draft',
  async (decision) => {
    const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
    const view = await mount(async (url, options) => {
      if (options?.method === 'POST') {
        writes.push({ url, body: JSON.parse(String(options.body)) });
        if (url.endsWith('/review-set-decision')) return Response.json(setReview());
        return new Response('', { status: 503 });
      }
      return Response.json(read(url));
    });
    try {
      await act(async () =>
        [...view.container.querySelectorAll('button')]
          .find((item) => item.textContent?.includes('First solar buyer'))!
          .click()
      );
      await view.change('solar-review-reason', 'x'.repeat(2001));
      await view.change('solar-guidance-en', 'Independent guidance draft');
      await view.click(tSolar(decision === 'approve' ? 'approve' : 'advancePostal', 'en'));
      await waitForDialog();
      await view.click('Confirm', document);
      expect(document.querySelector('[role=dialog]')).not.toBeNull();
      expect(writes.at(-1)?.body).toEqual(
        decision === 'approve' ? { expectedRevision: 1 } : { expectedReviewHash: 'a'.repeat(64) }
      );
      expect(
        view.container.querySelector<HTMLInputElement>('#solar-review-reason')?.value
      ).toHaveLength(2001);
      expect(view.container.querySelector<HTMLTextAreaElement>('#solar-guidance-en')?.value).toBe(
        'Independent guidance draft'
      );
    } finally {
      await view.close();
    }
  }
);
