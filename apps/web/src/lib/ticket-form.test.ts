import { describe, expect, it } from 'vitest';
import {
  ticketAssignmentOptions,
  ticketAssignmentReceipt,
  ticketIntakeReceipt,
  ticketOptions,
  ticketRecord,
  ticketReplyReceipt,
  ticketStatusReceipt,
} from './ticket-form.js';
import {
  inactiveTicketSchema,
  ticketAssignmentSchema,
  ticketIntakeSchema,
  ticketReplySchema,
  ticketStatusSchema,
} from './ticket-form-schemas.js';

const id = '10000000-0000-4000-8000-000000000001';
const profileId = '20000000-0000-4000-8000-000000000002';
const commentId = '30000000-0000-4000-8000-000000000003';
const teamId = '40000000-0000-4000-8000-000000000004';
const stamp = '2026-10-05T08:00:00.123Z';
const actor = 'account:opaque';
const sealed = `ticket-attachments/${commentId}/${'a'.repeat(64)}`;
const replySealed = `ticket-reply-attachments/${commentId}/${'b'.repeat(64)}`;
const upload = `uploads/document/${commentId}.pdf`;
const ticket = {
  id,
  userId: actor,
  subject: 'A question',
  body: 'Please help',
  category: 'general',
  priority: 'normal',
  status: 'open',
  profileId: null,
  relatedEntityId: null,
  relatedEntityType: null,
  assignedTo: null,
  assignedTeamId: null,
  attachments: [],
  createdAt: stamp,
  updatedAt: stamp,
};
const copy = (key: string) => key;
const allowedFile = (value: File) => value instanceof File && value.type === 'application/pdf';
const intake = ticketIntakeSchema(
  copy,
  (value) => value === '' || value === profileId,
  (value) => value === '',
  allowedFile
);
const reply = ticketReplySchema(copy, allowedFile);
const status = ticketStatusSchema(copy, () => ['waiting_customer']);
const assignment = ticketAssignmentSchema(
  copy,
  (value) => value === '' || value === teamId,
  (value, group) => value === actor && (group === '' || group === teamId)
);
const values = {
  subject: ' A question ',
  body: ' Please help ',
  category: 'general',
  priority: 'normal',
  profileId: '',
  record: '',
  files: [],
};

