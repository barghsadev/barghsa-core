import { describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import { InputFieldException } from '../common/input-field.exception.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { FailedJobsController } from './failed-jobs.controller.js';
import { FailedNotificationsController } from './failed-notifications.controller.js';
import { ReconciliationExceptionsController } from './reconciliation-exceptions.controller.js';

const id = 'abcd0000-1111-4111-8111-111111111111';
const from = '2026-11-01T00:00:00.001Z';
const to = '2026-12-02T00:00:00.001Z';
const dates = { from, to };
const parsedDates = { from: new Date(from), to: new Date(to) };
const selection = [{ id, revision: '1793491200.001234' }];
const validationError = {
  status: 400,
  response: { error: ErrorCodes.VALIDATION_INPUT_INVALID.code },
};
function operator(
  permissions: string[],
  network: Partial<Pick<AuthenticatedRequest, 'ip' | 'socket'>> = {},
  operatingContext: 'staff' | 'customer' = 'staff'
) {
  return {
    session: { userId: 'queue-operator', operatingContext, permissions, isAdmin: false },
    ...network,
  } as AuthenticatedRequest;
}

describe('failed-job queue boundaries', () => {
  const setup = () => {
    const service = {
      listFailedJobs: vi.fn().mockResolvedValue([]),
      getFailedJob: vi.fn().mockResolvedValue({ id, status: 'resolved' }),
      retryFailedJob: vi.fn(),
      retryFailedJobsBulk: vi.fn(),
      resolveFailedJob: vi.fn(),
    };
    return { service, controller: new FailedJobsController(service as never) };
  };

  it('keeps detail and single-parameter pagination available to view-only staff', async () => {
    const { service, controller } = setup();
    const viewer = operator(['admin:jobs:view']);
    const writer = operator(['admin:jobs:retry']);
    expect(controller.access(viewer)).toEqual({ canView: true, canRetry: false });
    expect(controller.access(writer)).toEqual({ canView: false, canRetry: true });
    expect(() => controller.detail(id, writer)).toThrow(expect.objectContaining({ status: 403 }));
    expect(service.getFailedJob).not.toHaveBeenCalled();
    await expect(controller.detail(id, viewer)).resolves.toEqual({ id, status: 'resolved' });
    expect(service.getFailedJob).toHaveBeenCalledExactlyOnceWith(id, viewer.session);
    await controller.listFailedJobs(undefined, undefined, '200', undefined, viewer);
    await controller.listFailedJobs(undefined, undefined, undefined, '0', viewer);
    expect(service.listFailedJobs.mock.calls).toEqual([
      [{ limit: 200 }, viewer.session],
      [{ offset: 0 }, viewer.session],
    ]);
  });

  it('uses the socket address or an explicit unknown value for audit attribution', async () => {
    const { service, controller } = setup();
    const socketWriter = operator(['admin:jobs:retry'], {
      socket: { remoteAddress: '192.0.2.10' } as AuthenticatedRequest['socket'],
    });
    const writer = operator(['admin:jobs:retry']);
    await controller.retryJob(id, socketWriter, {});
    await controller.retryBulk({ ids: [id] }, socketWriter);
    await controller.resolveJob(id, socketWriter);
    expect(service.retryFailedJob).toHaveBeenCalledExactlyOnceWith(
      id,
      socketWriter.session,
      '192.0.2.10'
    );
    expect(service.retryFailedJobsBulk).toHaveBeenCalledExactlyOnceWith(
      [id],
      socketWriter.session,
      '192.0.2.10'
    );
    expect(service.resolveFailedJob).toHaveBeenCalledExactlyOnceWith(
      id,
      socketWriter.session,
      '192.0.2.10'
    );
    await controller.retryJob(id, writer);
    await controller.retryBulk({ ids: [id] }, writer);
    await controller.resolveJob(id, writer, {});
    expect(service.retryFailedJob).toHaveBeenLastCalledWith(id, writer.session, 'unknown');
    expect(service.retryFailedJobsBulk).toHaveBeenLastCalledWith([id], writer.session, 'unknown');
    expect(service.resolveFailedJob).toHaveBeenLastCalledWith(id, writer.session, 'unknown');
    await expect(controller.retryJob(id, writer, { status: 'retrying' })).rejects.toMatchObject(
      validationError
    );
    await expect(controller.resolveJob(id, writer, { status: 'resolved' })).rejects.toMatchObject(
      validationError
    );
    expect(service.retryFailedJob).toHaveBeenCalledTimes(2);
    expect(service.resolveFailedJob).toHaveBeenCalledTimes(2);
  });
});

describe('notification dead-letter queue boundaries', () => {
  function setup() {
    const service = {
      listFailedNotifications: vi.fn().mockResolvedValue([]),
      getFailedNotification: vi.fn().mockResolvedValue({ id, recipient: 's***@example.test' }),
      previewOutboxReplay: vi.fn().mockResolvedValue({ items: selection }),
      replayOutbox: vi.fn().mockResolvedValue({ queued: 1 }),
      retryFailedNotification: vi.fn(),
      resolveFailedNotification: vi.fn(),
      dismissFailedNotification: vi.fn(),
    };
    return { service, controller: new FailedNotificationsController(service as never) };
  }
  const viewer = operator(['admin:jobs:view']);
  const writer = operator(['admin:jobs:retry']);
  const reviewer = operator(['admin:jobs:view', 'admin:jobs:retry']);

  it('requires both capabilities for replay, retains the masked detail and keeps pagination independent', async () => {
    const { controller, service } = setup();
    expect(controller.access(viewer)).toEqual({ canView: true, canRetry: false });
    expect(controller.access(writer)).toEqual({ canView: false, canRetry: true });
    for (const req of [
      viewer,
      writer,
      operator(['admin:jobs:view', 'admin:jobs:retry'], {}, 'customer'),
    ]) {
      await expect(controller.previewReplay(dates, req)).rejects.toMatchObject({ status: 403 });
      await expect(
        controller.replay({ ...dates, confirm: true, selection }, req)
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(service.previewOutboxReplay).not.toHaveBeenCalled();
    expect(service.replayOutbox).not.toHaveBeenCalled();
    expect(() => controller.detail(id, writer)).toThrow(expect.objectContaining({ status: 403 }));
    await expect(controller.detail(id, viewer)).resolves.toEqual({
      id,
      recipient: 's***@example.test',
    });
    expect(service.getFailedNotification).toHaveBeenCalledExactlyOnceWith(id, viewer.session);
    await controller.list(undefined, undefined, undefined, '200', undefined, viewer);
    await controller.list(undefined, undefined, 'sms', undefined, '3', viewer);
    expect(service.listFailedNotifications.mock.calls).toEqual([
      [{ limit: 200 }, viewer.session],
      [{ channel: 'sms', offset: 3 }, viewer.session],
    ]);
  });

  it('rejects invalid replay windows and duplicate or ambiguous selections before calling the service', async () => {
    const { controller, service } = setup();
    for (const range of [
      { from, to: from },
      { from: to, to: from },
      { from, to: '2026-12-02T00:00:00.002Z' },
      { ...dates, from: '2026-11-01T00:00:00.0001Z' },
      { ...dates, to: '2026-12-02T03:30:00.001+03:30' },
      { ...dates, status: 'open' },
    ]) {
      await expect(controller.previewReplay(range, reviewer)).rejects.toMatchObject(
        validationError
      );
      await expect(
        controller.replay({ ...range, confirm: true, selection }, reviewer)
      ).rejects.toMatchObject(validationError);
    }
    for (const invalid of [
      { selection: [] },
      { confirm: false },
      { selection: [...selection, { id: id.toUpperCase(), revision: selection[0]!.revision }] },
      { selection: [{ id, revision: '1793491200.123' }] },
      { selection: [{ id, revision: selection[0]!.revision, status: 'open' }] },
    ]) {
      await expect(
        controller.replay({ ...dates, confirm: true, selection, ...invalid }, reviewer)
      ).rejects.toMatchObject(validationError);
    }
    expect(service.previewOutboxReplay).not.toHaveBeenCalled();
    expect(service.replayOutbox).not.toHaveBeenCalled();
    await expect(controller.previewReplay(dates, reviewer)).resolves.toEqual({ items: selection });
    expect(service.previewOutboxReplay).toHaveBeenCalledExactlyOnceWith(
      parsedDates,
      reviewer.session
    );
    await expect(
      controller.replay(
        {
          ...dates,
          confirm: true,
          selection: [{ id: id.toUpperCase(), revision: selection[0]!.revision }],
        },
        reviewer
      )
    ).resolves.toEqual({ queued: 1 });
    expect(service.replayOutbox).toHaveBeenCalledExactlyOnceWith(
      parsedDates,
      selection,
      reviewer.session,
      'unknown'
    );
  });

  it('passes observed socket attribution through replay and triage actions', async () => {
    const { controller, service } = setup();
    const socketReviewer = operator(['admin:jobs:view', 'admin:jobs:retry'], {
      socket: { remoteAddress: '192.0.2.11' } as AuthenticatedRequest['socket'],
    });
    await controller.replay({ ...dates, confirm: true, selection }, socketReviewer);
    expect(service.replayOutbox).toHaveBeenCalledExactlyOnceWith(
      parsedDates,
      selection,
      socketReviewer.session,
      '192.0.2.11'
    );
    for (const [action, method] of [
      ['retry', service.retryFailedNotification],
      ['resolve', service.resolveFailedNotification],
      ['dismiss', service.dismissFailedNotification],
    ] as const) {
      await expect(
        controller[action](id, socketReviewer, { status: 'open' })
      ).rejects.toMatchObject(validationError);
      expect(method).not.toHaveBeenCalled();
      await controller[action](id, socketReviewer, {});
      expect(method).toHaveBeenCalledExactlyOnceWith(id, socketReviewer.session, '192.0.2.11');
      await controller[action](id, reviewer);
      expect(method).toHaveBeenLastCalledWith(id, reviewer.session, 'unknown');
    }
  });
});

describe('reconciliation queue boundaries', () => {
  const setup = () => {
    const service = {
      listReconciliationExceptions: vi.fn().mockResolvedValue([]),
      getExceptionDto: vi.fn().mockResolvedValue({ id, status: 'resolved' }),
      investigateReconciliationException: vi.fn(),
      resolveReconciliationException: vi.fn(),
      closeReconciliationException: vi.fn(),
    };
    return { service, controller: new ReconciliationExceptionsController(service as never) };
  };

  it('passes either page bound and the exact date range, and separates view from resolution', async () => {
    const { controller, service } = setup();
    const viewer = operator(['admin:reconciliation:view']);
    const writer = operator(['admin:reconciliation:resolve']);
    expect(controller.access(viewer)).toEqual({ canView: true, canResolve: false });
    expect(controller.access(writer)).toEqual({ canView: false, canResolve: true });
    expect(() => controller.detail(id, writer)).toThrow(expect.objectContaining({ status: 403 }));
    await expect(controller.detail(id, viewer)).resolves.toEqual({ id, status: 'resolved' });
    expect(service.getExceptionDto).toHaveBeenCalledExactlyOnceWith(id, viewer.session);
    await controller.listReconciliationItems(undefined, undefined, '200', undefined, viewer, from);
    await controller.listReconciliationItems(
      'resolved',
      undefined,
      undefined,
      '0',
      viewer,
      undefined,
      to
    );
    expect(service.listReconciliationExceptions.mock.calls).toEqual([
      [{ limit: 200, createdFrom: from }, viewer.session],
      [{ status: 'resolved', offset: 0, createdBefore: to }, viewer.session],
    ]);
  });

  it('returns safe note-only feedback and passes trimmed audit notes with request attribution', async () => {
    const { controller, service } = setup();
    const writer = operator(['admin:reconciliation:resolve']);
    const socketWriter = operator(['admin:reconciliation:resolve'], {
      socket: { remoteAddress: '192.0.2.12' } as AuthenticatedRequest['socket'],
    });
    await expect(
      controller.investigateItem(id, socketWriter, { note: 'not persisted' })
    ).rejects.toMatchObject(validationError);
    expect(service.investigateReconciliationException).not.toHaveBeenCalled();
    await controller.investigateItem(id, socketWriter, {});
    await controller.investigateItem(id, writer);
    expect(service.investigateReconciliationException.mock.calls).toEqual([
      [id, socketWriter.session, '192.0.2.12'],
      [id, writer.session, 'unknown'],
    ]);
    for (const [action, method] of [
      ['resolveItem', service.resolveReconciliationException],
      ['closeItem', service.closeReconciliationException],
    ] as const) {
      const error = await controller[action](id, { note: ' ' }, writer).catch(
        (error: unknown) => error
      );
      expect(error).toBeInstanceOf(InputFieldException);
      expect(error).toMatchObject({ ...validationError, fields: ['note'] });
      const extra = await controller[action](
        id,
        { note: 'test decision', extra: 'private' },
        writer
      ).catch((error: unknown) => error);
      expect(extra).toMatchObject(validationError);
      expect(extra).not.toBeInstanceOf(InputFieldException);
      expect(JSON.stringify(extra)).not.toContain('private');
      expect(method).not.toHaveBeenCalled();
      await controller[action](id, { note: '  reviewed fixture  ' }, socketWriter);
      await controller[action](id, { note: '  independently confirmed  ' }, writer);
      expect(method.mock.calls).toEqual([
        [id, socketWriter.session, '192.0.2.12', 'reviewed fixture'],
        [id, writer.session, 'unknown', 'independently confirmed'],
      ]);
    }
  });
});
