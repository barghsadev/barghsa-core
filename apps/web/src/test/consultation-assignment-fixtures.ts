export const privateConsultationOwnerId = '99000000-0000-4000-8000-000000000001';
export const consultationContextStates = [
  'submitted',
  'under_review',
  'awaiting_customer_info',
  'offer_pending',
  'offer_accepted',
  'offer_declined',
  'completed',
  'rejected',
  'cancelled',
  'private_future_status',
] as const;
export const consultationContextTones = [
  'info',
  'warning',
  'warning',
  'warning',
  'success',
  'destructive',
  'default',
  'destructive',
  'destructive',
  'default',
] as const;
export function consultationContextRows() {
  const assignments = [
    {
      staff_owner_id: privateConsultationOwnerId,
      staff_owner_name: 'Reviewer <script>',
      staff_team: 'Energy Team',
    },
    {
      staff_owner_id: privateConsultationOwnerId,
      staff_owner_name: null,
      staff_team: 'Energy Team',
    },
    { staff_owner_id: privateConsultationOwnerId, staff_team: null },
    { staff_owner_id: null, staff_owner_name: 'Unbound private name', staff_team: 'Energy Team' },
    { staff_owner_id: null, staff_owner_name: null, staff_team: null },
    { staff_owner_id: null, staff_owner_name: 'Unbound private name', staff_team: null },
  ];
  return consultationContextStates.map((status, index) => ({
    id: `71000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    profile_id: '72000000-0000-4000-8000-000000000001',
    profile_name: `Buyer ${index + 1}`,
    status,
    product_snapshot: {
      title: { en: `Energy consultation ${index + 1}`, fa: `مشاوره انرژی ${index + 1}` },
    },
    ...assignments[index % assignments.length]!,
    submitted_at: '2026-09-23T10:00:00.000Z',
    priority: 'normal' as const,
  }));
}
export const consultationContextHistory = consultationContextStates.map((status, index) => ({
  status,
  actor_type:
    index === 9
      ? 'private_actor_type'
      : index === 0 || index === 4 || index === 5
        ? 'customer'
        : 'staff',
  actor_name:
    index === 9
      ? 'Private future actor'
      : index === 0
        ? 'Buyer <script>'
        : index === 1
          ? 'Reviewer <script>'
          : null,
  reason:
    index === 2 ? '<img src=x onerror=alert(1)>' : index === 6 ? 'Consultation delivered' : null,
  created_at: '2026-09-23T10:00:00.000Z',
}));
export function consultationContextDetail(
  request: ReturnType<typeof consultationContextRows>[number]
) {
  return {
    request: {
      ...request,
      scope: null,
      deliverables: null,
      fee: null,
      invoice_id: null,
      invoice_state: null,
      has_paid_invoice: false,
      uncovered_credit: '0',
      offer_valid_until: null,
      expected_next_step: null,
    },
    history: consultationContextHistory,
  };
}
