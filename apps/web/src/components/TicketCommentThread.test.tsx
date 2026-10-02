import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@barghsa/i18n/app';
import { TicketCommentThread, type TicketComment } from './TicketCommentThread.js';

let root: Root, host: HTMLDivElement;
const comments: TicketComment[] = [
  {
    id: 'customer',
    authorId: 'owner',
    visibility: 'public',
    body: '<script>Customer question</script>',
    createdAt: '2026-09-01T01:00:00Z',
  },
  {
    id: 'staff',
    authorId: 'agent',
    visibility: 'public',
    body: 'Support reply',
    createdAt: '2026-09-01T02:00:00Z',
  },
  {
    id: 'internal',
    authorId: 'agent',
    visibility: 'internal',
    body: 'Private reasoning',
    createdAt: '2026-09-01T03:00:00Z',
  },
  {
    id: 'unknown',
    authorId: 'agent',
    visibility: 'unknown',
    body: 'Unknown visibility',
    createdAt: '2026-09-01T04:00:00Z',
  },
];
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
async function render(staff: boolean, locale: 'en' | 'fa', rows = comments, ownerId = 'owner') {
  await act(async () =>
    root.render(
      <TicketCommentThread
        comments={rows}
        staff={staff}
        locale={locale}
        ownerId={ownerId}
        customerName="Profile title"
        assignees={[{ id: 'agent', name: 'agent-login@example.test' }]}
        formatDate={(value) => `Account time: ${value}`}
      />
    )
  );
}
for (const locale of ['en', 'fa'] as const) {
  it(`${locale}: customer threads exclude internal/unknown messages and private staff directory names`, async () => {
    await render(false, locale);
    expect(host.querySelectorAll('li')).toHaveLength(2);
    expect(host.textContent).not.toContain('Private reasoning');
    expect(host.textContent).not.toContain('Unknown visibility');
    expect(host.textContent).not.toContain('agent-login@example.test');
    expect(host.textContent).not.toContain('Profile title');
    expect(host.textContent).toContain(t('tickets.customerAuthor', locale));
    expect(host.textContent).toContain(t('tickets.staffAuthor', locale));
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('<script>Customer question</script>');
    expect(host.querySelector('ol')?.getAttribute('dir')).toBe(locale === 'fa' ? 'rtl' : 'ltr');
  });
  it(`${locale}: staff threads keep distinct customer/support/internal appearance, names and exact timestamps`, async () => {
    await render(true, locale);
    const rows = host.querySelectorAll('li');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.className).toContain('bg-card');
    expect(rows[0]?.textContent).toContain('Profile title');
    expect(rows[1]?.className).toContain('border-primary/40');
    expect(rows[1]?.textContent).toContain('agent-login@example.test');
    expect(rows[2]?.className).toContain('bg-warning-soft');
    expect(rows[2]?.textContent).toContain(t('tickets.internalBadge', locale));
    expect(Array.from(host.querySelectorAll('time'), (node) => node.dateTime)).toEqual(
      comments.slice(0, 3).map((item) => item.createdAt)
    );
    expect(host.querySelectorAll('[data-slot=avatar][aria-hidden=true]')).toHaveLength(3);
    expect(host.textContent).toContain(`Account time: ${comments[2]!.createdAt}`);
  });
}
it('uses role fallback when an author is no longer in the current staff directory', async () => {
  await render(true, 'en', [{ ...comments[1]!, authorId: 'former-agent' }]);
  expect(host.textContent).toContain('Support staff');
  expect(host.textContent).not.toContain('former-agent');
});
it('keeps an internal note distinguishable when the author owns the ticket in customer context', async () => {
  await render(true, 'en', [comments[2]!], 'agent');
  expect(host.textContent).toContain('INTERNAL');
  expect(host.textContent).not.toContain('Profile title');
  await render(false, 'en', [comments[2]!], 'agent');
  expect(host.querySelector('li')).toBeNull();
  expect(host.textContent).toContain('No messages yet.');
});

it('renders explicit markdown safely, preserves plain text, uses stored author context and hides internal file URLs', async () => {
  await render(false, 'en', [
    {
      ...comments[0]!,
      authorContext: 'staff',
      bodyFormat: 'markdown',
      body: '**Answer** <script>alert(1)</script> [bad](javascript:alert(1)) ![remote](https://track.example.test/pixel)',
      attachments: [
        {
          key: 'image',
          fileName: 'evidence.png',
          contentType: 'image/png',
          url: 'https://storage.example.test/image',
        },
      ],
    },
    {
      ...comments[2]!,
      attachments: [
        {
          key: 'private',
          fileName: 'private.pdf',
          contentType: 'application/pdf',
          url: 'https://storage.example.test/private',
        },
      ],
    },
    { ...comments[1]!, body: '**literal**' },
  ]);
  expect(host.querySelector('strong')?.textContent).toBe('Answer');
  expect(host.querySelector('script')).toBeNull();
  expect(host.querySelector('[href^="javascript:"]')).toBeNull();
  expect(host.innerHTML).not.toContain('src="https://track');
  expect(host.textContent).toContain('**literal**');
  expect(host.innerHTML).not.toContain('storage.example.test/private');
  expect(host.querySelector('img')?.getAttribute('src')).toBe('https://storage.example.test/image');
  expect(host.querySelector('[data-slot="ticket-comment"]')?.className).toContain(
    'border-primary/40'
  );
});

it('shows unavailable reply files without claiming an empty conversation attachment list', async () => {
  await render(false, 'fa', [{ ...comments[0]!, attachmentCount: 1, attachments: [] }]);
  expect(host.querySelector('[role="status"]')?.textContent).toBe(
    t('tickets.filesUnavailable', 'fa')
  );
});

for (const locale of ['en', 'fa'] as const) {
  it(`${locale}: chosen public aliases replace role initials while private identities remain excluded`, async () => {
    const rows = comments.map((item) => ({
      ...item,
      author: {
        displayName:
          item.visibility === 'internal' ? 'Private person' : '<script>Chosen alias</script>',
        avatarUrl:
          item.visibility === 'internal'
            ? 'https://private.example.test/photo'
            : 'https://storage.example.test/photo',
      },
    }));
    await render(false, locale, rows);
    expect(host.textContent).toContain('<script>Chosen alias</script>');
    expect(host.textContent).not.toContain('Private person');
    expect(host.innerHTML).not.toContain('private.example.test');
    expect(host.textContent).not.toContain('agent-login@example.test');
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain(t('tickets.customerAuthor', locale));
    expect(host.textContent).toContain(t('tickets.staffAuthor', locale));
  });
}
it('never loads an unsafe avatar URL and retains role fallback after identity removal', async () => {
  await render(
    false,
    'en',
    comments
      .slice(0, 2)
      .map((item) => ({ ...item, author: { displayName: null, avatarUrl: 'javascript:alert(1)' } }))
  );
  expect(host.innerHTML).not.toContain('javascript:');
  expect(host.textContent).toContain(t('tickets.customerAuthor', 'en'));
});
