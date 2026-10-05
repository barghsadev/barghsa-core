import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';
import { pdfPreviewImage, pdfPreviewFixture } from './upload-fixture';

const attachmentDigest = createHash('sha256').update(pdfPreviewFixture()).digest('hex');

const uuid = (n: number) => `88000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const profileId = uuid(1),
  otherProfileId = uuid(2),
  relatedId = uuid(3),
  ticketId = uuid(4),
  otherTicketId = uuid(5),
  teamId = uuid(6);
export const customerActor = 'ticket-customer:opaque',
  staffActor = 'ticket-staff:opaque',
  assigneeId = 'dispatch/account+opaque-id';
export const instant = '2026-09-21T09:00:45.678Z';
const changedInstant = '2026-09-21T09:03:45.678Z';
export type Family = 'create' | 'reply' | 'status' | 'assignment';
type Mode = 'success' | 'owned' | 'mixed' | 'hold' | 'rejected';
type Body = Record<string, unknown>;
export type Command = {
  family: Family;
  ticket: string | null;
  raw: string;
  body: Body;
  csrf: string | null;
};
interface Ticket {
  id: string;
  userId: string;
  subject: string;
  body: string;
  category: 'general' | 'billing' | 'orders' | 'privacy';
  priority: 'normal' | 'high';
  profileId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  status: 'open' | 'in_progress' | 'waiting_customer' | 'waiting_staff' | 'resolved' | 'closed';
  attachments: string[];
  assignedTeamId: string | null;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  privacyRequestType: 'closure' | null;
  privacyClosureCompletedAt: string | null;
  privacyClosureAnonymized: boolean | null;
  privacyClosureRetained: Record<string, number> | null;
  privacyClosureExportTicketId: string | null;
}
interface Comment {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  visibility: 'public' | 'internal';
  bodyFormat: 'markdown';
  authorContext: 'staff' | 'customer';
  author: { displayName: string | null; avatarUrl: string | null } | null;
  attachments: {
    key: string;
    fileName: string;
    contentType: string;
    url: string;
    fileIndex: number;
  }[];
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}
export const privateText = 'PRIVATE-NOTE-MUST-NOT-ENTER-CUSTOMER-DOM';
const initialTicket = (id: string, staff: boolean): Ticket => ({
  id,
  userId: customerActor,
  subject: id === ticketId ? 'Ticket form journey' : 'Other ticket source',
  body: 'Existing immutable question',
  category: staff ? 'privacy' : 'orders',
  priority: 'normal',
  profileId,
  relatedEntityType: null,
  relatedEntityId: null,
  status: staff ? 'open' : 'in_progress',
  attachments: [],
  assignedTeamId: null,
  assignedTo: staffActor,
  createdAt: instant,
  updatedAt: instant,
  privacyRequestType: staff && id === ticketId ? 'closure' : null,
  privacyClosureCompletedAt: null,
  privacyClosureAnonymized: null,
  privacyClosureRetained: null,
  privacyClosureExportTicketId: null,
});

export async function setupTicketForms(page: Page, locale: 'en' | 'fa', staff: boolean) {
  await setupCatalogueForms(page, locale, locale === 'fa');
  const prefix = staff ? '/api/staff/tickets' : '/api/tickets';
  const state = {
    actor: staff ? staffActor : customerActor,
    csrf: 'ticket-forms-initial',
    denied: false,
    queueDenied: false,
    readLog: [] as string[],
    writes: [] as Command[],
    modes: {
      create: 'success',
      reply: 'success',
      status: 'success',
      assignment: 'success',
    } as Record<Family, Mode>,
    held: undefined as { route: Route; command: Command } | undefined,
    effects: { create: 0, reply: 0, status: 0, assignment: 0 },
    uploadRequests: [] as Body[],
    uploadedNames: [] as string[],
    putPreconditions: [] as (string | null)[],
    verifiedKeys: [] as string[],
    recordRequests: [] as Body[],
    optionsMode: 'success' as 'success' | 'failed' | 'denied',
    heldOptions: undefined as Route | undefined,
    holdOptions: false,
    closureReads: 0,
    closureWrites: 0,
    stepUpWrites: 0,
    replyDetailsAvailable: false,
  };
  const tickets = new Map<string, Ticket>(
    staff
      ? [
          [ticketId, initialTicket(ticketId, true)],
          [otherTicketId, initialTicket(otherTicketId, true)],
        ]
      : [[otherTicketId, initialTicket(otherTicketId, false)]]
  );
  const comments = new Map<string, Comment[]>();
  const uploads = new Map<string, { fileName: string; contentType: string }>();
  const receipts = new Map<string, { raw: string; result: Ticket | Comment }>();
  await page
    .context()
    .addCookies([{ name: 'barghsa_csrf', value: state.csrf, url: 'http://127.0.0.1:4173' }]);
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: state.actor,
        isStaff: staff,
        operatingContext: staff ? 'staff' : 'customer',
        canSwitchContext: false,
        requiresTosAcceptance: false,
        navigation: fullNavigation(staff ? 'staff' : 'customer'),
      },
    })
  );
  await page.route('**/api/user/settings/theme', (route) =>
    route.fulfill({ json: { mode: locale === 'fa' ? 'dark' : 'light' } })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: profileId, type: 'INDIVIDUAL', title: 'Owned profile', isDefault: true }],
        activeProfileId: profileId,
      },
    })
  );
  await page.route('**/api/invitations/pending', (route) =>
    route.fulfill({ json: { invitations: [] } })
  );
  await page.route('**/api/profiles/ownership-transfers', (route) =>
    route.fulfill({ json: { transfers: [] } })
  );
  await page.route('**/api/v1/notifications**', (route) =>
    route.fulfill({ json: { data: [], unread_count: 0 } })
  );
  await page.route('**/api/auth/step-up', (route) => {
    state.stepUpWrites++;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/tickets/options**', async (route) => {
    state.readLog.push(route.request().url());
    if (state.holdOptions) {
      state.heldOptions = route;
      return;
    }
    if (state.optionsMode === 'denied')
      return route.fulfill({
        status: 403,
        json: {
          error: {
            code: ErrorCodes.AUTHZ_FORBIDDEN.code,
            message: 'Forbidden',
            correlationId: 'ticket-form-fixture',
          },
        },
      });
    if (state.optionsMode === 'failed') return route.fulfill({ status: 500, json: {} });
    const chosen = new URL(route.request().url()).searchParams.get('profileId');
    return route.fulfill({
      json: {
        profiles: [
          { id: profileId, title: 'Owned profile' },
          { id: otherProfileId, title: 'Second owned profile' },
        ],
        records:
          chosen === profileId ? [{ id: relatedId, type: 'contract', created_at: instant }] : [],
        hasMoreRecords: false,
      },
    });
  });
  await page.route('**/api/staff/tickets/assignees', (route) =>
    route.fulfill({
      json: [
        { id: staffActor, name: 'Current support actor' },
        { id: assigneeId, name: 'Dispatch operator' },
      ],
    })
  );
  await page.route('**/api/staff/tickets/teams', (route) =>
    route.fulfill({ json: [{ id: teamId, name: 'Dispatch team', members: [assigneeId] }] })
  );
  await page.route('**/api/upload/presigned-url', (route) => {
    const body = route.request().postDataJSON() as Body;
    state.uploadRequests.push(body);
    const key = `uploads/document/${uuid(30 + state.uploadRequests.length)}.pdf`;
    uploads.set(key, { fileName: String(body.fileName), contentType: String(body.contentType) });
    return route.fulfill({
      json: { key, presignedUrl: `/test-ticket-put/${encodeURIComponent(key)}` },
    });
  });
  await page.route('**/test-ticket-put/*', (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!);
    state.uploadedNames.push(uploads.get(key)!.fileName);
    state.putPreconditions.push(route.request().headers()['if-none-match'] ?? null);
    return route.fulfill({ status: 200, body: '' });
  });
  await page.route('**/api/upload/*/verify', (route) => {
    const path = new URL(route.request().url()).pathname;
    state.verifiedKeys.push(
      decodeURIComponent(path.slice('/api/upload/'.length, -'/verify'.length))
    );
    return route.fulfill({ json: { status: 'confirmed' } });
  });
  await page.route('**/api/upload/*/record', (route) => {
    state.recordRequests.push(route.request().postDataJSON() as Body);
    return route.fulfill({ status: 200, json: { status: 'recorded' } });
  });
  await page.route('**/api/upload/preview', (route) =>
    route.fulfill({ contentType: 'image/png', body: pdfPreviewImage })
  );
  await page.route('**/api/upload/formats**', (route) => route.fulfill({ json: { data: [] } }));

  const commit = (command: Command) => {
    const { family, body } = command;
    const key = `${family}:${command.ticket ?? 'new'}:${String(family === 'reply' ? body.submissionId : body.idempotencyKey)}`;
    const prior = receipts.get(key);
    if (prior) {
      if (prior.raw !== command.raw)
        throw new Error('Captured ticket command changed under its retry key');
      return structuredClone(prior.result);
    }
    let result: Ticket | Comment;
    let effect = true;
    if (family === 'create') {
      const files = body.attachments as string[];
      result = {
        ...initialTicket(ticketId, false),
        userId: state.actor,
        subject: String(body.subject),
        body: String(body.body),
        category: body.category as Ticket['category'],
        priority: body.priority as Ticket['priority'],
        profileId: body.profileId as string | null,
        relatedEntityType: (body.relatedEntityType as string) ?? null,
        relatedEntityId: (body.relatedEntityId as string) ?? null,
        attachments: files.map(
          (_key, index) => `ticket-attachments/${uuid(60 + index)}/${attachmentDigest}`
        ),
        // Automatic assignment legitimately returns in_progress at creation.
        status: 'in_progress',
        assignedTo: staffActor,
      };
      tickets.set(ticketId, structuredClone(result));
    } else if (family === 'reply') {
      const files = body.attachments as string[];
      const id = uuid(100 + state.effects.reply);
      result = {
        id,
        ticketId: command.ticket!,
        authorId: state.actor,
        body: String(body.body),
        visibility: body.visibility as Comment['visibility'],
        bodyFormat: 'markdown',
        authorContext: staff ? 'staff' : 'customer',
        author: {
          displayName: staff ? 'Shared support name' : 'Shared customer name',
          avatarUrl: null,
        },
        attachmentCount: files.length,
        attachments: state.replyDetailsAvailable
          ? files.flatMap((key, index) =>
              index === files.length - 1
                ? [
                    {
                      key: `ticket-reply-attachments/${uuid(130 + state.effects.reply * 5 + index)}/${attachmentDigest}`,
                      fileName: uploads.get(key)!.fileName,
                      contentType: uploads.get(key)!.contentType,
                      url: `https://storage.example.test/ticket-reply-attachments/${uuid(130 + state.effects.reply * 5 + index)}/${attachmentDigest}?X-Amz-Expires=300&X-Amz-Signature=fixture-only`,
                      fileIndex: index,
                    },
                  ]
                : []
            )
          : [],
        createdAt: instant,
        updatedAt: instant,
      };
      comments.set(command.ticket!, [
        ...(comments.get(command.ticket!) ?? []),
        structuredClone(result),
      ]);
      const selected = tickets.get(command.ticket!)!;
      if (!staff && selected.status === 'waiting_customer') selected.status = 'in_progress';
    } else {
      const selected = tickets.get(command.ticket!)!;
      if (family === 'status') {
        effect = selected.status !== body.status;
        selected.status = body.status as Ticket['status'];
      } else {
        selected.assignedTo = String(body.assigneeId);
        selected.assignedTeamId = (body.teamId as string) ?? null;
        if (selected.status === 'open') selected.status = 'in_progress';
      }
      // A legitimate same-status command has no update or audit effect.
      if (effect) selected.updatedAt = changedInstant;
      result = structuredClone(selected);
    }
    if (effect) state.effects[family]++;
    receipts.set(key, { raw: command.raw, result: structuredClone(result) });
    return structuredClone(result);
  };
  const respond = async (route: Route, command: Command) => {
    if (state.denied)
      return route.fulfill({
        status: 403,
        json: {
          error: {
            code: ErrorCodes.AUTHZ_FORBIDDEN.code,
            message: 'Forbidden',
            correlationId: 'ticket-form-fixture',
          },
        },
      });
    const mode = state.modes[command.family];
    if (mode === 'hold') {
      state.held = { route, command };
      return;
    }
    if (mode === 'owned' || mode === 'mixed')
      return route.fulfill({
        status: 400,
        json: {
          error: {
            code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            message: 'MUST-NOT-ECHO-SERVER-INPUT',
            correlationId: 'ticket-form-fixture',
            fields: [
              command.family === 'create'
                ? 'subject'
                : command.family === 'status'
                  ? 'reason'
                  : 'body',
              ...(mode === 'mixed' ? ['idempotencyKey'] : []),
            ],
          },
        },
      });
    if (mode === 'rejected') return route.fulfill({ status: 503, json: {} });
    return route.fulfill({
      status: command.family === 'create' || command.family === 'reply' ? 201 : 200,
      json: commit(command),
    });
  };
  await page.route(
    (url) => url.pathname === prefix || url.pathname.startsWith(prefix + '/'),
    async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (path.endsWith('/options') || path.endsWith('/assignees') || path.endsWith('/teams'))
        return route.fallback();
      if (request.method() === 'GET') {
        state.readLog.push(request.url());
        if (state.denied || (path === prefix && state.queueDenied))
          return route.fulfill({
            status: 403,
            json: {
              error: {
                code: ErrorCodes.AUTHZ_FORBIDDEN.code,
                message: 'Forbidden',
                correlationId: 'ticket-form-fixture',
              },
            },
          });
        if (path === prefix)
          return route.fulfill({
            json: {
              data: [...tickets.values()].map((ticket) => structuredClone(ticket)),
              totalPages: 1,
              total: tickets.size,
              page: 1,
              limit: 20,
              ...(staff
                ? {
                    responseTargetHours: 24,
                    viewer: {
                      userId: state.actor,
                      canWrite: true,
                      canAssignOthers: true,
                      canApproveClosure: true,
                    },
                  }
                : {}),
            },
          });
        const selected = path.slice(prefix.length + 1).split('/')[0]!;
        if (path.endsWith('/closure-preview')) {
          state.closureReads++;
          return route.fulfill({
            json: {
              eligible: true,
              completedAt: null,
              anonymizeProfile: false,
              blockers: [],
              retained: { tickets: 1 },
              exportTicketId: null,
              previewVersion: 'a'.repeat(64),
            },
          });
        }
        if (path.endsWith('/comments'))
          return route.fulfill({ json: comments.get(selected) ?? [] });
        if (path.endsWith('/preview'))
          return route.fulfill({ contentType: 'image/png', body: pdfPreviewImage });
        const ticket = tickets.get(selected);
        return ticket
          ? route.fulfill({
              json: {
                ...structuredClone(ticket),
                ...(staff
                  ? {
                      customer: {
                        userId: customerActor,
                        username: 'masked-customer',
                        email: null,
                        mobile: null,
                        profile: { id: profileId, title: 'Owned profile' },
                      },
                    }
                  : {}),
              },
            })
          : route.fulfill({ status: 404, json: {} });
      }
      if (path.endsWith('/execute-closure')) {
        state.closureWrites++;
        return route.fulfill({ status: 409, json: {} });
      }
      const family: Family =
        path === prefix
          ? 'create'
          : path.endsWith('/comments')
            ? 'reply'
            : path.endsWith('/assign')
              ? 'assignment'
              : 'status';
      const command: Command = {
        family,
        ticket: family === 'create' ? null : path.slice(prefix.length + 1).split('/')[0]!,
        raw: request.postData()!,
        body: request.postDataJSON() as Body,
        csrf: request.headers()['x-csrf-token'] ?? null,
      };
      state.writes.push(command);
      return respond(route, command);
    }
  );
  return {
    state,
    tickets,
    comments,
    receipts,
    async rotateCsrf() {
      state.csrf = 'ticket-forms-rotated';
      await page
        .context()
        .addCookies([{ name: 'barghsa_csrf', value: state.csrf, url: 'http://127.0.0.1:4173' }]);
    },
    async finishHeld(outcome: 'lost' | 'foreign' | 'malformed') {
      const held = state.held;
      if (!held) throw new Error('No captured ticket command is held');
      state.held = undefined;
      const result = commit(held.command);
      if (outcome === 'lost') await held.route.abort('failed');
      else
        await held.route.fulfill({
          status: held.command.family === 'create' || held.command.family === 'reply' ? 201 : 200,
          json:
            outcome === 'malformed'
              ? { id: 'not-a-ticket-receipt' }
              : {
                  ...result,
                  ...(held.command.family === 'reply'
                    ? { ticketId: otherTicketId }
                    : held.command.family === 'create'
                      ? { userId: staffActor }
                      : { id: otherTicketId }),
                },
        });
      return held.command;
    },
    async releaseOldOptionsDenied() {
      const route = state.heldOptions;
      if (!route) throw new Error('No old options read held');
      state.heldOptions = undefined;
      state.holdOptions = false;
      await route
        .fulfill({
          status: 403,
          json: {
            error: {
              code: ErrorCodes.AUTHZ_FORBIDDEN.code,
              message: 'Forbidden',
              correlationId: 'ticket-form-fixture',
            },
          },
        })
        .catch(() => {});
    },
    injectCustomerPrivateNote() {
      const selected = comments.get(ticketId) ?? [];
      comments.set(ticketId, [
        ...selected,
        {
          id: uuid(200),
          ticketId,
          authorId: staffActor,
          body: privateText,
          visibility: 'internal',
          bodyFormat: 'markdown',
          authorContext: 'staff',
          author: { displayName: 'Private staff identity', avatarUrl: null },
          attachments: [],
          attachmentCount: 0,
          createdAt: instant,
          updatedAt: instant,
        },
      ]);
    },
  };
}
