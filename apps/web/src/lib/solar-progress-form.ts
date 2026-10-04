import type { SolarMilestone, SolarProgress } from './solar-progress.js';

export interface ProgressNoteDraft {
  note: string;
}
export interface ProgressCommand {
  stage: SolarMilestone;
  note: string;
  expectedRevision: number;
  operationId: string;
}
export interface CapturedProgress {
  requestId: string;
  profileId: string;
  contractId: string;
  contractState: string | null;
  command: ProgressCommand;
  events: SolarProgress['events'];
}
const milestones = ['in_progress', 'delivered', 'installed'] as const;
const stepIds = ['document_review', 'postal_submission', 'contract_signing', ...milestones];
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function parseProgress(value: unknown): SolarProgress | null {
  if (
    !record(value) ||
    !uuid(value.requestId) ||
    !uuid(value.profileId) ||
    !(value.contractId === null || uuid(value.contractId)) ||
    !(value.contractState === null || typeof value.contractState === 'string') ||
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 0 ||
    Number(value.revision) > 3 ||
    value.nextMilestone !== (milestones[Number(value.revision)] ?? null) ||
    typeof value.eligible !== 'boolean' ||
    typeof value.stopped !== 'boolean' ||
    !(value.canRecord === undefined || typeof value.canRecord === 'boolean') ||
    !Array.isArray(value.steps) ||
    value.steps.length !== stepIds.length ||
    !value.steps.every(
      (step, index) =>
        record(step) &&
        step.id === stepIds[index] &&
        ['complete', 'current', 'pending'].includes(String(step.state)) &&
        typeof step.completed === 'boolean' &&
        (step.recordedAt === null || date(step.recordedAt)) &&
        (step.note === null || typeof step.note === 'string')
    ) ||
    !Array.isArray(value.events) ||
    value.events.length !== value.revision ||
    !value.events.every(
      (event, index) =>
        record(event) &&
        event.stage === milestones[index] &&
        event.revision === index + 1 &&
        date(event.recordedAt) &&
        (event.actorName === null || typeof event.actorName === 'string') &&
        typeof event.note === 'string' &&
        !!event.note.trim() &&
        event.note.trim().length <= 1000
    )
  )
    return null;
  return value as unknown as SolarProgress;
}
export function captureProgress(
  progress: SolarProgress,
  note: string,
  operationId: string
): CapturedProgress | null {
  if (!progress.canRecord || !progress.nextMilestone || !progress.contractId) return null;
  return {
    requestId: progress.requestId,
    profileId: progress.profileId,
    contractId: progress.contractId,
    contractState: progress.contractState,
    command: {
      stage: progress.nextMilestone,
      note: note.trim(),
      expectedRevision: progress.revision,
      operationId,
    },
    events: progress.events.map((event) => ({ ...event })),
  };
}
export function progressReviewHash(value: unknown, captured: CapturedProgress): string | null {
  const data = record(value) && record(value.data) ? value.data : null;
  const command = data && record(data.command) ? data.command : null;
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    typeof value.hash !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(value.hash) ||
    !record(value.scope) ||
    value.scope.action !== 'solar.construction.record' ||
    value.scope.profileId !== captured.profileId ||
    value.scope.resourceId !== captured.requestId ||
    !data ||
    !command ||
    data.contractId !== captured.contractId ||
    data.contractState !== captured.contractState ||
    !uuid(data.versionId) ||
    data.revision !== captured.command.expectedRevision ||
    data.previousStage !== (captured.events.at(-1)?.stage ?? null) ||
    data.customerVisible !== true ||
    data.collectsPayment !== false ||
    data.changesContract !== false ||
    Object.keys(command).length !== 4 ||
    !(['stage', 'note', 'expectedRevision', 'operationId'] as const).every(
      (key) => command[key] === captured.command[key]
    )
  )
    return null;
  return value.hash;
}
const eventKey = (event: SolarProgress['events'][number]) =>
  JSON.stringify([event.stage, event.revision, event.recordedAt, event.note]);
/** Read receipts may include later milestones; the captured event and its earlier history must match. */
export function confirmedProgress(
  value: unknown,
  captured: CapturedProgress
): SolarProgress | null {
  const progress = parseProgress(value);
  if (
    !progress ||
    progress.requestId !== captured.requestId ||
    progress.profileId !== captured.profileId ||
    progress.contractId !== captured.contractId ||
    progress.revision < captured.command.expectedRevision + 1 ||
    !captured.events.every((event, index) => {
      const saved = progress.events[index];
      return saved !== undefined && eventKey(saved) === eventKey(event);
    })
  )
    return null;
  const saved = progress.events[captured.command.expectedRevision];
  return saved?.stage === captured.command.stage &&
    saved.revision === captured.command.expectedRevision + 1 &&
    saved.note === captured.command.note
    ? progress
    : null;
}
export function definitiveProgressRejection(value: unknown): boolean {
  return (
    record(value) &&
    record(value.error) &&
    typeof value.error.code === 'string' &&
    !!value.error.code &&
    typeof value.error.message === 'string' &&
    typeof value.error.correlationId === 'string' &&
    !!value.error.correlationId
  );
}
