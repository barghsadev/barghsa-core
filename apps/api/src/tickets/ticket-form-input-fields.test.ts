import { HttpException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { InputFieldException } from '../common/input-field.exception.js';
import { TicketsController } from './tickets.controller.js';
import { StaffTicketsController } from './staff-tickets.controller.js';
import { optionalTicketCommandKey, parseTicketFormInput } from './ticket-form-input-fields.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const key = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const req = {
  session: { userId: 'opaque-staff', permissions: ['tickets:write'], operatingContext: 'staff' },
} as unknown as AuthenticatedRequest;
const routes = ['customerReply', 'staffReply', 'staffStatus'] as const;
type Route = (typeof routes)[number];
function fixture(route: Route) {
  const authorize = vi.fn().mockResolvedValue(undefined);
  const saved = { original: 'actual engine receipt' };
  const work = vi.fn().mockResolvedValue(saved);
  const service = {
    assertTicketFormAuthority: authorize,
    addComment: work,
    staffAddComment: work,
    staffUpdateTicketStatus: work,
  };
  const customer = new TicketsController(service as never);
  const staff = new StaffTicketsController(service as never);
  const body: Record<string, unknown> =
    route === 'staffStatus'
      ? { status: 'resolved', reason: '  Captured reason  ', idempotencyKey: key }
      : { body: '  Captured reply  ', bodyFormat: 'markdown', submissionId: key };
  const invoke = (value: unknown) =>
    route === 'staffStatus'
      ? staff.updateTicketStatus(id, value, req)
      : route === 'staffReply'
        ? staff.addComment(id, value, req)
        : customer.addComment(id, value, req);
  return {
    authorize,
    saved,
    work,
    body,
    invoke,
    field: route === 'staffStatus' ? 'reason' : 'body',
  };
}
async function rejection(command: Promise<unknown>): Promise<HttpException> {
  try {
    await command;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('Expected rejection');
}
it.each(routes)(
  '%s valid input retains original wire and bypasses feedback authority',
  async (route) => {
    const f = fixture(route);
    expect(await f.invoke(f.body)).toBe(f.saved);
    expect(f.authorize).not.toHaveBeenCalled();
    if (route === 'staffStatus')
      expect(f.work).toHaveBeenCalledExactlyOnceWith(
        id,
        'resolved',
        req.session.userId,
        undefined,
        req.session,
        'Captured reason',
        key
      );
    else
      expect(f.work).toHaveBeenCalledExactlyOnceWith(
        id,
        req.session.userId,
        '  Captured reply  ',
        'public',
        route === 'staffReply' ? undefined : false,
        req.session,
        f.body
      );
  }
);
it.each(routes)(
  '%s visible string feedback follows current authority and never echoes content',
  async (route) => {
    const f = fixture(route);
    for (const value of [' ', 'PRIVATE'.repeat(route === 'staffStatus' ? 334 : 1667)]) {
      const error = await rejection(f.invoke({ ...f.body, [f.field]: value }));
      expect(error).toBeInstanceOf(InputFieldException);
      expect(error).toMatchObject({ fields: [f.field] });
      expect(error.getResponse()).toEqual({ error: 'VALIDATION:INPUT:INVALID' });
      expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
      expect(f.authorize).toHaveBeenLastCalledWith(req.session, id, route !== 'customerReply');
    }
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(routes)(
  '%s authority denial cannot become owned metadata or business work',
  async (route) => {
    const f = fixture(route);
    for (const status of [401, 403, 404]) {
      f.authorize.mockRejectedValueOnce(new HttpException('Current authority denied', status));
      const error = await rejection(f.invoke({ ...f.body, [f.field]: '' }));
      expect(error.getStatus()).toBe(status);
      expect(error).not.toBeInstanceOf(InputFieldException);
    }
    expect(f.work).not.toHaveBeenCalled();
  }
);
it.each(routes)(
  '%s protected, mixed, unknown and nonstring failures stay generic',
  async (route) => {
    const f = fixture(route);
    const bad =
      route === 'staffStatus'
        ? [{ status: 'PRIVATE' }, { idempotencyKey: 'PRIVATE' }]
        : [
            { attachments: ['PRIVATE'] },
            { submissionId: 'PRIVATE' },
            { visibility: 'PRIVATE' },
            { bodyFormat: 'PRIVATE' },
            {
              attachments: [
                'uploads/image/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png',
                'uploads/image/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png',
              ],
            },
          ];
    for (const patch of [{ PRIVATE: 'PRIVATE' }, ...bad]) {
      const error = await rejection(f.invoke({ ...f.body, [f.field]: '', ...patch }));
      expect(error).not.toBeInstanceOf(InputFieldException);
      expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
    }
    for (const value of [null, 0, false, []]) {
      const error = await rejection(f.invoke({ ...f.body, [f.field]: value }));
      expect(error).not.toBeInstanceOf(InputFieldException);
    }
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
  }
);
it('customer internal replies remain forbidden without owned metadata', async () => {
  const f = fixture('customerReply');
  for (const body of ['', 'Private internal note']) {
    const error = await rejection(f.invoke({ ...f.body, body, visibility: 'internal' }));
    expect(error.getStatus()).toBe(403);
    expect(error).not.toBeInstanceOf(InputFieldException);
  }
  expect(f.work).not.toHaveBeenCalled();
});
it('legacy customer status ignores extra body fields and captures only the optional key', async () => {
  const work = vi.fn().mockResolvedValue({ original: true });
  const controller = new TicketsController({ updateTicketStatus: work } as never);
  const raw = { status: 'open', reason: 'PRIVATE', ignored: 'legacy', idempotencyKey: key };
  await controller.updateTicketStatus(id, raw, req);
  expect(work).toHaveBeenCalledExactlyOnceWith(
    id,
    req.session.userId,
    'open',
    false,
    req.session,
    key
  );
});
it('assignment keeps self default, team and original positional arguments with an optional key', async () => {
  const work = vi.fn().mockResolvedValue({ original: true });
  const controller = new StaffTicketsController({ staffAssignTicket: work } as never);
  await controller.assignTicket(id, { idempotencyKey: key }, req);
  expect(work).toHaveBeenCalledExactlyOnceWith(
    id,
    req.session.userId,
    req.session.userId,
    undefined,
    undefined,
    req.session,
    key
  );
});
it('optional command keys retain legacy omission and reject protected non-UUID input', () => {
  expect(optionalTicketCommandKey(undefined)).toBeUndefined();
  expect(optionalTicketCommandKey(key)).toBe(key);
  for (const value of ['PRIVATE', null, {}, 0])
    expect(() => optionalTicketCommandKey(value)).toThrow(HttpException);
});
it('create leaf feedback uses existing trimming bounds and rejects root or mixed failures', async () => {
  const schema = z
    .object({
      subject: z.string().trim().min(1).max(200),
      body: z.string().trim().min(1).max(10000),
      profileId: z.uuid().optional(),
    })
    .strict();
  const authorize = vi.fn().mockResolvedValue(undefined);
  for (const input of [
    { subject: ' ', body: 'Details' },
    { subject: 'PRIVATE'.repeat(34), body: 'Details' },
    { subject: 'Title', body: ' ' },
  ]) {
    const error = await rejection(
      parseTicketFormInput(schema, input, ['subject', 'body'], authorize, 'Invalid ticket fields')
    );
    expect(error).toBeInstanceOf(InputFieldException);
  }
  authorize.mockClear();
  for (const input of [
    null,
    [],
    { subject: '', body: 'Details', profileId: 'PRIVATE' },
    { subject: null, body: 'Details' },
    { subject: '', body: 'Details', PRIVATE: true },
  ]) {
    const error = await rejection(
      parseTicketFormInput(schema, input, ['subject', 'body'], authorize, 'Invalid ticket fields')
    );
    expect(error).not.toBeInstanceOf(InputFieldException);
  }
  expect(authorize).not.toHaveBeenCalled();
});