describe('ticket forms bind the existing request and receipt contracts', () => {
  it('keeps intake trim limits, offered scope and the existing attachment boundary', () => {
    expect(intake.safeParse({ ...values, subject: ` ${'s'.repeat(200)} ` }).success).toBe(true);
    for (const change of [
      { subject: ' ' },
      { subject: 's'.repeat(201) },
      { body: 'b'.repeat(10001) },
      { category: 'other' },
      { profileId: id },
      { record: `invoice:${id}` },
      {
        files: Array.from(
          { length: 6 },
          () => new File(['pdf'], 'x.pdf', { type: 'application/pdf' })
        ),
      },
    ])
      expect(intake.safeParse({ ...values, ...change }).success).toBe(false);
  });

  it('requires reply text or a real allowed file while retaining the raw body limit', () => {
    const file = new File(['pdf'], 'note.pdf', { type: 'application/pdf' });
    expect(reply.safeParse({ body: ' ', files: [file] }).success).toBe(true);
    expect(reply.safeParse({ body: ' ', files: [] }).success).toBe(false);
    expect(reply.safeParse({ body: ` ${'x'.repeat(10000)}`, files: [file] }).success).toBe(false);
    expect(reply.safeParse({ body: 'hello', files: [{}] }).success).toBe(false);
  });

  it('uses current status choices and opaque offered assignee IDs', () => {
    expect(
      status.safeParse({ status: 'waiting_customer', reason: ` ${'r'.repeat(2000)} ` }).success
    ).toBe(true);
    expect(status.safeParse({ status: 'resolved', reason: 'explain' }).success).toBe(false);
    expect(status.safeParse({ status: 'waiting_customer', reason: 'r'.repeat(2001) }).success).toBe(
      false
    );
    expect(assignment.safeParse({ teamId, assigneeId: actor }).success).toBe(true);
    expect(assignment.safeParse({ teamId, assigneeId: 'not-offered' }).success).toBe(false);
  });

  it('returns validation failure for malformed drafts rather than throwing', () => {
    for (const schema of [intake, reply, status, assignment, inactiveTicketSchema]) {
      for (const input of [null, undefined, [], 'draft', {}]) {
        expect(() => schema.safeParse(input)).not.toThrow();
        expect(schema.safeParse(input).success).toBe(false);
      }
    }
  });

  it('decodes real nullable ticket identities without coercing malformed enum values', () => {
    expect(ticketRecord(ticket, id)).not.toBeNull();
    for (const change of [
      { id: 'not-a-uuid' },
      { userId: '' },
      { category: ['general'] },
      { priority: ['normal'] },
      { relatedEntityId: id },
      { createdAt: '2026-10-05' },
    ])
      expect(ticketRecord({ ...ticket, ...change }, id)).toBeNull();
    expect(ticketRecord(ticket, commentId)).toBeNull();
  });

  it('accepts automatic assignment on create and validates the sealed receipt count', () => {
    const command = {
      subject: ticket.subject,
      body: ticket.body,
      category: 'general',
      priority: 'normal',
      attachments: [upload],
    };
    const receipt = { ...ticket, attachments: [sealed] };
    expect(ticketIntakeReceipt(receipt, actor, command)).toBe(true);
    expect(
      ticketIntakeReceipt(
        { ...receipt, status: 'in_progress', assignedTo: 'staff:opaque', assignedTeamId: teamId },
        actor,
        command
      )
    ).toBe(true);
    for (const change of [
      { userId: 'foreign' },
      { body: 'different' },
      { attachments: [] },
      { attachments: [upload] },
    ]) {
      expect(ticketIntakeReceipt({ ...receipt, ...change }, actor, command)).toBe(false);
    }
  });

  it('accepts a real status no-op without a fresh timestamp or echoed reason', () => {
    const source = ticketRecord({ ...ticket, status: 'waiting_customer' })!;
    expect(ticketStatusReceipt(source, source, 'waiting_customer')).toBe(true);
    expect(ticketStatusReceipt({ ...source, id: commentId }, source, 'waiting_customer')).toBe(
      false
    );
    expect(ticketStatusReceipt({ ...source, subject: 'foreign' }, source, 'waiting_customer')).toBe(
      false
    );
    expect(ticketStatusReceipt({ ...source, status: 'closed' }, source, 'waiting_customer')).toBe(
      false
    );
  });

  it('confirms assignment against the current server status after a concurrent transition', () => {
    const source = ticketRecord(ticket)!;
    for (const current of [
      'in_progress',
      'waiting_customer',
      'waiting_staff',
      'resolved',
      'closed',
    ]) {
      expect(
        ticketAssignmentReceipt(
          { ...ticket, status: current, assignedTo: actor, assignedTeamId: teamId },
          source,
          actor,
          teamId
        )
      ).toBe(true);
    }
    expect(
      ticketAssignmentReceipt(
        { ...ticket, assignedTo: actor, assignedTeamId: teamId },
        source,
        actor,
        teamId
      )
    ).toBe(false);
    expect(
      ticketAssignmentReceipt(
        { ...ticket, status: 'in_progress', assignedTo: 'foreign', assignedTeamId: teamId },
        source,
        actor,
        teamId
      )
    ).toBe(false);
    expect(
      ticketAssignmentReceipt(
        { ...ticket, status: 'in_progress', assignedTo: actor, assignedTeamId: null },
        source,
        actor,
        teamId
      )
    ).toBe(false);
  });

  it('accepts sparse available reply files using the actual count and sealed keys', () => {
    const command = {
      body: '**note**',
      visibility: 'public',
      bodyFormat: 'markdown',
      attachments: [upload, `uploads/image/${id}.png`],
    };
    const receipt = {
      id: commentId,
      ticketId: id,
      authorId: actor,
      body: command.body,
      visibility: 'public',
      bodyFormat: 'markdown',
      authorContext: 'customer',
      createdAt: stamp,
      updatedAt: stamp,
      author: null,
      attachmentCount: 2,
      attachments: [
        {
          key: replySealed,
          fileIndex: 1,
          fileName: 'note.pdf',
          contentType: 'application/pdf',
          url: `https://files.example.test/${replySealed}?signature=fixture`,
        },
      ],
    };
    expect(ticketReplyReceipt(receipt, id, actor, false, command)).toBe(true);
    expect(ticketReplyReceipt({ ...receipt, attachments: [] }, id, actor, false, command)).toBe(
      true
    );
    for (const change of [
      { ticketId: profileId },
      { authorId: 'foreign' },
      { body: 'different' },
      { visibility: 'internal' },
      { bodyFormat: 'plain' },
      { authorContext: 'staff' },
      { attachmentCount: 1 },
    ]) {
      expect(ticketReplyReceipt({ ...receipt, ...change }, id, actor, false, command)).toBe(false);
    }
    const file = receipt.attachments[0]!;
    for (const change of [
      { key: upload },
      { fileIndex: 2 },
      { contentType: ['application/pdf'] },
      { url: 'javascript:alert(1)' },
    ]) {
      expect(
        ticketReplyReceipt(
          { ...receipt, attachments: [{ ...file, ...change }] },
          id,
          actor,
          false,
          command
        )
      ).toBe(false);
    }
    expect(
      ticketReplyReceipt({ ...receipt, attachments: [file, file] }, id, actor, false, command)
    ).toBe(false);
  });

  it('accepts names-only current choices and rejects duplicates or coerced record types', () => {
    const options = {
      profiles: [{ id: profileId, title: null }],
      records: [{ id, type: 'invoice', created_at: stamp }],
      hasMoreRecords: false,
    };
    expect(ticketOptions(options)).not.toBeNull();
    expect(
      ticketOptions({ ...options, profiles: [...options.profiles, ...options.profiles] })
    ).toBeNull();
    expect(
      ticketOptions({ ...options, records: [{ ...options.records[0], type: ['invoice'] }] })
    ).toBeNull();
    expect(
      ticketAssignmentOptions(
        [{ id: actor, name: 'Staff' }],
        [{ id: teamId, name: 'Support', members: [actor] }]
      )
    ).not.toBeNull();
    expect(
      ticketAssignmentOptions(
        [{ id: actor, name: 'Staff' }],
        [{ id: teamId, name: 'Support', members: [actor, actor] }]
      )
    ).toBeNull();
  });
});
