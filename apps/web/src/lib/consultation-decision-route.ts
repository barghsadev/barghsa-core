export const consultationDecisions = [
  'request-info',
  'complete',
  'reject',
  'cancel',
  'recover-refund',
] as const;
export type ConsultationDecision = (typeof consultationDecisions)[number];
export const consultationDecisionPath = '/admin/consultations/$requestId/decisions/$decision';

export function consultationDecision(value: string | undefined): ConsultationDecision | undefined {
  return consultationDecisions.find((decision) => decision === value);
}
