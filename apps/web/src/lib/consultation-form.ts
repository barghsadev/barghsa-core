export interface ConsultationIntakeDraft {
  productId: string;
  confirm: boolean;
}
export interface ConsultationReasonDraft {
  reason: string;
}
export interface ConsultationInformationEvent {
  status: string;
  actor_type: string;
  reason: string | null;
  created_at: string;
}
export interface ConsultationInformationCommand {
  requestId: string;
  profileId: string;
  reason: string;
  history: ConsultationInformationEvent[];
}
export const emptyConsultationIntake: ConsultationIntakeDraft = { productId: '', confirm: false };
export const consultationUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function consultationReceipt(value: unknown, requestId: string, expectedStatus: string) {
  return record(value) && value.requestId === requestId && value.status === expectedStatus;
}
export function consultationIntakeReceipt(
  value: unknown
): value is { requestId: string; status: 'submitted' } {
  return (
    record(value) &&
    typeof value.requestId === 'string' &&
    consultationUuid(value.requestId) &&
    value.status === 'submitted'
  );
}
export function definitiveConsultationRejection(status: number, value: unknown) {
  return (
    status >= 400 &&
    status < 500 &&
    record(value) &&
    record(value.error) &&
    typeof value.error.code === 'string' &&
    !!value.error.code &&
    typeof value.error.message === 'string' &&
    typeof value.error.correlationId === 'string' &&
    !!value.error.correlationId
  );
}
const eventKey = (event: ConsultationInformationEvent) =>
  JSON.stringify([event.status, event.actor_type, event.reason, event.created_at]);
/** Only a new saved customer reply proves an ambiguous command settled. An old editable read cannot. */
export function confirmedConsultationInformation(
  value: unknown,
  command: ConsultationInformationCommand
) {
  if (
    !record(value) ||
    !record(value.request) ||
    value.request.id !== command.requestId ||
    value.request.profile_id !== command.profileId ||
    !Array.isArray(value.history) ||
    value.history.length <= command.history.length
  )
    return false;
  const history = value.history;
  if (
    !command.history.every(
      (event, index) =>
        record(history[index]) &&
        eventKey(history[index] as unknown as ConsultationInformationEvent) === eventKey(event)
    )
  )
    return false;
  return history
    .slice(command.history.length)
    .some(
      (event) =>
        record(event) &&
        event.status === 'under_review' &&
        event.actor_type === 'customer' &&
        event.reason === command.reason &&
        typeof event.created_at === 'string' &&
        Number.isFinite(Date.parse(event.created_at))
    );
}
